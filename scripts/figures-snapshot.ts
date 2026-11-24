import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { assertCopyFolder } from "./lib/copy-guard.js";
import type { Snapshot } from "./figures-compare.js";
import { buildMonthView, type MonthTotals } from "../src/domain/budget-month.js";
import { prepareTransactions, prepareForRollup } from "../src/domain/pipeline.js";
import { rollupMonthly } from "../src/domain/rollups.js";
import { monthBudgetCents } from "../src/domain/dashboard-month.js";
import { spentMonthToDate, COMPARE_OPTIONS, baselineFor, baselineOf, sumForBaseline, baselineSegments } from "../src/domain/compare.js";
import { incomeMonthToDate } from "../src/domain/income-month.js";
import { cashForecast } from "../src/domain/cash-forecast.js";
import { linesAcrossPlans } from "../src/domain/plans-across.js";
import { currentPlan, planForMonth } from "../src/domain/plan-choice.js";
import { computeRunway, drawableLiquidCents } from "../src/domain/runway.js";
import { netWorthCents, netWorthRows } from "../src/domain/networth.js";
import { addMonths } from "../src/domain/scenario.js";
import { maaserLedger } from "../src/domain/maaser-pot.js";
import { ledgerTotal, filterRows, EMPTY_FILTER, toRows } from "../src/domain/transactions-view.js";
import { monthBounds, resolvePeriod, PERIOD_PRESETS, customPeriod, clampToPeriod } from "../src/domain/period.js";
import { whatIfLadder, salaryVerdict, ladderGoalsFrom } from "../src/domain/what-if.js";
import { summariseForMasthead } from "../src/ui/lib/instrument.js";
import { STARTER_LIFESTYLE_GROUPS } from "../src/domain/lifestyle-groups.js";
import { statementCents } from "../src/domain/income-statement.js";

const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type Figures = Record<string, number>;
/** Two figures, or two cases, were given the same id: the later one would hide the earlier. */
class DuplicateId extends Error {}

function amounts(out: Figures, prefix: string, row: Pick<MonthTotals, "budgetCents" | "spentCents" | "leftCents">) {
  if (row.budgetCents !== null) out[prefix + "/budget"] = row.budgetCents;
  out[prefix + "/actual"] = row.spentCents;
  if (row.leftCents !== null) out[prefix + "/left"] = row.leftCents;
}

