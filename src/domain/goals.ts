// src/domain/goals.ts -- Monarch-parity goal math.
//
// A goal is funded by linked accounts -- an account's ENTIRE balance, or a
// FIXED dollar slice of it -- plus an amount saved outside any linked account.
// From the saved amount and the planned monthly contribution come the
// projected finish month and the Ahead / On track / At risk status, the way
// Monarch's goal cards show them. Goals stay track-only: nothing here feeds
// the forecast.
//
// Pure functions over already-fetched rows; the server, the CLI and the UI
// all call these so no surface can drift from another.
import type {
  Goal,
  GoalType,
  GoalAccountLink,
  GoalFunding,
  GoalFundingLine,
  GoalStatus,
  GoalStatusKind,
  AccountBalance,
  AccountFundingSummary,
  GoalsOverview,
} from "./plan-types";
import type { Account, NormalizedTxn } from "./types";
import { countsTowardDrawable, isCardAccount, isLoanAccount, isRetirementByNameOrType } from "./runway";
import { formatMonthShort, periodOf, monthIndex, periodFromIndex } from "./period";
import { formatWholeDollars } from "./money";

// --- templates ----------------------------------------------------------------

/** Monarch's save-up objectives. "savings" is the custom goal (blank name). */
export const GOAL_TEMPLATES: { type: GoalType; label: string; defaultName: string }[] = [
  { type: "emergency_fund", label: "Emergency fund", defaultName: "Emergency fund" },
  { type: "home_down_payment", label: "Down payment", defaultName: "Down payment" },
  { type: "car", label: "Car", defaultName: "New car" },
  { type: "vacation", label: "Vacation", defaultName: "Vacation" },
  { type: "wedding", label: "Wedding", defaultName: "Wedding" },
  { type: "education", label: "Education", defaultName: "Education" },
  { type: "retirement", label: "Retirement", defaultName: "Retirement" },
  { type: "savings", label: "Savings (custom)", defaultName: "" },
];

export function isGoalType(x: unknown): x is GoalType {
  return typeof x === "string" && GOAL_TEMPLATES.some((t) => t.type === x);
}

export function goalTemplateLabel(type: GoalType): string {
  return GOAL_TEMPLATES.find((t) => t.type === type)?.label ?? "Savings (custom)";
}

// --- eligibility ------------------------------------------------------------------

/**
 * Whether an account can fund a save-up goal: cash, brokerage and retirement
 * accounts can; cards and loans cannot (their balance is debt, not savings);
 * archived rows cannot (their balance is the same money the live row reports,
 * see migrations/0015); an untyped account is skipped rather than guessed at.
 * Deliberately NOT countsTowardDrawable(): that answers a different question
 * and excludes retirement accounts, which Monarch lets a Retirement goal use.
 */
export function isGoalFundingAccount(acct: Account): boolean {
  if (acct.archived) return false;
  // Counted? off means the account takes no part anywhere in the app, and the
  // effective flag also carries the include-the-partner's-accounts setting, so
  // a switched-off account never shows as available for goals.
  if (!acct.includeInSpend) return false;
  if (!acct.type) return false;
  if (isCardAccount(acct)) return false;
  if (isLoanAccount(acct)) return false;
  return true;
}

// --- funding --------------------------------------------------------------------------

/**
 * What a goal has saved right now: the hand-entered outside amount plus every
 * linked account's contribution (its whole synced balance, or its fixed slice).
 * A link whose account is missing, archived or otherwise ineligible is
 * reported in ignoredAccountIds and counts nothing -- silently counting an
 * archived balance is exactly the double-count 0015 exists to prevent.
 */
