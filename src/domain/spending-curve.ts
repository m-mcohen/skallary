// src/domain/spending-curve.ts
//
// The Dashboard chart's lines:
// spending so far this month, day by day, against last month, the same month
// last year, and the average of the 3 and of the 12 full months before this one.
//
// Every point is sumForBaseline(...).expenseCents over "the 1st through day d",
// the very arithmetic behind "Spent this month", its "Last month, same days" and
// the 12-month average, so the lines end on those figures by construction. A day
// a month does not have (Day 31 after a 30-day month) carries that month's total.
//
// Pure: today is a parameter.
import { sumForBaseline, type DateRange } from "./compare";
import { monthBounds, monthIndex, periodFromIndex, periodOf } from "./period";
import type { Account, NormalizedTxn } from "./types";

export interface SpendingCurves {
  /** This month, YYYY-MM. */
  month: string;
  /** Today's day of the month: how many points this month's line has. */
  today: number;
  /** The comparison lines' length: always 31. */
  days: number;
  /** Spending from the 1st through day i + 1, for each day so far. */
  thisMonth: number[];
  /** Last month, Day 1 to 31; null when the history does not reach its 1st. */
  lastMonth: number[] | null;
  /** The 12 full months before this one, averaged, Day 1 to 31; null when the history does not reach back 12 months. */
  averageMonth: number[] | null;
  /** "September". */
  lastMonthLabel: string;
  /** The same month a year ago, Day 1 to 31; null when the history does not reach its 1st. */
  lastYear?: number[] | null;
  /** The 3 full months before this one, averaged, Day 1 to 31; null when the history does not reach back 3 months. */
  averageThree?: number[] | null;
  /** "October 2025". */
  lastYearLabel?: string;
}

const DAYS = 31;
const AVERAGE_MONTHS = 12;
const pad = (n: number) => String(n).padStart(2, "0");

/** The 1st of `month` through day `day`, or through its last day when the month is shorter. */
function throughDay(month: string, day: number): DateRange {
  const { from, to } = monthBounds(month);
  const last = Number(to.slice(8, 10));
  return { from, to: `${month}-${pad(Math.min(day, last))}` };
}

/**
 * The day the comparison lines are read at: today, or Day 31 on the month's last day.
 * On the last day the month is whole, and a whole month compares with whole months,
 * so the average
 * month and the chart read Day 31 too.
 */
export function comparisonDay(curves: SpendingCurves): number {
  const last = Number(monthBounds(curves.month).to.slice(8, 10));
  return curves.today >= last ? curves.days : curves.today;
}

export function spendingCurves(
  prepared: NormalizedTxn[],
  accounts: Account[],
  mapping: Record<string, string>,
  asOf: string
): SpendingCurves {
  const month = periodOf(asOf);
  const index = monthIndex(month);
  const today = Number(asOf.slice(8, 10));
  const lastMonth = periodFromIndex(index - 1);
  const firstAveraged = periodFromIndex(index - AVERAGE_MONTHS);

  // Only the months drawn, so 31 points times 12 ranges stays quick on years of rows.
  const windowFrom = monthBounds(firstAveraged).from;
  const windowTo = monthBounds(month).to;
  const rows = prepared.filter((t) => t.date.slice(0, 10) >= windowFrom && t.date.slice(0, 10) <= windowTo);
  const earliest = prepared.reduce<string | null>((min, t) => (min == null || t.date < min ? t.date : min), null);
  // The same test as baselineHasHistory: the data must reach back to the first day compared.
  const reaches = (from: string) => earliest != null && from >= earliest.slice(0, 10);

  const spent = (ranges: DateRange[], divideBy: number) => sumForBaseline(rows, accounts, mapping, { ranges, divideBy }).expenseCents;
  const days = (count: number, point: (day: number) => number) => Array.from({ length: count }, (_, i) => point(i + 1));

  const averaged = Array.from({ length: AVERAGE_MONTHS }, (_, i) => periodFromIndex(index - AVERAGE_MONTHS + i));
  const lastThree = averaged.slice(-3);
  const yearAgo = periodFromIndex(index - 12);
  return {
    month,
    today,
    days: DAYS,
    thisMonth: days(today, (d) => spent([throughDay(month, d)], 1)),
    lastMonth: reaches(monthBounds(lastMonth).from) ? days(DAYS, (d) => spent([throughDay(lastMonth, d)], 1)) : null,
    averageMonth: reaches(windowFrom)
      ? days(DAYS, (d) => spent(averaged.map((m) => throughDay(m, d)), AVERAGE_MONTHS))
      : null,
    lastMonthLabel: new Date(`${lastMonth}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
    lastYear: reaches(monthBounds(yearAgo).from) ? days(DAYS, (d) => spent([throughDay(yearAgo, d)], 1)) : null,
    averageThree: reaches(monthBounds(lastThree[0]).from)
      ? days(DAYS, (d) => spent(lastThree.map((m) => throughDay(m, d)), 3))
      : null,
    lastYearLabel: new Date(`${yearAgo}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}
