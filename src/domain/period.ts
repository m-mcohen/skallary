// src/domain/period.ts -- YYYY-MM period helpers shared by goals and the UI.
//
// Periods are plain "YYYY-MM" strings everywhere in this app (budget lines,
// forecast rows, scenarios). `addMonths` lives in scenario.ts; these are the
// pieces goals.ts and the Goals/Wish List sections needed in common so the
// month arithmetic is not re-derived per file.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The YYYY-MM period a YYYY-MM-DD date (or ISO timestamp) falls in. */
export function periodOf(dateIso: string): string {
  return dateIso.slice(0, 7);
}

/** Months since year 0 -- subtracting two of these gives whole months apart. */
export function monthIndex(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return y * 12 + (m - 1);
}

/** Inverse of monthIndex. */
export function periodFromIndex(idx: number): string {
  const y = Math.floor(idx / 12);
  const m = idx - y * 12 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Every YYYY-MM period from start to end, both included; empty when end is earlier. */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let i = monthIndex(start); i <= monthIndex(end); i++) out.push(periodFromIndex(i));
  return out;
}

/**
 * First and last day of a YYYY-MM period, both inclusive, as YYYY-MM-DD.
 *
 * Throws on anything that is not a real month. A ledger link built from a bad
 * period would open a list that quietly does not match the figure clicked, and
 * a loud failure is the better of the two.
 */
