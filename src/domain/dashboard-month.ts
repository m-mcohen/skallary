// src/domain/dashboard-month.ts
//
// Switch months on the
// Dashboard. Previous and next arrows beside the month name, plus a This month
// button; a past month shows how it ended (spending, budget against actual).
// No future months. Rejected: B, following the top bar's period.
//
// A past month is worked by the very functions the current month uses
// (spentMonthToDate, spendingCurves, incomeMonthToDate), with "today" set to
// the month's last day. So a past month is its whole month, and it compares
// with the whole month before it: the app's same-days rule already says a whole
// month compares with a whole month. Nothing new is counted here.
//
// Pure: today is always passed in.
import { isIncomeCategory } from "./dedup";
import { resolveMonthlyPlan } from "./budget";
import { spentMonthToDate, type MonthToDate } from "./compare";
import { incomeMonthToDate, type IncomeMonthToDate } from "./income-month";
import { monthBounds, monthIndex, periodFromIndex, periodOf } from "./period";
import { spendingCurves, type SpendingCurves } from "./spending-curve";
import type { BigMonth, BudgetLine } from "./plan-types";
import type { Account, NormalizedTxn } from "./types";

/** What the Dashboard needs to work out any month, read once when it loads. */
export interface MonthSource {
  /** Transactions after rules, adjustments and mappings (prepareTransactions). */
  prepared: NormalizedTxn[];
  accounts: Account[];
  mapping: Record<string, string>;
  /** The budget of record: never a what-if (a what-if never changes a past month). */
  budgetLines: BudgetLine[];
  /** The local calendar date the Dashboard read on, YYYY-MM-DD. */
  today: string;
  /** The first month with transactions, YYYY-MM; null when there are none. */
  firstMonth: string | null;
  /** Planned big months; counted in that month's budget. */
  bigMonths?: BigMonth[];
}

/** The earliest month any transaction is dated in, or null with none. */
export function firstMonthOf(txns: { date: string }[]): string | null {
  let min: string | null = null;
  for (const t of txns) if (min == null || t.date < min) min = t.date;
  return min == null ? null : periodOf(min);
}

export interface MonthNav {
  /** The month shown. */
  month: string;
  /** Today's month. */
  thisMonth: string;
  /** True when the month shown is this month. */
  current: boolean;
  /** The month before, or null at the first month with transactions. */
  previous: string | null;
  /** The month after, or null on this month: there are no future months. */
  next: string | null;
}

export function monthNav(month: string, today: string, firstMonth: string | null): MonthNav {
  const thisMonth = periodOf(today);
  const idx = monthIndex(month);
  return {
    month,
    thisMonth,
    current: month === thisMonth,
    previous: firstMonth != null && idx > monthIndex(firstMonth) ? periodFromIndex(idx - 1) : null,
    next: idx < monthIndex(thisMonth) ? periodFromIndex(idx + 1) : null,
  };
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The month a Dashboard link names. No month, a malformed one, or one after
 * this month is this month; one before the first month with transactions is
 * that first month. With no transactions at all, only this month exists.
 */
export function monthFromLink(raw: string | null, today: string, firstMonth: string | null): string {
  const thisMonth = periodOf(today);
  if (!raw || !MONTH_KEY.test(raw) || firstMonth == null) return thisMonth;
  if (monthIndex(raw) >= monthIndex(thisMonth)) return thisMonth;
  if (monthIndex(raw) < monthIndex(firstMonth)) return firstMonth;
  return raw;
}

/**
 * A month's budget: every cost line's amount for that month (a one-month amount
 * replaces its usual one, as on Budget), income lines left out, plus that month's
 * planned big months. With no one-month amounts and no
 * big months it is exactly Monthly budget (normalMonthCents).
 */
export function monthBudgetCents(lines: BudgetLine[], month: string, bigMonths: BigMonth[] = []): number {
  const categories = new Set(lines.map((l) => l.planningCategory).filter((c) => !isIncomeCategory(c)));
  let total = 0;
  for (const c of categories) total += resolveMonthlyPlan(lines, c, month);
  return total + bigMonths.filter((b) => b.month === month && !isIncomeCategory(b.planningCategory)).reduce((sum, b) => sum + b.amountCents, 0);
}

export interface BudgetAgainstActual {
  budgetCents: number;
  spentCents: number;
  /** Budget less spent: above zero is under budget, below zero is over. */
  differenceCents: number;
}

export interface EndedMonth {
  month: string;
  spent: MonthToDate;
  curves: SpendingCurves;
  income: IncomeMonthToDate;
  budget: BudgetAgainstActual;
}

/** How a past month ended: every month figure over the whole month. */
export function monthEnded(source: MonthSource, month: string): EndedMonth {
  const end = monthBounds(month).to;
  const { prepared, accounts, mapping } = source;
  const spent = spentMonthToDate(prepared, accounts, mapping, end);
  const budgetCents = monthBudgetCents(source.budgetLines, month, source.bigMonths ?? []);
  return {
    month,
    spent,
    curves: spendingCurves(prepared, accounts, mapping, end),
    income: incomeMonthToDate(prepared, accounts, mapping, end),
    budget: { budgetCents, spentCents: spent.cents, differenceCents: budgetCents - spent.cents },
  };
}