export function goalFunding(goal: Goal, links: GoalAccountLink[], accounts: Account[], balances: AccountBalance[]): GoalFunding {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const balanceById = new Map(balances.map((b) => [b.accountId, b.balanceCents]));
  const byAccount: GoalFundingLine[] = [];
  const ignoredAccountIds: string[] = [];

  for (const link of links) {
    if (link.goalId !== goal.id) continue;
    const acct = accountById.get(link.accountId);
    if (!acct || !isGoalFundingAccount(acct)) {
      ignoredAccountIds.push(link.accountId);
      continue;
    }
    if (link.mode === "fixed") {
      byAccount.push({ accountId: acct.id, accountName: acct.name, mode: "fixed", cents: link.amountCents ?? 0, balanceKnown: true });
    } else {
      const bal = balanceById.get(acct.id);
      byAccount.push({ accountId: acct.id, accountName: acct.name, mode: "entire", cents: bal ?? 0, balanceKnown: bal !== undefined });
    }
  }

  const outsideCents = goal.currentAmountCents;
  const savedCents = outsideCents + byAccount.reduce((s, l) => s + l.cents, 0);
  return { goal, savedCents, outsideCents, byAccount, ignoredAccountIds };
}

/**
 * Per eligible account: how much of its balance goals have claimed and how
 * much is still free ("Available for goals" in Monarch). A fixed slice on top
 * of an entire-balance link, or slices exceeding the balance, is over-allocated.
 * An account with no synced balance is simply unavailable, never over-allocated:
 * the app cannot tell.
 */
export function accountFundingSummaries(accounts: Account[], balances: AccountBalance[], links: GoalAccountLink[]): AccountFundingSummary[] {
  const balanceById = new Map(balances.map((b) => [b.accountId, b.balanceCents]));
  return accounts.filter(isGoalFundingAccount).map((account) => {
    const mine = links.filter((l) => l.accountId === account.id);
    const balanceCents = balanceById.get(account.id) ?? null;
    const fixedCents = mine.filter((l) => l.mode === "fixed").reduce((s, l) => s + (l.amountCents ?? 0), 0);
    const entire = mine.find((l) => l.mode === "entire");
    const entireGoalId = entire ? entire.goalId : null;
    const allocatedCents = (entire ? (balanceCents ?? 0) : 0) + fixedCents;
    let availableCents = 0;
    let overAllocated = false;
    if (entire) {
      overAllocated = fixedCents > 0;
    } else if (balanceCents !== null) {
      availableCents = Math.max(balanceCents - fixedCents, 0);
      overAllocated = fixedCents > balanceCents;
    }
    return { account, balanceCents, allocatedCents, availableCents, overAllocated, entireGoalId };
  });
}

/**
 * Why a goal's new link set would claim money another goal already holds, or
 * null. An account whose entire balance funds one goal gives no slices to any
 * other goal, and an account another goal slices cannot fund this one
 * entirely: either way the same dollars would count in two goals. Two
 * entire-balance links on one account are the database's unique index.
 * The server and the CLI both check this before replacing a goal's links.
 */
export function goalLinkConflict(goalId: string, next: GoalAccountLink[], allLinks: GoalAccountLink[]): string | null {
  for (const l of next) {
    const others = allLinks.filter((o) => o.goalId !== goalId && o.accountId === l.accountId);
    if (l.mode === "entire" && others.some((o) => o.mode === "fixed")) {
      return "Another goal holds a fixed amount of that account, so its entire balance cannot fund this goal too.";
    }
    if (l.mode === "fixed" && others.some((o) => o.mode === "entire")) {
      return "That account already funds another goal with its entire balance.";
    }
  }
  return null;
}

/**
 * Net transaction flow this month into the goal's entire-balance accounts, or
 * null when it has none. A transfer into an account that goals share by fixed
 * slices cannot be attributed to one goal, so it is not counted (D8).
 */
export function goalThisMonthCents(funding: GoalFunding, txns: NormalizedTxn[], period: string): number | null {
  const entireIds = new Set(funding.byAccount.filter((l) => l.mode === "entire").map((l) => l.accountId));
  if (entireIds.size === 0) return null;
  let sum = 0;
  for (const t of txns) {
    if (entireIds.has(t.accountId) && periodOf(t.date) === period) sum += t.amountCents;
  }
  return sum;
}

// --- status -----------------------------------------------------------------------------

/** Beyond this the projection is meaningless and reads as "no finish month". */
const FORECAST_CAP_MONTHS = 600;

