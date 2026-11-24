// cli/finance.ts
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { NodeRepository } from "../src/data/repo.node.js";
import { rollupMonthly } from "../src/domain/rollups.js";
import { prepareTransactions } from "../src/domain/pipeline.js";
import { buildForecast } from "../src/domain/forecast.js";
import { parseDollarsToCents, formatCents } from "../src/domain/money.js";
import { goalStatus, goalFunding, goalThisMonthCents, goalLinkConflict, formatProgressPct, isGoalType, GOAL_TEMPLATES } from "../src/domain/goals.js";
import { withEffectiveInclude } from "../src/domain/account-filter.js";
import { householdFromSetting, includePartnerFromSetting, HOUSEHOLD_KEY, INCLUDE_PARTNER_KEY } from "../src/domain/household.js";
import { rememberHouseholdPeople } from "../src/domain/account-display.js";
import { drawableLiquidCents, computeRunway } from "../src/domain/runway.js";
import type { ForecastResult, Goal, GoalAccountLink, WishlistItem } from "../src/domain/plan-types.js";
import { APP_USAGE, isRefusal, runAppVerb } from "./app-verbs.js";

import { OlderDatabaseError } from "../src/data/migrate.node.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function defaultDb(): string {
  const base = process.env.LOCALAPPDATA || process.env.HOME || ".";
  return join(base, "finance", "finance.db");
}
function openRepo(): NodeRepository {
  const db = arg("--db") ?? defaultDb();
  mkdirSync(dirname(db), { recursive: true });
  try {
    const repo = new NodeRepository(db);
    // Account names drop the household's own names, as the screens show them.
    rememberHouseholdPeople(householdFromSetting(repo.getSetting(HOUSEHOLD_KEY)));
    return repo;
  } catch (error) {
    if (!(error instanceof OlderDatabaseError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
// The screens read accounts through GET /api/accounts, which applies the
// include-the-partner's-accounts setting. Every figure the CLI computes reads
// them the same way, or its numbers disagree with the app's. `account list`
// alone reads them raw, because it shows the stored switches.
/** Monthly actuals from prepared rows: rules, the transfer matcher and the user's corrections first, as the screens do. */
function preparedActuals(repo: NodeRepository) {
  const accounts = effectiveAccounts(repo);
  const mapping = repo.getCategoryMappings();
  const prepared = prepareTransactions(repo.getTransactions(), { rules: repo.getCategorizationRules(), adjustments: repo.getTransactionAdjustments(), accounts, mapping });
  return rollupMonthly(prepared, accounts, mapping);
}

function effectiveAccounts(repo: NodeRepository) {
  return withEffectiveInclude(repo.getAccounts(), includePartnerFromSetting(repo.getSetting(INCLUDE_PARTNER_KEY)));
}

function renderForecastTable(result: ForecastResult): string {
  const lines: string[] = [];
  for (const m of result.months) {
    for (const c of m.cells) {
      lines.push(
        `${m.period}  ${c.planningCategory.padEnd(20)} actual=${formatCents(c.actualCents)} plan=${formatCents(c.planCents)} forecast=${formatCents(c.forecastCents)} variance=${formatCents(c.varianceCents)}`
      );
    }
  }
  lines.push(`TOTAL income=${formatCents(result.totals.incomeForecastCents)} expense=${formatCents(result.totals.expenseForecastCents)} surplus=${formatCents(result.totals.surplusForecastCents)}`);
  return lines.join("\n");
}

const USAGE = `${APP_USAGE}

Against the database file itself (the app need not run; --db <path> for another file):
  finance actuals rollup [--db <path>] [--json]
  finance plan create <id> <name> <start YYYY-MM-DD> <end YYYY-MM-DD> [--db <path>]
  finance plan list [--db <path>] [--json]
  finance budget set <planId> <category> <dollars> [--period YYYY-MM] [--db <path>]
  finance forecast <planId> [--db <path>] [--json]
  finance account list [--db <path>] [--json]
  finance account exclude <accountId> [--db <path>]
  finance account include <accountId> [--db <path>]
  finance goal add <id> <name> <targetDollars> [targetDate YYYY-MM-DD] [--type <template>] [--planned <dollars>] [--priority N] [--current <dollars>] [--notes <text>] [--db <path>]
  finance goal list [--db <path>] [--json]
  finance goal link <goalId> <accountId> entire|fixed [<dollars>] [--db <path>]
  finance goal unlink <goalId> <accountId> [--db <path>]
  finance wishlist add <id> <name> <costDollars> [--priority N] [--db <path>]
  finance wishlist list [--db <path>] [--json]
  finance runway <planId> [--db <path>] [--json]`;

const [cmd, sub, ...rest] = process.argv.slice(2);

// The app verbs first (cli/app-verbs.ts): they talk to the running app, as the screens do.
let handledByApp = false;
try {
  handledByApp = await runAppVerb(process.argv.slice(2), {
    base: `http://127.0.0.1:${arg("--port") ?? process.env.FINANCE_PORT ?? "4321"}`,
    dryRun: process.argv.includes("--dry-run"),
    out: (line) => console.log(line),
  });
} catch (e) {
  if (!isRefusal(e)) throw e;
  console.error(e.message);
  // Not process.exit(): on Windows, exiting while a fetch socket is still closing trips a
  // libuv assertion (UV_HANDLE_CLOSING) and the process can hang. The exit code is set and
  // the loop drains on its own.
  process.exitCode = 1;
  handledByApp = true;
}

if (handledByApp) {
  // Done.
} else if (cmd === "actuals" && sub === "rollup") {
  const repo = openRepo();
  const rollups = preparedActuals(repo);
  if (process.argv.includes("--json")) console.log(JSON.stringify(rollups, null, 2));
  else for (const r of rollups) console.log(`${r.period}  ${r.planningCategory.padEnd(20)} ${r.kind === "expense" ? "-" : "+"}${r.amountCents}`);
} else if (cmd === "plan" && sub === "create") {
  const [id, name, startDate, endDate] = rest;
  if (!id || !name || !startDate || !endDate) {
    console.error(USAGE);
    process.exit(1);
  }
  const repo = openRepo();
  const plan = repo.createPlan({ id, name, startDate, endDate });
  console.log(JSON.stringify(plan));
} else if (cmd === "plan" && sub === "list") {
  const repo = openRepo();
  const plans = repo.listPlans();
  if (process.argv.includes("--json")) console.log(JSON.stringify(plans, null, 2));
  else for (const p of plans) console.log(`${p.id}  ${p.name.padEnd(24)} ${p.startDate} .. ${p.endDate}`);
} else if (cmd === "budget" && sub === "set") {
  const [planId, category, dollars] = rest;
  if (!planId || !category || !dollars) {
    console.error(USAGE);
    process.exit(1);
  }
  const repo = openRepo();
  const period = arg("--period") ?? null;
  const amountCents = parseDollarsToCents(dollars);
  repo.setBudgetLine({ planId, planningCategory: category, period, amountCents });
  console.log(JSON.stringify({ planId, planningCategory: category, period, amountCents }));
} else if (cmd === "forecast") {
  const planId = sub;
  if (!planId) {
    console.error(USAGE);
    process.exit(1);
  }
  const repo = openRepo();
  const plan = repo.getPlan(planId);
  if (!plan) {
    console.error(`No such plan: ${planId}`);
    process.exit(1);
  }
  const actuals = preparedActuals(repo);
  const asOf = new Date().toISOString().slice(0, 10);
  const result = buildForecast(plan, repo.getBudgetLines(planId), actuals, asOf);
  console.log(process.argv.includes("--json") ? JSON.stringify(result, null, 2) : renderForecastTable(result));
} else if (cmd === "account" && sub === "list") {
  const repo = openRepo();
  const accounts = repo.getAccounts().map((a) => ({
    id: a.id, name: a.name, institution: a.institution, includeInSpend: a.includeInSpend,
  }));
  if (process.argv.includes("--json")) console.log(JSON.stringify(accounts, null, 2));
  else for (const a of accounts) console.log(`${a.id}  ${(a.name ?? "").padEnd(24)} ${(a.institution ?? "").padEnd(20)} include_in_spend=${a.includeInSpend}`);
} else if (cmd === "account" && (sub === "exclude" || sub === "include")) {
  const [accountId] = rest;
  if (!accountId) {
    console.error(USAGE);
    process.exit(1);
  }
  const repo = openRepo();
  repo.setAccountIncludeInSpend(accountId, sub === "include");
  console.log(JSON.stringify({ id: accountId, includeInSpend: sub === "include" }));
} else if (cmd === "goal" && sub === "add") {
  const [id, name, targetDollars, maybeDate] = rest;
  if (!id || !name || !targetDollars) {
    console.error(USAGE);
    process.exit(1);
  }
  // The target date is optional (0018): positional if it looks like a date, else --date, else none.
  const targetDate = maybeDate && /^\d{4}-\d{2}-\d{2}$/.test(maybeDate) ? maybeDate : (arg("--date") ?? null);
  const goalType = arg("--type") ?? "savings";
  if (!isGoalType(goalType)) {
    console.error(`Unknown goal type "${goalType}". One of: ${GOAL_TEMPLATES.map((t) => t.type).join(", ")}`);
    process.exit(1);
  }
  const repo = openRepo();
  const currentDollars = arg("--current");
  const plannedDollars = arg("--planned");
  const goal: Goal = {
    id,
    name,
    goalType,
    targetAmountCents: parseDollarsToCents(targetDollars),
    targetDate,
    priority: Number(arg("--priority") ?? "0"),
    currentAmountCents: currentDollars ? parseDollarsToCents(currentDollars) : 0,
    plannedMonthlyCents: plannedDollars ? parseDollarsToCents(plannedDollars) : 0,
    notes: arg("--notes") ?? "",
    archivedAt: null,
  };
  repo.upsertGoal(goal);
  console.log(JSON.stringify(goal));
} else if (cmd === "goal" && sub === "list") {
  // Same composition the Goals tab makes: funding from linked accounts, then status.
  const repo = openRepo();
  const asOf = new Date().toISOString().slice(0, 10);
  const accounts = effectiveAccounts(repo);
  const balances = repo.getAccountBalances();
  const links = repo.listGoalAccountLinks();
  const txns = repo.getTransactions();
  const statuses = repo.listGoals().map((g) => {
    const funding = goalFunding(g, links, accounts, balances);
    const thisMonth = goalThisMonthCents(funding, txns, asOf.slice(0, 7));
    return { ...goalStatus(g, funding.savedCents, asOf, thisMonth), funding };
  });
  if (process.argv.includes("--json")) console.log(JSON.stringify(statuses, null, 2));
  else
    for (const s of statuses) {
      const needed = s.recommendedMonthlyCents === null ? "-" : formatCents(s.recommendedMonthlyCents);
      console.log(
        `${s.goal.id}  ${s.goal.name.padEnd(24)} saved=${formatCents(s.savedCents)} of ${formatCents(s.goal.targetAmountCents)} (${formatProgressPct(s.progressPct)}) planned=${formatCents(s.goal.plannedMonthlyCents)}/mo needed=${needed}/mo finish=${s.forecastPeriod ?? "-"} status=${s.status}${s.goal.archivedAt ? " archived" : ""}${costText(s.goal)}`
      );
    }
} else if (cmd === "goal" && (sub === "link" || sub === "unlink")) {
  const [goalId, accountId, mode, dollars] = rest;
  const badLink = sub === "link" && (!goalId || !accountId || (mode !== "entire" && mode !== "fixed") || (mode === "fixed" && !dollars));
  const badUnlink = sub === "unlink" && (!goalId || !accountId);
  if (badLink || badUnlink) {
    console.error(USAGE);
    process.exit(1);
  }
  const repo = openRepo();
  if (!repo.listGoals().some((g) => g.id === goalId)) {
    console.error(`No such goal: ${goalId}`);
    process.exit(1);
  }
  const others = repo.listGoalAccountLinks().filter((l) => l.goalId === goalId && l.accountId !== accountId);
  const next: GoalAccountLink[] =
    sub === "unlink"
      ? others
      : [...others, { goalId, accountId, mode: mode as GoalAccountLink["mode"], amountCents: mode === "fixed" ? parseDollarsToCents(dollars) : null }];
  const conflict = goalLinkConflict(goalId, next, repo.listGoalAccountLinks());
  if (conflict) {
    console.error(conflict);
    process.exit(1);
  }
  try {
    repo.replaceGoalAccountLinks(goalId, next);
  } catch (e: any) {
    const unique = typeof e?.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT") && /UNIQUE/.test(String(e.message));
    console.error(unique ? "That account already funds another goal with its entire balance." : String(e?.message ?? e));
    process.exit(1);
  }
  console.log(JSON.stringify(repo.listGoalAccountLinks().filter((l) => l.goalId === goalId)));
} else if (cmd === "wishlist" && sub === "add") {
  // One-time items: a name, a cost and a place in the order; never planned, dated or on a line.
  const [id, name, costDollars] = rest;
  if (!id || !name || !costDollars) {
    console.error(USAGE);
    process.exit(1);
  }
  const repo = openRepo();
  const item: WishlistItem = {
    id,
    name,
    costCents: parseDollarsToCents(costDollars),
    kind: "wish",
    targetDate: null,
    priority: Number(arg("--priority") ?? "0"),
    planningCategory: null,
  };
  repo.upsertWishlistItem(item);
  console.log(JSON.stringify(item));
} else if (cmd === "wishlist" && sub === "list") {
  const repo = openRepo();
  const items = repo.listWishlistItems();
  if (process.argv.includes("--json")) console.log(JSON.stringify(items, null, 2));
  else for (const i of items) console.log(`${i.priority}. ${i.name.padEnd(24)} cost=${formatCents(i.costCents)}`);
} else if (cmd === "runway") {
  const planId = sub;
  if (!planId) {
    console.error(USAGE);
    process.exit(1);
  }
  const repo = openRepo();
  const plan = repo.getPlan(planId);
  if (!plan) {
    console.error(`No such plan: ${planId}`);
    process.exit(1);
  }
  const actuals = preparedActuals(repo);
  const asOf = new Date().toISOString().slice(0, 10);
  const asOfMonth = asOf.slice(0, 7);
  const forecast = buildForecast(plan, repo.getBudgetLines(planId), actuals, asOf);
  const futureMonthlyNet = forecast.months.filter((m) => m.period > asOfMonth).map((m) => ({ period: m.period, netCents: m.netCents }));
  const startingLiquidCents = drawableLiquidCents(effectiveAccounts(repo), repo.getAccountBalances());
  const runway = computeRunway(startingLiquidCents, futureMonthlyNet);
  const result = runway;
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Starting liquid: ${formatCents(runway.startingLiquidCents)}`);
    for (const m of runway.liquidByMonth) console.log(`${m.period}  ${formatCents(m.cents)}`);
    console.log(
      runway.crossZeroPeriod
        ? `Runway: ${runway.runwayMonths} month(s), crosses zero in ${runway.crossZeroPeriod}`
        : "Cash-flow positive through the forecast horizon"
    );
  }
} else {
  console.error(USAGE);
  process.exit(1);
}

/** " cost=$200.00/mo started 2026-10" -- a goal's ongoing cost, when it has one. */
function costText(g: { ongoingMonthlyCents?: number; ongoingStartedPeriod?: string | null }): string {
  const cost = g.ongoingMonthlyCents ?? 0;
  if (cost <= 0) return "";
  return ` cost=${formatCents(cost)}/mo${g.ongoingStartedPeriod ? ` started ${g.ongoingStartedPeriod}` : ""}`;
}

