// src/domain/spending-range.ts
//
// The spending chart's longer ranges: 3 months,
// 6 months, year to date and 12 months, each ending on the day read, plotted by
// week against the same number of days just before it. "This month" stays with
// spending-curve.ts, by day.
//
// Every point is sumForBaseline(...).expenseCents over a date range, the same
// arithmetic as the month's line and "Spent this month", so the two views agree.
// The running total is read from the span's first day, not added up from the
// weeks, so it ends on the whole span's figure by construction.
//
// Pure: the day read is a parameter.
import { sumForBaseline, type DateRange } from "./compare";
import type { Account, NormalizedTxn } from "./types";

export type LongRange = "3m" | "6m" | "ytd" | "12m";

export interface RangeWeek {
  /** This span's week, YYYY-MM-DD to YYYY-MM-DD; the last one ends on the day read. */
  from: string;
  to: string;
  /** The same week of the span before. */
  priorFrom: string;
  priorTo: string;
  /** What the week cost. */
  weekly: number;
  /** Spending from the span's first day through the week's last. */
  cumulative: number;
  /** The span before, read the same way; null when the history does not reach its first day. */
  priorWeekly: number | null;
  priorCumulative: number | null;
}

export interface RangeCurves {
  range: LongRange;
  from: string;
  to: string;
  priorFrom: string;
  priorTo: string;
  priorAvailable: boolean;
  weeks: RangeWeek[];
  /** "Last 3 months". */
  label: string;
  /** "The 3 months before". */
  priorLabel: string;
}

const MONTHS: Record<Exclude<LongRange, "ytd">, number> = { "3m": 3, "6m": 6, "12m": 12 };
const DAY = 86400000;

const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => toIso(toMs(iso) + days * DAY);

/** The same date `months` back, clamped to that month's last day (Mar 31 less 1 month is Feb 28). */
function monthsBack(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return toIso(first.getTime());
}

export function spendingRange(
  prepared: NormalizedTxn[],
  accounts: Account[],
  mapping: Record<string, string>,
  asOf: string,
  range: LongRange
): RangeCurves {
  const to = asOf;
  const from = range === "ytd" ? `${asOf.slice(0, 4)}-01-01` : addDays(monthsBack(asOf, MONTHS[range]), 1);
  const length = Math.round((toMs(to) - toMs(from)) / DAY) + 1;
  const priorTo = addDays(from, -1);
  const priorFrom = addDays(priorTo, -(length - 1));

  // Only the rows drawn, so a year of weeks stays quick on years of history.
  const rows = prepared.filter((t) => t.date.slice(0, 10) >= priorFrom && t.date.slice(0, 10) <= to);
  const earliest = prepared.reduce<string | null>((min, t) => (min == null || t.date < min ? t.date : min), null);
  // The same test as the month's lines: the data must reach back to the first day compared.
  const priorAvailable = earliest != null && priorFrom >= earliest.slice(0, 10);
  const spent = (r: DateRange) => sumForBaseline(rows, accounts, mapping, { ranges: [r], divideBy: 1 }).expenseCents;

  const weeks: RangeWeek[] = [];
  for (let start = 0; start < length; start += 7) {
    const end = Math.min(start + 6, length - 1);
    const w = { from: addDays(from, start), to: addDays(from, end), priorFrom: addDays(priorFrom, start), priorTo: addDays(priorFrom, end) };
    weeks.push({
      ...w,
      weekly: spent({ from: w.from, to: w.to }),
      cumulative: spent({ from, to: w.to }),
      priorWeekly: priorAvailable ? spent({ from: w.priorFrom, to: w.priorTo }) : null,
      priorCumulative: priorAvailable ? spent({ from: priorFrom, to: w.priorTo }) : null,
    });
  }

  const label = range === "ytd" ? "Year to date" : `Last ${MONTHS[range]} months`;
  const priorLabel = range === "ytd" ? "The same length before" : `The ${MONTHS[range]} months before`;
  return { range, from, to, priorFrom, priorTo, priorAvailable, weeks, label, priorLabel };
}