export function monthBounds(period: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const month = m ? Number(m[2]) : 0;
  if (!m || month < 1 || month > 12) throw new Error(`Not a month: ${period}`);
  // Day 0 of the following month is the last day of this one.
  const last = new Date(Date.UTC(Number(m[1]), month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}

/** "2026-09" -> "September 2026"; anything unparseable is returned as-is. */
export function formatPeriodLabel(period: string): string {
  const [y, m] = period.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 && y ? `${MONTH_NAMES[idx]} ${y}` : period;
}

const SHORT_MONTHS = MONTH_NAMES.map((name) => name.slice(0, 3));

/** "2026-09" -> "Sep 2026"; anything that is not a month key is returned as-is. */
export function formatMonthShort(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const idx = m ? Number(m[2]) - 1 : -1;
  return m && idx >= 0 && idx < 12 ? `${SHORT_MONTHS[idx]} ${m[1]}` : period;
}

/** A moment as its local calendar date, "2026-09-30". A UTC date (toISOString) is the next day on the last evening of a month in a zone behind UTC. */
export function localDateIso(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "2026-08-05" -> "Aug 5" (or "Aug 5, 2026" with the year). Dates are read as plain calendar dates, never shifted by a timezone. */
function formatDay(dateIso: string, withYear: boolean): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const day = `${SHORT_MONTHS[m - 1] ?? "?"} ${d}`;
  return withYear ? `${day}, ${y}` : day;
}

/** "Sep 30" this year, "Nov 2, 2025" otherwise. `today` is a local ISO date. */
export function formatShortDate(dateIso: string, today: string = localDateIso()): string {
  return formatDay(dateIso, dateIso.slice(0, 4) !== today.slice(0, 4));
}

/** True when `rangeTo` falls inside `period` before its last day: the month is not over in this range. */
export function isPartialMonth(period: string, rangeTo: string | null): boolean {
  return rangeTo !== null && periodOf(rangeTo) === period && rangeTo !== monthBounds(period).to;
}

/** "Oct 2026 (through Oct 1)" for a month the range ends inside, else "Sep 2026". */
export function monthHeading(period: string, rangeTo: string | null): string {
  const label = formatMonthShort(period);
  return isPartialMonth(period, rangeTo) ? `${label} (through ${formatDay(rangeTo!, false)})` : label;
}

/** The line under a chart whose last month is not over: "* Oct 2026 runs through Oct 1." */
export function partialMonthNote(periods: string[], rangeTo: string | null): string | null {
  const last = periods[periods.length - 1];
  if (!last || !isPartialMonth(last, rangeTo)) return null;
  return `* ${formatMonthShort(last)} runs through ${formatDay(rangeTo!, false)}.`;
}

/** An inclusive range in words, for a ledger header: "Aug 1 to Aug 31, 2026". */
export function formatDateRange(from: string | null, to: string | null): string {
  if (!from && !to) return "All dates";
  if (from && !to) return `From ${formatDay(from, true)}`;
  if (!from && to) return `Through ${formatDay(to, true)}`;
  if (from === to) return formatDay(from!, true);
  const sameYear = from!.slice(0, 4) === to!.slice(0, 4);
  return `${formatDay(from!, !sameYear)} to ${formatDay(to!, true)}`;
}

// ---------------------------------------------------------------------------
// Date periods: the range the history screens (Reports, Net worth,
// Transactions) are looking at. Pure: "today" is always passed in as `asOf`, a
// YYYY-MM-DD calendar date, so nothing here depends on the clock.
// ---------------------------------------------------------------------------

export type PeriodPresetId =
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "last-3"
  | "last-12"
  | "ytd"
  | "last-year"
  | "all"
  | "custom";

export interface Period {
  preset: PeriodPresetId;
  /** YYYY-MM-DD, inclusive. Null means no limit on that side. */
  from: string | null;
  to: string | null;
}

/** In the order the picker lists them. "custom" is not a preset; it is what a typed range is. */
export const PERIOD_PRESETS: { id: Exclude<PeriodPresetId, "custom">; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-quarter", label: "This quarter" },
  { id: "last-3", label: "Last 3 months" },
  { id: "last-12", label: "Last 12 months" },
  { id: "ytd", label: "Year to date" },
  { id: "last-year", label: "Last year" },
  { id: "all", label: "All time" },
];

export const DEFAULT_PRESET: Exclude<PeriodPresetId, "custom"> = "last-12";

/**
 * A preset as of a given day.
 *
 * "Last 3 months" and "Last 12 months" mean the current month to date plus the
 * 2 or 11 complete months before it, so the newest data is always in view.
 * "Last month" and "Last year" are complete. Every to-date preset ends on
 * `asOf`, which is what lets a comparison line up the same days of another month.
 */
export function resolvePeriod(preset: Exclude<PeriodPresetId, "custom">, asOf: string): Period {
  const thisMonth = monthIndex(periodOf(asOf));
  const year = asOf.slice(0, 4);
  const startOf = (idx: number) => `${periodFromIndex(idx)}-01`;
  switch (preset) {
    case "this-month":
      return { preset, from: startOf(thisMonth), to: asOf };
    case "last-month":
      return { preset, ...monthBounds(periodFromIndex(thisMonth - 1)) };
    case "this-quarter":
      return { preset, from: startOf(thisMonth - ((thisMonth % 12) % 3)), to: asOf };
    case "last-3":
      return { preset, from: startOf(thisMonth - 2), to: asOf };
    case "last-12":
      return { preset, from: startOf(thisMonth - 11), to: asOf };
    case "ytd":
      return { preset, from: `${year}-01-01`, to: asOf };
    case "last-year": {
      const last = Number(year) - 1;
      return { preset, from: `${last}-01-01`, to: `${last}-12-31` };
    }
    case "all":
      return { preset, from: null, to: null };
  }
}

/** A typed range. Kept in order even when the two dates arrive backwards. */
export function customPeriod(from: string | null, to: string | null): Period {
  if (from && to && from > to) return { preset: "custom", from: to, to: from };
  return { preset: "custom", from, to };
}

/** A real calendar date in YYYY-MM-DD, or null. "2026-02-30" has the shape and is not a date. */
export function validDate(raw: string | null | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

/** The link's form: `period=<preset>` for a preset, `from` and `to` for a typed range. */
export function periodToQuery(period: Period): Record<string, string> {
  if (period.preset !== "custom") return { period: period.preset };
  const out: Record<string, string> = {};
  if (period.from) out.from = period.from;
  if (period.to) out.to = period.to;
  return out;
}

/**
 * The period a link names, or null when it names none. A preset is resolved
 * against `asOf`, so an old bookmark of "This month" means this month. A link
 * with anything malformed is null rather than a guess: the caller falls back to
 * the remembered period, which is at least one the person chose.
 */
export function periodFromQuery(q: URLSearchParams, asOf: string): Period | null {
  const named = q.get("period");
  if (named) {
    const preset = PERIOD_PRESETS.find((p) => p.id === named);
    return preset ? resolvePeriod(preset.id, asOf) : null;
  }
  const rawFrom = q.get("from");
  const rawTo = q.get("to");
  if (rawFrom == null && rawTo == null) return null;
  const from = validDate(rawFrom);
  const to = validDate(rawTo);
  if ((rawFrom != null && !from) || (rawTo != null && !to)) return null;
  return customPeriod(from, to);
}

/** "Last 12 months", or the range in words for a typed one. */
export function periodLabel(period: Period): string {
  const preset = PERIOD_PRESETS.find((p) => p.id === period.preset);
  return preset ? preset.label : formatDateRange(period.from, period.to);
}

/** Inclusive at both ends. Dates are ISO, so string comparison is date comparison. */
export function inPeriod(dateIso: string, period: Period): boolean {
  const day = dateIso.slice(0, 10);
  if (period.from && day < period.from) return false;
  if (period.to && day > period.to) return false;
  return true;
}

/**
 * The part of a range the period covers. A month column in a period that ends
 * mid-month holds only the days up to that end, so the ledger it links to must
 * be cut at the same day or the two would not add up to the same figure.
 */
export function clampToPeriod(
  range: { from: string; to: string },
  period: Period
): { from: string; to: string } {
  return {
    from: period.from && period.from > range.from ? period.from : range.from,
    to: period.to && period.to < range.to ? period.to : range.to,
  };
}
