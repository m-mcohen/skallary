import type { Account } from "./types";

export interface Plan {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  createdAt: string; // ISO timestamp
}

export interface BudgetLine {
  planId: string;
  planningCategory: string;
  period: string | null; // YYYY-MM, or null = applies to all months (default)
  amountCents: number;
  /** Every-month rows: who set the amount (migration 0032). Absent on one-month rows. */
  source?: "suggested" | "you";
  /** Set only on rows made from a budget change when the budget is read (budget-changes.ts). Never stored. */
  origin?: "change";
}

export type BudgetChangeReason = "changed" | "goal";
export interface BudgetChange {
  id: number;
  planId: string;
  planningCategory: string;
  fromMonth: string; // YYYY-MM
  /** reason "changed": the line's amount from that month on. reason "goal": added on top from that month on. */
  amountCents: number;
  reason: BudgetChangeReason;
  goalId: string | null;
  createdAt: string;
}
export interface BigMonth {
  id: number;
  planId: string;
  planningCategory: string;
  month: string; // YYYY-MM
  label: string;
  amountCents: number;
  createdAt: string;
  /** Set only on rows made when the budget is read, never stored (id negative). Absent = a stored big month. */
  origin?: "yearly-bill" | "raise";
  sourceId?: number;
  late?: boolean;
  obligationYear?: number;
}
export interface MonthNote {
  planId: string;
  planningCategory: string;
  month: string;
  note: string;
  updatedAt: string;
}

export type Kind = "expense" | "income";

export interface CellForecast {
  planningCategory: string;
  kind: Kind;
  actualCents: number;
  planCents: number;
  forecastCents: number;
  varianceCents: number;
}

export interface MonthForecast {
  period: string;
  cells: CellForecast[];
  netCents: number; // income forecast - expense forecast, this month
}

export interface ForecastResult {
  planId: string;
  asOfDate: string; // YYYY-MM-DD
  months: MonthForecast[]; // one per calendar month in [plan.start, plan.end]
  annualByCategory: CellForecast[];
  totals: {
    incomeForecastCents: number;
    expenseForecastCents: number;
    surplusForecastCents: number; // income - expense
    savingsRate: number; // surplus/income, 0 if income==0
    cumulativeSurplus: { period: string; cents: number }[];
  };
}

// --- Goals --------------------------------
// A goal is funded by linked accounts (an account's entire balance, or a
// fixed dollar slice of it) plus an amount saved outside any linked account.
// Goals are track-only: nothing here feeds the forecast.

export type GoalType =
  | "emergency_fund"
  | "home_down_payment"
  | "car"
  | "vacation"
  | "wedding"
  | "education"
  | "retirement"
  | "savings";

export interface Goal {
  id: string;
  name: string;
  /** Template key; "savings" is the custom goal. */
  goalType: GoalType;
  targetAmountCents: number;
  targetDate: string | null; // YYYY-MM-DD, optional
  priority: number;
  /** Saved OUTSIDE any linked account (hand-entered); always added to the linked total. */
  currentAmountCents: number;
  /** What the user plans to put toward the goal each month; 0 = no plan yet. */
  plannedMonthlyCents: number;
  notes: string;
  /** ISO timestamp when archived; null = active. Archiving is reversible. */
  archivedAt: string | null;
  /** What the goal costs a month once reached, e.g. a mortgage (0 or absent = none). */
  ongoingMonthlyCents?: number;
  /** YYYY-MM the ongoing cost became real and went into the budget; null = still a plan. */
  ongoingStartedPeriod?: string | null;
  /** The budget line the started cost went into, for the card's wording; null = not started. */
  ongoingBudgetLine?: string | null;
  /** ISO timestamp the user pressed Mark complete; null = not marked. Fully saved is NOT completed. */
  completedAt?: string | null;
}

export type GoalLinkMode = "entire" | "fixed";

export interface GoalAccountLink {
  goalId: string;
  accountId: string;
  mode: GoalLinkMode;
  /** The fixed slice in cents; null when mode is "entire". */
  amountCents: number | null;
}

