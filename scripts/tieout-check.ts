// scripts/tieout-check.ts
//
// Proves the click-through rule on real data: every figure Reports, Budget, and
// the Dashboard's trailing tile can link from equals the total of the ledger
// the link opens, to the cent.
//
//   npx tsx scripts/tieout-check.ts <folder>
//
// <folder> stands in for %LOCALAPPDATA% and must hold a COPY of the database at
// <folder>\finance\finance.db. The script refuses to run against the live
// folder. It prints COUNTS ONLY: no category name, payee, or amount ever
// reaches the terminal, a log, or a commit. A mismatch is reported by its
// month and the ordinal of its category, which is enough to find it locally.
import { assertCopyFolder } from "./lib/copy-guard.js";
const copyBase = assertCopyFolder(process.argv[2], "Usage: tieout-check <copy folder>");
// Every server module resolves the database through LOCALAPPDATA, so this must
// be set BEFORE they are imported. Hence the dynamic imports below.
process.env.LOCALAPPDATA = copyBase;
process.env.FINANCE_NO_AUTOSYNC = "1";

const { sqliteFinanceRepository } = await import("../server/repositories/sqliteFinanceRepository.js");
const { getIncludePartnerAccounts } = await import("../server/services/settingsService.js");
const { withEffectiveInclude } = await import("../src/domain/account-filter.js");
const { prepareTransactions } = await import("../src/domain/pipeline.js");
const { applyRules } = await import("../src/domain/rules.js");
const { matchTransfers } = await import("../src/domain/transfers.js");
const { applyAdjustments } = await import("../src/domain/adjustments.js");
const { rollupMonthly } = await import("../src/domain/rollups.js");
const { cashFlowByMonth, incomeByCategoryOverTime, spendingByCategoryOverTime } = await import("../src/domain/reports.js");
const { PERIOD_PRESETS, clampToPeriod, customPeriod, inPeriod, monthBounds, monthIndex, periodFromIndex, resolvePeriod } = await import("../src/domain/period.js");
const { EMPTY_FILTER, filterRows, ledgerTotal, toRows, withRunningTotal } = await import("../src/domain/transactions-view.js");
const { COMPARE_OPTIONS, baselineFor, baselineOf, baselineSegments, sumForBaseline } = await import("../src/domain/compare.js");

const repo = sqliteFinanceRepository();
const accounts = withEffectiveInclude(repo.getAccounts(), getIncludePartnerAccounts());
const mapping = repo.getCategoryMappings();
const prepared = prepareTransactions(repo.getTransactions(), {
  rules: repo.getCategorizationRules(),
  adjustments: repo.getTransactionAdjustments(),
});
const rollups = rollupMonthly(prepared, accounts, mapping);
const rows = toRows(prepared, accounts, mapping);
const scoped = { ...EMPTY_FILTER, countedAccountsOnly: true };

const categoryOrdinal = new Map<string, number>();
const ordinal = (category: string) => {
  if (!categoryOrdinal.has(category)) categoryOrdinal.set(category, categoryOrdinal.size + 1);
  return categoryOrdinal.get(category)!;
};

interface Check { name: string; checked: number; tied: number; misses: string[] }
const checks: Check[] = [];
function check(name: string): Check {
  const c = { name, checked: 0, tied: 0, misses: [] as string[] };
  checks.push(c);
  return c;
}
function record(c: Check, ok: boolean, where: string) {
  c.checked++;
  if (ok) c.tied++;
  else if (c.misses.length < 10) c.misses.push(where);
}

// 1. Every category-by-month cell (Reports cells, and what a Budget Actual cell is built from).
const cells = check("Reports category-by-month cells");
for (const r of rollups) {
  const ledger = filterRows(rows, { ...scoped, categories: [r.planningCategory], kind: r.kind, ...monthBounds(r.period) });
  const total = ledgerTotal(ledger);
  const header = r.kind === "expense" ? total.expenseCents : total.incomeCents;
  const running = withRunningTotal(ledger, r.kind).at(-1)?.runningCents ?? 0;
  const ok =
    header === r.amountCents &&
    ledger.every((row) => row.kind === r.kind) &&
    running === r.amountCents;
  record(cells, ok, `${r.period} category #${ordinal(r.planningCategory)} ${r.kind}`);
}

// 2. Every category total across all time.
const totals = check("Reports category totals");
for (const [kind, result] of [
  ["expense", spendingByCategoryOverTime(rollups)],
  ["income", incomeByCategoryOverTime(rollups)],
] as const) {
  for (const s of result.series) {
    const total = ledgerTotal(filterRows(rows, { ...scoped, categories: [s.category], kind }));
    record(totals, (kind === "expense" ? total.expenseCents : total.incomeCents) === s.total, `category #${ordinal(s.category)} ${kind}`);
  }
}