/**
 * Progress, the recommended monthly amount, the projected finish month and
 * the status pill for one goal, given what it has saved.
 *
 * Months that can still take a contribution run from the CURRENT month through
 * the target month inclusive (Monarch's count). Monarch's conservative rule:
 * once something has been contributed this month, the current month no longer
 * counts, for both the recommendation and the projection.
 *
 * Status needs all three of target amount, target date and a planned
 * contribution (Monarch's rule); otherwise "no_plan", unless the goal is
 * already complete or its date has passed with money still to save.
 */
export function goalStatus(goal: Goal, savedCents: number, asOfDate: string, thisMonthCents: number | null = null): GoalStatus {
  const target = goal.targetAmountCents;
  const remainingCents = Math.max(target - savedCents, 0);
  const progressPct = target > 0 ? Math.min(Math.max(savedCents / target, 0), 1) : 1;

  const asOfIdx = monthIndex(periodOf(asOfDate));
  const targetIdx = goal.targetDate ? monthIndex(periodOf(goal.targetDate)) : null;
  const monthsRemaining = targetIdx === null ? null : Math.max(targetIdx - asOfIdx + 1, 0);
  const skipCurrent = (thisMonthCents ?? 0) > 0 ? 1 : 0;

  const complete = remainingCents === 0;
  // A goal the user marked complete needs no more saving, whatever is saved.
  const recommendedMonthlyCents =
    complete || goal.completedAt || monthsRemaining === null ? null : Math.ceil(remainingCents / Math.max(monthsRemaining - skipCurrent, 1));

  let forecastPeriod: string | null = null;
  let monthsUntilDone: number | null = null;
  if (complete) {
    monthsUntilDone = 0;
  } else if (goal.plannedMonthlyCents > 0) {
    const contributions = Math.ceil(remainingCents / goal.plannedMonthlyCents);
    if (contributions <= FORECAST_CAP_MONTHS) {
      const forecastIdx = asOfIdx + skipCurrent + contributions - 1;
      forecastPeriod = periodFromIndex(forecastIdx);
      monthsUntilDone = forecastIdx - asOfIdx;
    }
  }

  const monthsVsTarget = forecastPeriod !== null && targetIdx !== null ? monthIndex(forecastPeriod) - targetIdx : null;

  let status: GoalStatusKind;
  // Having the money is not having done
  // the goal. Completed is only the user's Mark complete; reaching the target is Fully saved.
  if (goal.completedAt) status = "completed";
  else if (complete) status = "fully_saved";
  else if (targetIdx !== null && targetIdx < asOfIdx) status = "at_risk";
  else if (targetIdx === null || goal.plannedMonthlyCents <= 0) status = "no_plan";
  else if (monthsVsTarget === null) status = "at_risk"; // planned, dated, but beyond the cap
  else if (monthsVsTarget < 0) status = "ahead";
  else if (monthsVsTarget === 0) status = "on_track";
  else status = "at_risk";

  return {
    goal,
    savedCents,
    progressPct,
    remainingCents,
    monthsRemaining,
    recommendedMonthlyCents,
    forecastPeriod,
    monthsUntilDone,
    monthsVsTarget,
    status,
    thisMonthCents,
  };
}

// --- saving on What if --------------------------------------------------------

/** Where a goal's saving a month on What if comes from. */
export type GoalSavingSource = "planned" | "target-date" | "done" | "none";

export interface GoalSavingPlan {
  /** What the goal's saving row saves a month on What if; null when there is no amount to save. */
  monthlyCents: number | null;
  source: GoalSavingSource;
  /** The month it is fully saved at that pace (the target month when worked out from it). */
  finishPeriod: string | null;
}

/**
 * A goal's saving row on What if, set up once here: the Planned per month the user typed, and the goal then
 * finishes when that pace gets there (the card's Projected finish); otherwise
 * Needed per month, (target minus saved) over the months left to the target
 * date. A fully saved or completed goal needs nothing more; a goal with neither
 * a target date nor a planned amount has no amount.
 */
