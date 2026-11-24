// src/domain/compare.ts
//
// A period against a baseline. The set is modeled on the Bravo for Power BI
// time intelligence measures (DAX Patterns, "standard time-related
// calculations"): previous period (PP / POP, covering PM, PQ, PY and their
// to-date forms), same period last year (PY / YOY), and moving averages
// (AVG 3M, AVG 1Y). Left out on purpose: the to-date-against-the-previous-
// COMPLETE-period family (PMC, MTDOPM and kin), which the user turned down on
// because a partial month always looks "down" against a whole one.
//
// The user's rule instead: an unfinished month compares on the SAME DAYS ONLY. Sep 1-20
// is compared with Aug 1-20. A whole month compares with a whole month, whatever
// their lengths.
//
// Pure: no clock, no I/O. Figures go through rollupMonthly, so a baseline counts
// exactly what every other figure counts (scope.ts).
import { formatDateRange, monthBounds, monthIndex, periodFromIndex, periodOf, resolvePeriod, type Period } from "./period";
import { rollupMonthly } from "./rollups";
import type { Account, NormalizedTxn } from "./types";

export type CompareId = "none" | "previous" | "last-year" | "avg-3" | "avg-12";

/** In the order the picker lists them. */
export const COMPARE_OPTIONS: { id: CompareId; label: string }[] = [
  { id: "none", label: "No comparison" },
  { id: "previous", label: "Previous period" },
  { id: "last-year", label: "Same period last year" },
  { id: "avg-3", label: "3-month average" },
  { id: "avg-12", label: "12-month average" },
];

export interface DateRange {
  from: string;
  to: string;
}

export interface Baseline {
  compare: Exclude<CompareId, "none">;
  /** Every stretch of days that counts. A month may appear more than once; it counts each time. */
  ranges: DateRange[];
  /** 1 for a plain period, 3 or 12 for an average. */
  divideBy: number;
  /** The one contiguous range the baseline can open as a ledger, or null when it is several separate stretches. */
  ledgerRange: DateRange | null;
  /** What it is compared WITH, in words, to finish the sentence "compared with ...". */
  caption: string;
}

const daysIn = (period: string) => Number(monthBounds(period).to.slice(8));
const pad = (n: number) => String(n).padStart(2, "0");

export function isMonthEnd(dateIso: string): boolean {
  return dateIso === monthBounds(periodOf(dateIso)).to;
}

/**
 * The same day, `months` away. A day the target month does not have is clamped
 * to its last day (no Feb 30). With `toMonthEnd`, the result is the target
 * month's last day, which is how a WHOLE month maps to a whole month.
 */
export function shiftMonths(dateIso: string, months: number, toMonthEnd: boolean): string {
  const target = periodFromIndex(monthIndex(periodOf(dateIso)) + months);
  const last = daysIn(target);
  const day = toMonthEnd ? last : Math.min(Number(dateIso.slice(8, 10)), last);
  return `${target}-${pad(day)}`;
}

function addDays(dateIso: string, days: number): string {
  // Arithmetic on a calendar date pinned to UTC midnight, so UTC is the right frame here (not "today").
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayCount(range: DateRange): number {
  const ms = Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** A range split by calendar month. `whole` marks a segment that covers its entire month. */
export function monthSegments(range: DateRange): (DateRange & { whole: boolean })[] {
  const out: (DateRange & { whole: boolean })[] = [];
  const last = monthIndex(periodOf(range.to));
  for (let idx = monthIndex(periodOf(range.from)); idx <= last; idx++) {
    const bounds = monthBounds(periodFromIndex(idx));
    const from = range.from > bounds.from ? range.from : bounds.from;
    const to = range.to < bounds.to ? range.to : bounds.to;
    out.push({ from, to, whole: from === bounds.from && to === bounds.to });
  }
  return out;
}

/** The whole range moved back by `months`: same days, a whole last month staying whole. */
function shiftRange(range: DateRange, months: number): DateRange {
  const wholeLastMonth = range.from <= monthBounds(periodOf(range.to)).from && isMonthEnd(range.to);
  return {
    from: shiftMonths(range.from, -months, false),
    to: shiftMonths(range.to, -months, wholeLastMonth),
  };
}

function previousRange(period: Period, range: DateRange): DateRange {
  // Year to date compares with the previous year to date. Shifting Jan 1-Sep 20
  // back by its own nine months would give Apr-Dec of last year.
  if (period.preset === "ytd") return shiftRange(range, 12);
  if (range.from.endsWith("-01")) {
    const months = monthIndex(periodOf(range.to)) - monthIndex(periodOf(range.from)) + 1;
    return shiftRange(range, months);
  }
  // A typed range that does not start on the 1st: the same number of days, immediately before.
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(dayCount(range) - 1)), to };
}

