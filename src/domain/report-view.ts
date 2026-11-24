// src/domain/report-view.ts
//
// What the Spending and Income tabs of Reports show.
//
// One list of entries feeds the ranked list, the chart and the monthly table, so
// the three cannot disagree. Each entry is one counted transaction on the tab's
// side, through the same classify() and scope rules as rollupMonthly, so nothing
// here can disagree with the Budget either.
//
// Refunds and credits: on Spending, money that came back on a spending category
// sits on its own line, so a category always reads what was spent on it and never
// goes negative. The net total is unchanged to the cent: purchases less refunds is
// the same sum, grouped differently.
import type { Account, NormalizedTxn } from "./types";
import type { Period } from "./period";
import { classify } from "./dedup";
import { MAASER_CATEGORY, potAccountIds, potRowKind } from "./maaser-pot";
import { countedByAccount, inSpendScope } from "./scope";
import { monthBounds, periodOf } from "./period";
import type { CategoryMonthSeries } from "./reports";

export type ReportSide = "expense" | "income";

export interface ReportEntry {
  /** YYYY-MM-DD. */
  date: string;
  /** The planning category: the budget line it counts under. */
  category: string;
  /**
   * In the tab's terms: on Spending, money spent is positive and money that came
   * back is negative; on Income, money received is positive.
   */
  cents: number;
  /**
   * The merchant it is shown under: the rename list, else the
   * Zelle clean (merchants.ts). Set when the caller passes a way to name it.
   */
  merchant?: string;
}

export interface DateRange {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
}

/** The line that holds every refund and credit on spending categories. */
export const REFUNDS_LABEL = "Refunds and credits";

/** Every counted transaction on one side, as an entry. Transfers and accounts that are not counted are out. */
export function reportEntries(
  prepared: NormalizedTxn[],
  accounts: Account[],
  mapping: Record<string, string>,
  side: ReportSide,
  /** Names each entry's merchant; the category never depends on it. */
  nameOf?: (t: NormalizedTxn) => string
): ReportEntry[] {
  const counted = countedByAccount(accounts);
  const potIds = potAccountIds(accounts);
  const out: ReportEntry[] = [];
  for (const t of prepared) {
    // The pot's rows are never spending or income (rule 3), except a gift paid straight from the
    // pot: it reached a charity, so it lists as Charity under the bank's own words.
    if (potIds.has(t.accountId)) {
      if (side === "expense" && potRowKind(t, potIds, mapping) === "gift") {
        const entry: ReportEntry = { date: t.date.slice(0, 10), category: MAASER_CATEGORY, cents: -t.amountCents };
        if (nameOf) entry.merchant = nameOf(t);
        out.push(entry);
      }
      continue;
    }
    const c = classify(t, mapping);
    if (c.kind !== side || !inSpendScope(t.accountId, c.kind, counted)) continue;
    const entry: ReportEntry = { date: t.date.slice(0, 10), category: c.planningCategory, cents: side === "expense" ? -t.amountCents : t.amountCents };
    if (nameOf) entry.merchant = nameOf(t);
    out.push(entry);
  }
  return out;
}

/**
 * Entries grouped by merchant instead of category: the same entries, the
 * merchant standing in the category's place, so the ranked list, the chart and the
 * monthly table group by it with no second code path. Narrow by category first.
 */
export function byMerchant(entries: ReportEntry[]): ReportEntry[] {
  return entries.map((e) => ({ ...e, category: e.merchant ?? e.category }));
}

/** The entries inside a range, both ends included. */
export function entriesIn(entries: ReportEntry[], range: DateRange): ReportEntry[] {
  return entries.filter((e) => e.date >= range.from && e.date <= range.to);
}

/**
 * The days a report covers: the period's own dates, an open end running to
 * today, and the start no earlier than the first day of the month the history
 * begins in, so a monthly average is not diluted by empty months before it.
 * Null with no history.
 */
export function reportRange(period: Period, earliest: string | null, today: string): DateRange | null {
  if (!earliest) return null;
  const first = `${earliest.slice(0, 7)}-01`;
  const from = period.from && period.from > first ? period.from : first;
  const to = period.to ?? today;
  return from <= to ? { from, to } : null;
}

const DAY_MS = 86_400_000;
const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => fromUtc(toUtc(iso) + n * DAY_MS);

/** Days in a range, both ends counted. */
export function daysInRange(range: DateRange): number {
  return Math.round((toUtc(range.to) - toUtc(range.from)) / DAY_MS) + 1;
}

/**
 * The months that count toward a monthly average: a month lying wholly inside the
 * range and already over (its last day before today). The rule: "monthly average should cover completed months. if you
 * count partial months then the monthly average changes every day and that defeats
 * the point of seeing an average month." A month the range cuts short, or the month
 * not over yet, stays in every total but not in the average.
 */
export function completeMonths(range: DateRange, today: string): string[] {
  return bucketsFor(range, "month")
    .map((b) => b.key)
    .filter((m) => {
      const bounds = monthBounds(m);
      return bounds.from >= range.from && bounds.to <= range.to && bounds.to < today;
    });
}

export interface MonthlyAverage {
  /** The complete months it divides by, YYYY-MM, oldest first. */
  months: string[];
  /** Their sum divided by how many there are, to the cent; null when there are none. */
  averageCents: number | null;
}

/**
 * The one monthly average every Reports figure and the merchant page use: the
 * complete months' amounts added up and divided by how many there are.
 */