export interface GoalFundingLine {
  accountId: string;
  accountName: string;
  mode: GoalLinkMode;
  /** What this account contributes to the goal right now. */
  cents: number;
  /** False when an entire-balance account has no synced balance yet (counted as 0). */
  balanceKnown: boolean;
}

export interface GoalFunding {
  goal: Goal;
  /** outsideCents + every byAccount line. */
  savedCents: number;
  outsideCents: number;
  byAccount: GoalFundingLine[];
  /** Linked account ids that no longer count (archived, missing, or no longer eligible). */
  ignoredAccountIds: string[];
}

/** completed = the user pressed Mark complete; fully_saved = the savings reached the target. */
export type GoalStatusKind = "completed" | "fully_saved" | "ahead" | "on_track" | "at_risk" | "no_plan";

export interface AccountFundingSummary {
  account: Account;
  /** null = no balance synced yet. */
  balanceCents: number | null;
  /** Fixed slices plus, for an entire-balance account, the whole balance. */
  allocatedCents: number;
  /** balance - allocated, floored at 0; 0 when the balance is unknown or the account is entirely linked. */
  availableCents: number;
  overAllocated: boolean;
  /** The goal this account funds with its entire balance, if any. */
  entireGoalId: string | null;
}

export interface GoalsOverview {
  savedCents: number;
  targetCents: number;
  /** Cash and brokerage no goal has claimed, less what is owed on cards. Retirement is left out. */
  availableForGoalsCents: number;
  /** Retirement accounts no goal has claimed, shown on their own line: a retirement goal can still use them. */
  retirementAvailableCents: number;
  overAllocatedCount: number;
  activeCount: number;
}

export type WishKind = "planned" | "wish";

export interface WishlistItem {
  id: string;
  name: string;
  costCents: number;
  kind: WishKind;
  targetDate: string | null; // YYYY-MM-DD
  priority: number;
  planningCategory: string | null;
}

export interface AccountBalance {
  accountId: string;
  balanceCents: number;
  asOf: string; // ISO timestamp
}

/**
 * One account's balance as a sync recorded it (migrations/0026). AccountBalance
 * holds only the latest; readings keep one per account per day, so net worth
 * has a history that is recorded, not worked backward from transactions.
 */
export interface BalanceReading {
  accountId: string;
  recordedOn: string; // YYYY-MM-DD, the local day of the sync that wrote it
  balanceCents: number;
  asOf: string; // the bank's own balance timestamp
}

export interface GoalStatus {
  goal: Goal;
  savedCents: number;
  /** 0..1, clamped. */
  progressPct: number;
  remainingCents: number;
  /** Months the goal can still be contributed to, current month through the target month; null without a target date. */
  monthsRemaining: number | null;
  /** What to save per month to finish by the target date; null when complete or without a target date. */
  recommendedMonthlyCents: number | null;
  /** YYYY-MM the planned contribution finishes the goal; null when complete, unplanned, or beyond 50 years. */
  forecastPeriod: string | null;
  /** Months from the as-of month to forecastPeriod (0 = this month); null when forecastPeriod is null. */
  monthsUntilDone: number | null;
  /** forecast month minus target month; negative = ahead, 0 = on track, positive = behind. */
  monthsVsTarget: number | null;
  status: GoalStatusKind;
  /** Net transaction flow this month into entire-balance accounts; null when the goal has none. */
  thisMonthCents: number | null;
}

export interface PlannedEvent {
  period: string; // YYYY-MM
  planningCategory: string;
  amountCents: number;
}

export interface WishAffordability {
  item: WishlistItem;
  affordablePeriod: string | null; // YYYY-MM or null (not within horizon)
}

export interface RunwayResult {
  startingLiquidCents: number;
  liquidByMonth: { period: string; cents: number }[];
  crossZeroPeriod: string | null;
  runwayMonths: number | null;
}