async function snapshot(base: string, date?: string): Promise<Snapshot> {
  process.env.LOCALAPPDATA = base;
  process.env.FINANCE_NO_AUTOSYNC = "1";
  const read = await import("../server/services/readService.js");
  const { sqliteFinanceRepository } = await import("../server/repositories/sqliteFinanceRepository.js");
  const { trailingSpend } = await import("../server/services/trailingService.js");
  const { budgetChangeService } = await import("../server/services/budgetChangeService.js");
  const repo = sqliteFinanceRepository();
  const transactions = read.getTransactions();
  const accounts = read.getAccounts();
  const mapping = read.getCategoryMappings();
  const adjustments = read.getTransactionAdjustments();
  const marks = read.listMaaserMarks();
  const prepared = prepareTransactions(transactions, { rules: repo.getCategorizationRules(), adjustments, accounts, mapping });
  const budgetPrepared = prepareForRollup(transactions, adjustments, accounts, mapping);
  const rollups = rollupMonthly(prepared, accounts, mapping);
  const today = date ?? prepared.reduce((max, t) => max > t.date ? max : t.date, "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || new Date(today).toISOString().slice(0, 10) !== today) throw Error();
  const month = today.slice(0, 7);
  const cases: Snapshot["cases"] = {};
  const group = (id: string): Figures => {
    if (Object.hasOwn(cases, id)) throw new DuplicateId();
    const figures: Figures = cases[id] = {};
    return new Proxy(figures, {
      set(target, key, value) {
        if (typeof key !== "string" || Object.hasOwn(target, key)) throw new DuplicateId();
        target[key] = value;
        return true;
      },
    });
  };
  const balances = read.getAccountBalances();
  const plans = read.listPlans().sort((a, b) => order(a.id, b.id));
  const lines = new Map(plans.map(p => [p.id, read.getBudgetLines(p.id)]));
  const salary = read.getSalarySettings();
  // What the screens read: the saved groups, else the starter groups.
  const lifestyleGroups = (await import("../server/services/settingsService.js")).getLifestyleGroupsStored() ?? STARTER_LIFESTYLE_GROUPS;
  const settings = read.getCategorySettings();
  const goals = read.listGoals();
  const ladderGoals = ladderGoalsFrom(goals, { accounts, balances, links: read.listGoalAccountLinks(), txns: transactions }, today);
  const next = addMonths(month, 1);
  const active = currentPlan(plans, today);
  // The same extras the screens read (changes, big months, notes), once per plan.
  const changeService = budgetChangeService(() => new Date(today + "T12:00:00"));
  const extras = new Map(plans.map(p => [p.id, changeService.extras(p.id)]));
  let scenarioIndex = 0;
  for (const plan of plans) {
    const year = plan.startDate.slice(0, 4);
    const sameYear = plans.filter(p => p.startDate.startsWith(year));
    const suffix = sameYear.length > 1 ? "-plan-" + (sameYear.indexOf(plan) + 1) : "";
    const out = group("budget-" + year + suffix);
    const budgetLines = lines.get(plan.id)!;
    const inputs = { prepared: budgetPrepared, accounts, mapping, salary, settings, lines: budgetLines, ...extras.get(plan.id)! };
    const names = [...new Set([...budgetLines.map(l => l.planningCategory), ...rollups.map(r => r.planningCategory)])].sort();
    const ordinal = (name: string) => {
      if (!names.includes(name)) names.push(name);
      return names.indexOf(name) + 1;
    };
    for (const line of budgetLines.filter(l => l.period === null)) out["line-" + ordinal(line.planningCategory) + "/every-month"] = line.amountCents;
    for (let i = 1; i <= 12; i++) {
      const mm = String(i).padStart(2, "0");
      const view = buildMonthView({ ...inputs, month: year + "-" + mm, today, sort: "group", compare: "last-month" });
      amounts(out, "m" + mm + "/left-over", view.leftOver);
      for (const section of view.sections) {
        amounts(out, "m" + mm + "/" + section.id, section.subtotal);
        for (const row of section.rows) amounts(out, "line-" + ordinal(row.line) + "/" + row.side + "/m" + mm, row);
      }
    }
    for (const w of read.listWhatIfs(plan.id).sort((a, b) => order(a.scenarioId, b.scenarioId))) {
      const out = group("what-if-" + ++scenarioIndex);
      const ladder = whatIfLadder(w, budgetLines, ladderGoals, next, salary, lifestyleGroups);
      out.needed = ladder.salaryToLiveAndHitGoalsCents;
      const actual = ladder.statements?.yourIncome;
      if (actual) out.left = salaryVerdict(ladder, actual.grossAnnualCents, salary, { whatIf: w, baseLines: budgetLines, currentSalary: actual.whose === "current" }).leftOverMonthlyCents;
    }
  }
  const salaryOut = group("salary");
  if (active) {
    const ladder = whatIfLadder({ scenarioId: "", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] }, lines.get(active.id)!, ladderGoals, next, salary, lifestyleGroups);
    salaryOut["needed-ladder"] = ladder.salaryToLiveCents;
    const statement = ladder.statements?.yourIncome?.statement;
    if (statement) {
      salaryOut.takeHome = statementCents(statement.yearly, "take-home");
      for (const period of ["monthly", "yearly"] as const) statement[period].forEach((line, i) => {
        if (!line.heading) salaryOut[period + "/line-" + (i + 1)] = line.cents;
      });
    }
  }

  const summary = summariseForMasthead({
    accounts, balances, budgetLines: active ? lines.get(active.id)! : [], categorySettings: settings,
    uncategorizedCount: 0, ruleCount: repo.getCategorizationRules().length, lastSyncedAt: null,
    asOfDate: today, salaryAssumptions: salary, lifestyleGroups, goals, goalLinks: read.listGoalAccountLinks(),
    transactions
  });
  if (summary.salary) salaryOut["needed-top-bar"] = summary.salary.grossAnnualCents;
  const trailing = trailingSpend(12, () => new Date(today + "T12:00:00"));
  for (let i = 0; i < 4; i++) {
    const m = addMonths(month, -i);
    const day = i === 0 ? today : monthBounds(m).to;
    const spend = spentMonthToDate(prepared, accounts, mapping, day);
    const income = incomeMonthToDate(prepared, accounts, mapping, day);
    const plan = planForMonth(plans, m);
    // The six small Dashboard tiles stay on today when the month picker moves.
    const out = group("dashboard-" + m);
    Object.assign(out, { spent: spend.cents, left: spend.leftOverCents, saving: spend.savingCents, income: income.cents, investment: income.investmentIncomeCents, trailing: trailing.monthlyAverageCents });
    Object.assign(out, {
      drawable: summary.reading.drawableCents, monthlyBudget: summary.reading.burnCents,
      heldBack: summary.heldBackCents, recurring: summary.recurringCents, variable: summary.variableCents
    });
    if (spend.baseline) out.priorSpent = spend.baseline.cents;
    if (income.baseline) out.priorIncome = income.baseline.cents;
    spend.topCategories.forEach((r, i) => { out["top-category-" + (i + 1)] = r.cents; });
    income.topSources.forEach((r, i) => { out["top-source-" + (i + 1)] = r.cents; });
    if (plan) out.budget = monthBudgetCents(lines.get(plan.id)!, m, extras.get(plan.id)!.bigMonths);
  }

  const forecast = group("forecast");
  if (active) {
    const months = Array.from({ length: 12 }, (_, i) => addMonths(month, i + 1));
    const projection = cashForecast({ budgetLines: linesAcrossPlans(plans, lines, months), asOfDate: today, assumptions: salary, goals, horizonMonths: 12, bigMonths: plans.flatMap(p => extras.get(p.id)!.bigMonths) });
    const runway = computeRunway(drawableLiquidCents(accounts, balances), projection);
    for (const p of projection) {
      forecast[p.period + "/income"] = p.incomeCents;
      forecast[p.period + "/cost"] = p.costCents;
      forecast[p.period + "/net"] = p.netCents;
    }
    for (const p of runway.liquidByMonth) forecast[p.period + "/balance"] = p.cents;
  }
  const rawAccounts = read.getAccountsManage().sort((a, b) => order(a.id, b.id));
  for (const include of [true, false]) {
    const out = group("net-worth-" + (include ? "included" : "excluded"));
    out.total = netWorthCents(rawAccounts, balances, include);
    for (const r of netWorthRows(rawAccounts, balances, include)) out["account-" + (1 + rawAccounts.indexOf(r.account))] = r.cents;
  }
  const years = new Set([...plans.map(p => p.startDate.slice(0, 4)), ...prepared.map(t => t.date.slice(0, 4))]);
  for (const year of [...years].sort()) {
    const ledger = maaserLedger({ prepared: budgetPrepared, accounts, mapping, marks, maaserRate: salary.maaserRate, ...(salary.pot !== undefined ? { pot: salary.pot } : {}), from: year + "-01-01", to: year < today.slice(0, 4) ? year + "-12-31" : today, availableCents: null });
    Object.assign(group("charity-" + year), { owed: ledger.owedCents, setAside: ledger.setAsideCents, given: ledger.givenCents, paidBack: ledger.reimbursedCents });
  }
  const report = group("reports");
  const ledger = group("ledger");
  const categories = [...new Set(rollups.map(r => r.planningCategory))].sort();
  const rows = toRows(prepared, accounts, mapping);
  const scoped = { ...EMPTY_FILTER, countedAccountsOnly: true };
  const total = (filter: typeof scoped) => ledgerTotal(filterRows(rows, filter));
  function ledgerRange(key: string, range: { from?: string | null; to?: string | null }) {
    const selected = filterRows(rows, { ...scoped, ...range });
    const sums = ledgerTotal(selected);
    ledger[key + "/income"] = sums.incomeCents;
    ledger[key + "/expense"] = sums.expenseCents;
    ledger[key + "/net"] = sums.netCents;
    for (const category of new Set(selected.map(r => r.planningCategory))) {
      const index = categories.indexOf(category);
      if (index < 0) continue;
      for (const kind of ["income", "expense"] as const) {
        const sum = ledgerTotal(filterRows(selected, { ...EMPTY_FILTER, categories: [category], kind }));
        ledger[key + "/category-" + (index + 1) + "/" + kind] = kind === "income" ? sum.incomeCents : sum.expenseCents;
      }
    }
  }
  const reportRollups = rollupMonthly(prepared.filter(t => t.date.slice(0, 10) <= today), accounts, mapping);
  for (const r of reportRollups) {
    if (r.period >= addMonths(month, -23) && r.period <= month) report[r.period + "/category-" + (categories.indexOf(r.planningCategory) + 1) + "/" + r.kind] = r.amountCents;
  }
  const periods = [...new Set(rollups.map(r => r.period))].sort();
  // Unbounded, as the tie-out check reads it; the "all" preset below stops at today.
  ledgerRange("unbounded", {});
  for (const m of periods) ledgerRange(m, monthBounds(m));
  ledger.trailing = total({ ...scoped, kind: "expense", from: monthBounds(addMonths(month, -12)).from, to: monthBounds(addMonths(month, -1)).to }).expenseCents;
  const ranges = [...PERIOD_PRESETS.map(p => resolvePeriod(p.id, today)), customPeriod(addMonths(month, -5) + "-10", addMonths(month, -1) + "-19")];
  for (const p of ranges) {
    ledgerRange(p.preset, p);
    for (const m of periods) {
      const clipped = clampToPeriod(monthBounds(m), p);
      if (clipped.from <= clipped.to) ledgerRange(p.preset + "/" + m, clipped);
    }
    if (p.preset === "custom") continue;
    for (const opt of COMPARE_OPTIONS) {
      const base = baselineFor(p, opt.id);
      if (!base) continue;
      const key = p.preset + "/" + opt.id;
      if (base.ledgerRange) ledgerRange(key, base.ledgerRange);
      const sums = sumForBaseline(prepared, accounts, mapping, base);
      ledger[key + "/shown-income"] = sums.incomeCents;
      ledger[key + "/shown-expense"] = sums.expenseCents;
      for (const [categoryKey] of sums.rawByCategory) {
        const separator = categoryKey.indexOf("|");
        const category = categories.indexOf(categoryKey.slice(separator + 1));
        if (category >= 0) ledger[key + "/shown-category-" + (category + 1) + "/" + categoryKey.slice(0, separator)] = baselineOf(sums, [categoryKey]);
      }
      baselineSegments(p, opt.id)?.forEach((segment, i) => {
        const sums = sumForBaseline(prepared, accounts, mapping, { ranges: segment.ranges, divideBy: 1 });
        ledger[key + "/marker-" + i + "/income"] = sums.incomeCents;
        ledger[key + "/marker-" + i + "/expense"] = sums.expenseCents;
      });
    }
  }
  const db = new Database(join(base, "finance", "finance.db"), { readonly: true, fileMustExist: true });
  try {
    const counts = group("row-counts");
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table'  AND name <> '_migrations' ORDER BY name").pluck().all() as string[];
    for (const table of tables) counts[table] = db.prepare('SELECT count(*) FROM "' + table.replace(/"/g, '""') + '"').pluck().get() as number;
  } finally { db.close(); }
  for (const [key, values] of Object.entries(cases)) cases[key] = Object.fromEntries(Object.entries(values).sort(([a], [b]) => order(a, b)));
  return { today, cases };
}

// The app migrates and switches the journal of whatever it opens, so it only ever
// opens a duplicate in a fresh temporary folder; the folder given is never changed.
// The figures are read in a child process: when it ends, every handle it opened is
// closed, so the duplicate can always be removed, even when opening it failed.
// The child makes its own duplicate (mkdtemp in the system temp folder) from the folder
// the parent names, and tells the parent where it is so the parent can remove it. No
// folder is ever chosen through an environment variable for opening.
const isChild = process.env.FIGURES_SNAPSHOT_CHILD === "1";
if (isChild) {
  let work: string | undefined;
  try {
    const [folder, out, , date] = process.argv.slice(2);
    // Without a connected parent nobody would remove the copy, so none is made.
    if (!process.send || !process.connected) throw Error();
    const base = assertCopyFolder(folder, "Supply a database copy folder.");
    work = mkdtempSync(join(tmpdir(), "figures-snapshot-"));
    process.send?.({ work });
    mkdirSync(join(work, "finance"));
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = join(base, "finance", "finance.db" + suffix);
      if (existsSync(file)) copyFileSync(file, join(work, "finance", "finance.db" + suffix));
    }
    const result = await snapshot(work, date);
    const groups = Object.values(result.cases);
    if (groups.some(g => Object.values(g).some(v => !Number.isFinite(v)))) throw Error();
    writeFileSync(out, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    console.log(`cases: ${groups.length}, figures: ${groups.reduce((n, g) => n + Object.keys(g).length, 0)}`);
  } catch (error) {
    console.error(error instanceof DuplicateId
      ? "Snapshot failed: two figures were given the same id."
      : "Snapshot failed. Check the copy, the date (--today YYYY-MM-DD), and that the output path is new.");
    process.exitCode = 2;
  }
} else {
  let work: string | undefined;
  try {
    const [folder, out, flag, date, ...extra] = process.argv.slice(2);
    assertCopyFolder(folder, "Supply a database copy folder.");
    if (!out || extra.length || (flag !== undefined && (flag !== "--today" || !date))) throw Error();
    const env = { ...process.env, FIGURES_SNAPSHOT_CHILD: "1" };
    delete env.FIGURES_SNAPSHOT_WORK;
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1], ...process.argv.slice(2)], {
      stdio: ["inherit", "inherit", "inherit", "ipc"], env,
    });
    child.on("message", (m: { work?: string }) => { if (typeof m?.work === "string") work = m.work; });
    const status = await new Promise<number | null>(done => { child.on("error", () => done(null)); child.on("close", code => done(code)); });
    if (status !== 0) process.exitCode = 2;
  } catch {
    console.error("Snapshot failed. Check the copy, the date (--today YYYY-MM-DD), and that the output path is new.");
    process.exitCode = 2;
  } finally {
    // Only a folder the child made, directly inside the system temp folder, is removed.
    if (work && dirname(resolve(work)).toLowerCase() === resolve(tmpdir()).toLowerCase() && basename(work).startsWith("figures-snapshot-")) {
      try { rmSync(work, { recursive: true, force: true, maxRetries: 5 }); } catch {
        console.error("Could not remove the temporary copy at " + work + ".");
        process.exitCode = 2;
      }
    }
  }
}