// 3. Every month's income, expense, and net (cash-flow tab and the bottom Total row).
const months = check("Cash-flow income, expense, and net per month");
const cashflow = cashFlowByMonth(rollups);
for (const m of cashflow) {
  const bounds = monthBounds(m.period);
  record(months, ledgerTotal(filterRows(rows, { ...scoped, kind: "income", ...bounds })).incomeCents === m.incomeCents, `${m.period} income`);
  record(months, ledgerTotal(filterRows(rows, { ...scoped, kind: "expense", ...bounds })).expenseCents === m.expenseCents, `${m.period} expense`);
  record(months, ledgerTotal(filterRows(rows, { ...scoped, ...bounds })).netCents === m.netCents, `${m.period} net`);
}

// 4. Budget Actual cells. forecast.ts indexes actuals by month and category
//    WITHOUT the income/spending side. Where one category carries both sides in
//    one month, a Budget cell and its ledger cannot both be right.
const byMonthCategory = new Map<string, Set<string>>();
for (const r of rollups) {
  const key = `${r.period}|${r.planningCategory}`;
  byMonthCategory.set(key, (byMonthCategory.get(key) ?? new Set()).add(r.kind));
}
const collisions = [...byMonthCategory.entries()].filter(([, kinds]) => kinds.size > 1);

// 5. The Dashboard trailing tile: the 12 complete months before the newest month of data.
const trailing = check("Trailing 12 months of spending");
if (cashflow.length > 0) {
  const newest = monthIndex(cashflow[cashflow.length - 1].period);
  const window = Array.from({ length: 12 }, (_, i) => periodFromIndex(newest - 12 + i));
  const figure = cashflow.filter((m) => window.includes(m.period)).reduce((sum, m) => sum + m.expenseCents, 0);
  const ledger = ledgerTotal(filterRows(rows, { ...scoped, kind: "expense", from: monthBounds(window[0]).from, to: monthBounds(window[11]).to }));
  record(trailing, ledger.expenseCents === figure, "trailing window");
}

// 6. Every period the picker offers, as of the newest transaction, plus a period
//    that starts and ends mid-month. A month column cut short by the period links
//    to a ledger cut at the same day; totals link with the period's own dates.
const newestDate = prepared.reduce((max, t) => (t.date > max ? t.date : max), "0000-00-00").slice(0, 10);
const midMonth = customPeriod(`${periodFromIndex(monthIndex(newestDate.slice(0, 7)) - 5)}-10`, `${periodFromIndex(monthIndex(newestDate.slice(0, 7)) - 1)}-19`);
const periods = [...PERIOD_PRESETS.map((preset) => resolvePeriod(preset.id, newestDate)), midMonth];
for (const period of periods) {
  const c = check(`Period "${period.preset === "custom" ? "mid-month to mid-month" : period.preset}"`);
  const inside = rollupMonthly(prepared.filter((t) => inPeriod(t.date, period)), accounts, mapping);
  for (const r of inside) {
    const ledger = ledgerTotal(filterRows(rows, { ...scoped, categories: [r.planningCategory], kind: r.kind, ...clampToPeriod(monthBounds(r.period), period) }));
    record(c, (r.kind === "expense" ? ledger.expenseCents : ledger.incomeCents) === r.amountCents, `${r.period} category #${ordinal(r.planningCategory)} ${r.kind}`);
  }
  for (const [kind, result] of [
    ["expense", spendingByCategoryOverTime(inside)],
    ["income", incomeByCategoryOverTime(inside)],
  ] as const) {
    let grand = 0;
    for (const series of result.series) {
      grand += series.total;
      const ledger = ledgerTotal(filterRows(rows, { ...scoped, categories: [series.category], kind, from: period.from, to: period.to }));
      record(c, (kind === "expense" ? ledger.expenseCents : ledger.incomeCents) === series.total, `total category #${ordinal(series.category)} ${kind}`);
    }
    const all = ledgerTotal(filterRows(rows, { ...scoped, kind, from: period.from, to: period.to }));
    record(c, (kind === "expense" ? all.expenseCents : all.incomeCents) === grand, `grand total ${kind}`);
  }
  for (const m of cashFlowByMonth(inside)) {
    const net = ledgerTotal(filterRows(rows, { ...scoped, ...clampToPeriod(monthBounds(m.period), period) }));
    record(c, net.netCents === m.netCents && net.incomeCents === m.incomeCents && net.expenseCents === m.expenseCents, `${m.period} cash flow`);
  }
}