export function goalSavingPlan(s: GoalStatus): GoalSavingPlan {
  if (s.goal.completedAt || s.remainingCents === 0) return { monthlyCents: 0, source: "done", finishPeriod: null };
  if (s.goal.plannedMonthlyCents > 0) return { monthlyCents: s.goal.plannedMonthlyCents, source: "planned", finishPeriod: s.forecastPeriod };
  if (s.recommendedMonthlyCents !== null) {
    return { monthlyCents: s.recommendedMonthlyCents, source: "target-date", finishPeriod: s.goal.targetDate ? periodOf(s.goal.targetDate) : null };
  }
  return { monthlyCents: null, source: "none", finishPeriod: null };
}

/**
 * Every goal's funding and status, as each goal card shows them. The Goals screen
 * and the Dashboard's Goals card both call this, so a goal cannot read
 * one way on one screen and another way on the other.
 */
export function goalStatuses(
  goals: Goal[],
  side: { accounts: Account[]; balances: AccountBalance[]; links: GoalAccountLink[]; txns: NormalizedTxn[] },
  asOfDate: string
): { funding: GoalFunding; status: GoalStatus }[] {
  const period = periodOf(asOfDate);
  return goals.map((g) => {
    const funding = goalFunding(g, side.links, side.accounts, side.balances);
    const thisMonth = goalThisMonthCents(funding, side.txns, period);
    return { funding, status: goalStatus(g, funding.savedCents, asOfDate, thisMonth) };
  });
}

/**
 * The line a goal leads with: "Save $200,000.00
 * by Sep 2030", or just "Save $5,000.00" with no date. The Goals screen and the
 * Dashboard both read it, so the two cannot word a goal differently.
 */
export function goalTargetText(goal: Goal): string {
  const target = `Save ${formatWholeDollars(goal.targetAmountCents)}`;
  return goal.targetDate ? `${target} by ${formatMonthShort(periodOf(goal.targetDate))}` : target;
}

/**
 * "40%", "100%" -- but never "100%" while the goal is short: 0.99996 reads
 * "99.99%" (floored to two decimals), so a near-complete goal cannot be
 * mistaken for a complete one.
 */
export function formatProgressPct(pct: number): string {
  const p = Math.min(Math.max(pct, 0), 1);
  const rounded = Math.round(p * 100);
  if (rounded === 100 && p < 1) return `${Math.floor(p * 10000) / 100}%`;
  return `${rounded}%`;
}

/**
 * What is owed on cards, as a positive number. Card balances always subtract;
 * Available for goals once ignored them and read them above net worth. It asks the same gate as Drawable and
 * takes the size of each balance, so a feed that reports debt as a positive
 * number still counts, and Goals can never disagree with Drawable about a card.
 */
export function cardDebtCents(accounts: Account[], balances: AccountBalance[]): number {
  const balanceById = new Map(balances.map((b) => [b.accountId, b.balanceCents]));
  return accounts
    .filter((a) => countsTowardDrawable(a) && isCardAccount(a))
    .reduce((sum, a) => sum + Math.abs(balanceById.get(a.id) ?? 0), 0);
}

/** Totals for the Goals tab's overview row: active goals only. */
export function goalsOverview(statuses: GoalStatus[], summaries: AccountFundingSummary[], cardDebt = 0): GoalsOverview {
  const active = statuses.filter((s) => !s.goal.archivedAt);
  // Retirement money is its own line: a down payment
  // cannot come from an IRA without tax and a penalty.
  const retirement = summaries.filter((x) => isRetirementByNameOrType(x.account));
  const spendable = summaries.filter((x) => !isRetirementByNameOrType(x.account));
  return {
    savedCents: active.reduce((s, x) => s + x.savedCents, 0),
    targetCents: active.reduce((s, x) => s + x.goal.targetAmountCents, 0),
    availableForGoalsCents: Math.max(0, spendable.reduce((s, x) => s + x.availableCents, 0) - cardDebt),
    retirementAvailableCents: retirement.reduce((s, x) => s + x.availableCents, 0),
    overAllocatedCount: summaries.filter((x) => x.overAllocated).length,
    activeCount: active.length,
  };
}