function averageBaseline(range: DateRange, months: 3 | 12): Pick<Baseline, "ranges" | "ledgerRange" | "caption"> {
  const segments = monthSegments(range);
  const first = monthIndex(periodOf(range.from));
  const ranges: DateRange[] = [];
  for (let back = 1; back <= months; back++) {
    const month = periodFromIndex(first - back);
    const bounds = monthBounds(month);
    const lastDay = daysIn(month);
    for (const segment of segments) {
      if (segment.whole) {
        ranges.push(bounds);
      } else {
        const clamp = (dateIso: string) => `${month}-${pad(Math.min(Number(dateIso.slice(8, 10)), lastDay))}`;
        ranges.push({ from: clamp(segment.from), to: clamp(segment.to) });
      }
    }
  }
  const oneWholeMonth = segments.length === 1 && segments[0].whole;
  return {
    ranges,
    ledgerRange: oneWholeMonth
      ? { from: monthBounds(periodFromIndex(first - months)).from, to: monthBounds(periodFromIndex(first - 1)).to }
      : null,
    caption: oneWholeMonth
      ? `the average month over the ${months} months before`
      : `the average of the same days in the ${months} months before`,
  };
}

/** The baseline a period is compared with, or null when there is nothing to compare it with. */
export function baselineFor(period: Period, compare: CompareId): Baseline | null {
  if (compare === "none" || !period.from || !period.to) return null;
  const range: DateRange = { from: period.from, to: period.to };
  if (compare === "avg-3" || compare === "avg-12") {
    const months = compare === "avg-3" ? 3 : 12;
    return { compare, divideBy: months, ...averageBaseline(range, months) };
  }
  const shifted = compare === "previous" ? previousRange(period, range) : shiftRange(range, 12);
  return {
    compare,
    ranges: [shifted],
    divideBy: 1,
    ledgerRange: shifted,
    caption: formatDateRange(shifted.from, shifted.to),
  };
}

/** True when the data reaches back far enough for the baseline to mean anything. */
export function baselineHasHistory(baseline: Baseline, earliestDate: string | null): boolean {
  if (!earliestDate) return false;
  return baseline.ranges.every((r) => r.from >= earliestDate.slice(0, 10));
}

export interface BaselineSums {
  /** Keyed `${kind}|${planningCategory}`. Spending is positive, as everywhere else. */
  byCategory: Map<string, number>;
  /** The same keys BEFORE dividing, so a group of categories can be averaged once. */
  rawByCategory: Map<string, number>;
  divideBy: number;
  incomeCents: number;
  expenseCents: number;
  /** Money put away, and what the money earned: their own buckets, never spending. */
  savingCents: number;
  investmentIncomeCents: number;
  /** Left over: income + investment income - spending, as the cash flow table. Saving is its own figure. */
  netCents: number;
}

/**
 * The baseline's figures, through the same rollup as every other figure. An
 * average is the TOTAL over its ranges divided by the number of months, rounded
 * to the cent once per figure (so a total is the rounded average of the total,
 * not a sum of rounded parts).
 */
export function sumForBaseline(
  prepared: NormalizedTxn[],
  accounts: Account[],
  mapping: Record<string, string>,
  baseline: Pick<Baseline, "ranges" | "divideBy">
): BaselineSums {
  const raw = new Map<string, number>();
  let income = 0;
  let expense = 0;
  let saving = 0;
  let investmentIncome = 0;
  for (const range of baseline.ranges) {
    const inside = prepared.filter((t) => {
      const day = t.date.slice(0, 10);
      return day >= range.from && day <= range.to;
    });
    for (const r of rollupMonthly(inside, accounts, mapping)) {
      const key = `${r.kind}|${r.planningCategory}`;
      raw.set(key, (raw.get(key) ?? 0) + r.amountCents);
      if (r.kind === "income") income += r.amountCents;
      else if (r.kind === "expense") expense += r.amountCents;
      else if (r.kind === "saving") saving += r.amountCents;
      else if (r.kind === "investment_income") investmentIncome += r.amountCents;
    }
  }
  const avg = (cents: number) => Math.round(cents / baseline.divideBy);
  const byCategory = new Map([...raw.entries()].map(([key, cents]) => [key, avg(cents)]));
  return {
    byCategory,
    rawByCategory: raw,
    divideBy: baseline.divideBy,
    incomeCents: avg(income),
    expenseCents: avg(expense),
    savingCents: avg(saving),
    investmentIncomeCents: avg(investmentIncome),
    // Left over is earned minus spent; money moved into or out of savings is its own figure, never part of it.
    netCents: avg(income + investmentIncome - expense),
  };
}

/**
 * The baseline for several categories together, such as the Other row. Summed
 * first and averaged ONCE, so it equals what the group's ledger shows (its total
 * divided by the months). Adding up already-rounded averages can be off by a cent.
 */
export function baselineOf(sums: BaselineSums, keys: string[]): number {
  let raw = 0;
  for (const key of keys) raw += sums.rawByCategory.get(key) ?? 0;
  return Math.round(raw / sums.divideBy);
}