// 7. Comparisons. Wherever a baseline can open as one ledger, every baseline
//    figure equals that ledger's total (divided by the months, for an average).
//    And the month-by-month marker adds up to the whole baseline.
const baselines = check("Baseline figures against their ledgers, every preset and comparison");
const markers = check("Month-by-month markers adding up to the whole baseline");
for (const preset of PERIOD_PRESETS) {
  const period = resolvePeriod(preset.id, newestDate);
  for (const option of COMPARE_OPTIONS) {
    const baseline = baselineFor(period, option.id);
    if (!baseline) continue;
    const sums = sumForBaseline(prepared, accounts, mapping, baseline);
    if (baseline.ledgerRange) {
      for (const key of sums.rawByCategory.keys()) {
        const [kind, category] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)] as ["expense" | "income", string];
        const ledger = ledgerTotal(filterRows(rows, { ...scoped, categories: [category], kind, ...baseline.ledgerRange }));
        const shown = Math.round((kind === "expense" ? ledger.expenseCents : ledger.incomeCents) / baseline.divideBy);
        record(baselines, shown === baselineOf(sums, [key]), `${preset.id} ${option.id} category #${ordinal(category)} ${kind}`);
      }
      for (const kind of ["expense", "income"] as const) {
        const ledger = ledgerTotal(filterRows(rows, { ...scoped, kind, ...baseline.ledgerRange }));
        const shown = Math.round((kind === "expense" ? ledger.expenseCents : ledger.incomeCents) / baseline.divideBy);
        record(baselines, shown === (kind === "expense" ? sums.expenseCents : sums.incomeCents), `${preset.id} ${option.id} total ${kind}`);
      }
    }
    const segments = baselineSegments(period, option.id);
    if (segments) {
      // Undivided cents, so rounding cannot hide a mismatch.
      let expense = 0;
      let income = 0;
      for (const segment of segments) {
        const part = sumForBaseline(prepared, accounts, mapping, { ranges: segment.ranges, divideBy: 1 });
        expense += part.expenseCents;
        income += part.incomeCents;
      }
      const whole = sumForBaseline(prepared, accounts, mapping, { ranges: baseline.ranges, divideBy: 1 });
      record(markers, expense === whole.expenseCents && income === whole.incomeCents, `${preset.id} ${option.id}`);
    }
  }
}

// 8. The Budget and the ledger prepare transactions by different routes. The
//    server sends rows with rules and transfer matching applied. The Budget adds
//    adjustments. Reports and the ledger run the whole pipeline again in the
//    browser, so rules and matching run TWICE. The two agree only if that second
//    run changes nothing. If it does, a Budget Actual cell cannot tie to its ledger.
const twice = check("Budget route equals ledger route (rules and transfer matching applied twice change nothing)");
{
  const ruleSet = repo.getCategorizationRules();
  const adjustmentSet = repo.getTransactionAdjustments();
  const sentByServer = matchTransfers(applyRules(repo.getTransactions(), ruleSet));
  const budgetRoute = rollupMonthly(applyAdjustments(sentByServer, adjustmentSet), accounts, mapping);
  const ledgerRoute = rollupMonthly(prepareTransactions(sentByServer, { rules: ruleSet, adjustments: adjustmentSet }), accounts, mapping);
  const key = (r: { period: string; planningCategory: string; kind: string }) => `${r.period}|${r.planningCategory}|${r.kind}`;
  const ledgerByKey = new Map(ledgerRoute.map((r) => [key(r), r.amountCents]));
  for (const r of budgetRoute) {
    record(twice, ledgerByKey.get(key(r)) === r.amountCents, `${r.period} category #${ordinal(r.planningCategory)} ${r.kind}`);
    ledgerByKey.delete(key(r));
  }
  for (const leftover of ledgerByKey.keys()) record(twice, false, `only on the ledger route: ${leftover.split("|")[0]}`);
}

console.log(`Transactions: ${rows.length}. Months: ${cashflow.length}. Categories: ${new Set(rollups.map((r) => r.planningCategory)).size}.`);
let failed = false;
for (const c of checks) {
  const missed = c.checked - c.tied;
  if (missed > 0) failed = true;
  console.log(`${missed === 0 ? "TIES " : "MISS "} ${c.name}: ${c.tied} of ${c.checked} tie out${missed ? `, ${missed} do not` : ""}`);
  for (const where of c.misses) console.log(`        ${where}`);
}
console.log(
  `${collisions.length === 0 ? "CLEAR" : "RISK "} Budget Actual month-and-category cells carrying BOTH income and spending: ${collisions.length} of ${byMonthCategory.size}`
);
for (const [key] of collisions.slice(0, 10)) {
  const [period, category] = key.split("|");
  console.log(`        ${period} category #${ordinal(category)}`);
}
process.exit(failed ? 1 : 0);