export function monthlyAverage(byMonth: Record<string, number>, range: DateRange, today: string): MonthlyAverage {
  const months = completeMonths(range, today);
  const sum = months.reduce((total, m) => total + (byMonth[m] ?? 0), 0);
  return { months, averageCents: months.length > 0 ? Math.round(sum / months.length) : null };
}

export type Grouping = "day" | "week" | "month";

/** Up to 31 days by day, up to 186 days (about 6 months) by week, longer by month. */
export const DAY_LIMIT = 31;
export const WEEK_LIMIT = 186;

export function groupingFor(range: DateRange): Grouping {
  const days = daysInRange(range);
  if (days <= DAY_LIMIT) return "day";
  if (days <= WEEK_LIMIT) return "week";
  return "month";
}

export interface Bucket extends DateRange {
  /** A day (YYYY-MM-DD), a week (its first day inside the range) or a month (YYYY-MM). */
  key: string;
}

/** The bars of a chart: every day, week (Sunday to Saturday) or month of the range, cut at its ends. */
export function bucketsFor(range: DateRange, grouping: Grouping): Bucket[] {
  const out: Bucket[] = [];
  let start = range.from;
  while (start <= range.to) {
    let end: string;
    if (grouping === "day") end = start;
    else if (grouping === "week") end = addDays(start, 6 - new Date(toUtc(start)).getUTCDay());
    else end = monthBounds(periodOf(start)).to;
    if (end > range.to) end = range.to;
    out.push({ key: grouping === "month" ? periodOf(start) : start, from: start, to: end });
    start = addDays(end, 1);
  }
  return out;
}

/** The bucket a date falls in, by binary search; null outside the buckets. */
function bucketIndex(buckets: Bucket[], date: string): number {
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (date < buckets[mid].from) hi = mid - 1;
    else if (date > buckets[mid].to) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * One chart row per bucket: `period` is the bucket's key, and each entry adds to
 * the series `keyOf` names. The caller picks the keys (never a category name), so
 * a category called "period" cannot overwrite the bucket.
 */
export function chartRows(
  entries: ReportEntry[],
  buckets: Bucket[],
  keyOf: (e: ReportEntry) => string | null
): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = buckets.map((b) => ({ period: b.key }));
  for (const e of entries) {
    const i = bucketIndex(buckets, e.date);
    const key = i < 0 ? null : keyOf(e);
    if (key == null || key === "period") continue;
    rows[i][key] = (Number(rows[i][key] ?? 0)) + e.cents;
  }
  return rows;
}

const isRefund = (e: ReportEntry) => e.cents < 0;

export interface SpendingView {
  /** Every month of the range, YYYY-MM, none missing. */
  months: string[];
  /** One line per category, largest first. On Spending with refunds apart, what was spent on it. */
  lines: CategoryMonthSeries[];
  /** Everything that came back on spending categories (negative). Null when there was none, or on Income. */
  refunds: CategoryMonthSeries | null;
  /** The lines added up: on Spending, what was spent before refunds. */
  purchasesCents: number;
  /** The net total: the lines plus the refunds. */
  totalCents: number;
  totalByMonth: Record<string, number>;
}

/**
 * The ranked lines and the monthly figures of a range. `refundsApart` is the
 * Spending rule: an entry that brought money back goes to Refunds and credits.
 */
export function spendingView(entries: ReportEntry[], range: DateRange, refundsApart: boolean): SpendingView {
  const months = bucketsFor(range, "month").map((b) => b.key);
  const lines = new Map<string, CategoryMonthSeries>();
  const refunds: CategoryMonthSeries = { category: REFUNDS_LABEL, total: 0, byMonth: {} };
  const totalByMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
  let total = 0;
  for (const e of entriesIn(entries, range)) {
    const month = periodOf(e.date);
    const target = refundsApart && isRefund(e)
      ? refunds
      : lines.get(e.category) ?? lines.set(e.category, { category: e.category, total: 0, byMonth: {} }).get(e.category)!;
    target.total += e.cents;
    target.byMonth[month] = (target.byMonth[month] ?? 0) + e.cents;
    totalByMonth[month] = (totalByMonth[month] ?? 0) + e.cents;
    total += e.cents;
  }
  const ranked = [...lines.values()]
    .filter((l) => !refundsApart || l.total !== 0)
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
  return {
    months,
    lines: ranked,
    refunds: refundsApart && refunds.total !== 0 ? refunds : null,
    purchasesCents: ranked.reduce((sum, l) => sum + l.total, 0),
    totalCents: total,
    totalByMonth,
  };
}

export interface FlowBaseline {
  /** Per category, summed over the ranges before any averaging: purchases on Spending with refunds apart. */
  raw: Map<string, number>;
  refundsRaw: number;
  totalRaw: number;
}

/** A comparison's sums, split the way the period's figures are, so the two read alike. */
export function flowBaseline(entries: ReportEntry[], ranges: DateRange[], refundsApart: boolean): FlowBaseline {
  const raw = new Map<string, number>();
  let refundsRaw = 0;
  let totalRaw = 0;
  for (const range of ranges) {
    for (const e of entriesIn(entries, range)) {
      totalRaw += e.cents;
      if (refundsApart && isRefund(e)) refundsRaw += e.cents;
      else raw.set(e.category, (raw.get(e.category) ?? 0) + e.cents);
    }
  }
  return { raw, refundsRaw, totalRaw };
}