export interface BaselineSegment {
  /** The month of the PERIOD this stands behind, YYYY-MM. */
  month: string;
  ranges: DateRange[];
  divideBy: number;
}

/**
 * The baseline month by month, for the marker beside each month's bar. Null
 * where there is no baseline, and for a typed range compared with the days
 * before it: that shift is in days, so its months do not line up one to one.
 */
export function baselineSegments(period: Period, compare: CompareId): BaselineSegment[] | null {
  if (compare === "none" || !period.from || !period.to) return null;
  const range: DateRange = { from: period.from, to: period.to };
  const segments = monthSegments(range);

  if (compare === "avg-3" || compare === "avg-12") {
    const months = compare === "avg-3" ? 3 : 12;
    return segments.map((segment) => ({
      month: periodOf(segment.from),
      // Each month of the period against the months before the PERIOD, not before itself.
      ranges: averageBaseline(range, months).ranges.filter((_, i) => i % segments.length === segments.indexOf(segment)),
      divideBy: months,
    }));
  }

  let shift = 12;
  if (compare === "previous" && period.preset !== "ytd") {
    if (!range.from.endsWith("-01")) return null;
    shift = monthIndex(periodOf(range.to)) - monthIndex(periodOf(range.from)) + 1;
  }
  return segments.map((segment) => ({
    month: periodOf(segment.from),
    ranges: [
      {
        from: shiftMonths(segment.from, -shift, false),
        // A whole month maps to a whole month; a month in progress keeps the same days.
        to: shiftMonths(segment.to, -shift, segment.whole),
      },
    ],
    divideBy: 1,
  }));
}

export interface Comparison {
  currentCents: number;
  baselineCents: number;
  changeCents: number;
  /** Null when the baseline is zero or negative: a percent of nothing is not a number worth showing. */
  changePct: number | null;
  direction: "up" | "down" | "flat";
  /** More spending is unfavorable; more income or more net is favorable; flat is neither. */
  favorable: boolean | null;
}

export function compareFigures(
  currentCents: number,
  baselineCents: number,
  kind: "expense" | "income" | "net"
): Comparison {
  const changeCents = currentCents - baselineCents;
  const direction = changeCents > 0 ? "up" : changeCents < 0 ? "down" : "flat";
  return {
    currentCents,
    baselineCents,
    changeCents,
    changePct: baselineCents > 0 ? (changeCents / baselineCents) * 100 : null,
    direction,
    favorable: direction === "flat" ? null : kind === "expense" ? direction === "down" : direction === "up",
  };
}

export interface MonthToDate {
  /** This month through today. */
  period: Period;
  /** Spending so far this month, in the shared scope. */
  cents: number;
  /**
   * The same days of last month, or null when the history does not reach back that far.
   * `byCategory`: each top category's spending on those days, 0 when it had none,
   * from the same rollup, so each equals that category's ledger.
   */
  baseline: { range: DateRange; cents: number; byCategory: Record<string, number> } | null;
  /** What came in, less what was spent, so far this month (the cash flow table's Left over). */
  leftOverCents: number;
  /** Put away so far this month (positive), or taken back out of savings (negative). Not part of Left over. */
  savingCents: number;
  /** The biggest spending categories so far this month, at most five, largest first; a net refund is not listed. */
  topCategories: { category: string; cents: number }[];
}

/**
 * The Dashboard's "Spent this month": spending from the 1st through today,
 * against the same days of last month. Both figures go through rollupMonthly, so
 * each equals the ledger it opens.
 */
export function spentMonthToDate(
  prepared: NormalizedTxn[],
  accounts: Account[],
  mapping: Record<string, string>,
  asOf: string
): MonthToDate {
  const period = resolvePeriod("this-month", asOf);
  const thisMonth: DateRange = { from: period.from!, to: period.to! };
  const sums = sumForBaseline(prepared, accounts, mapping, { ranges: [thisMonth], divideBy: 1 });
  const cents = sums.expenseCents;
  const topCategories = [...sums.byCategory.entries()]
    .filter(([key, total]) => key.startsWith("expense|") && total > 0)
    .map(([key, total]) => ({ category: key.slice("expense|".length), cents: total }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 5);
  const month = { period, cents, leftOverCents: sums.netCents, savingCents: sums.savingCents, topCategories };
  const baseline = baselineFor(period, "previous");
  const earliest = prepared.reduce<string | null>((min, t) => (min == null || t.date < min ? t.date : min), null);
  if (!baseline || !baselineHasHistory(baseline, earliest)) return { ...month, baseline: null };
  const before = sumForBaseline(prepared, accounts, mapping, baseline);
  return {
    ...month,
    baseline: {
      range: baseline.ranges[0],
      cents: before.expenseCents,
      // The card's own top categories on the baseline's days: the same days rule, split by category.
      byCategory: Object.fromEntries(topCategories.map((c) => [c.category, before.byCategory.get(`expense|${c.category}`) ?? 0])),
    },
  };
}
