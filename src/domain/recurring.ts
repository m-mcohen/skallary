// src/domain/recurring.ts
//
// Detect recurring merchant series over prepared transactions.
//
// Pure, and the whole engine sits here so it is unit-testable and the Bills
// screen stays presentational. Amount tolerance and interval tolerance are
// the two knobs -- Netflix at $15.99 for six months is one series; a $500
// one-off from the same merchant is not.
//
// A merchant is identified by normalized payee, using the same lowercased key
// ruleKeyFor produces so this file agrees with what the review queue matches
// on -- "AMZN Mktp US" and "Amazon" would otherwise look like two series.
import { classify } from "./dedup";
import { ruleKeyFor } from "./rules";
import type { NormalizedTxn } from "./types";
import type { RecurringChoice } from "./recurring-choices";

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30.5,
  quarterly: 91,
  annual: 365,
};

/** Fraction of the cadence's ideal length the median may drift and still qualify. */
const INTERVAL_TOLERANCE = 0.2;

/** Fraction of the median amount an individual charge may drift and still qualify. */
const AMOUNT_TOLERANCE = 0.35;

/** Minimum occurrences before a cadence is a claim. */
const MIN_OCCURRENCES = 3;

export interface RecurringCharge {
  /** sourceTransactionId */
  id: string;
  date: string;
  /** Signed, as stored: a payment is negative. */
  amountCents: number;
}

export interface RecurringSeries {
  key: string;
  label: string;
  /** The account of the newest run: where the next charge is expected. */
  accountId: string;
  /**
   * Every account the run was charged on, oldest first. More than one when the
   * same merchant moved from an old account record to a newer one.
   */
  accountIds: string[];
  cadence: Cadence;
  /** The usual amount: the middle of the last 3 charges (usualAmount). */
  typicalAmountCents: number;
  amountBandCents: number;
  lastSeen: string;
  nextExpected: string;
  occurrenceCount: number;
  lastFewAmounts: number[];
  planningCategory: string | null;
  /** The payments counted, oldest first. */
  charges: RecurringCharge[];
  /** "found" by the tests below, or "marked" by the user on Transactions. */
  source: "found" | "marked";
  /** The amount the user's mark names, when it covers only the charges near it; null otherwise. */
  markAmountCents: number | null;
}

/** Whether a charge of `amountCents` (absolute) is one of an amount mark's; a mark with no amount takes every charge. */
export function nearAmount(amountCents: number, markAmountCents: number | null | undefined): boolean {
  if (markAmountCents == null) return true;
  return Math.abs(Math.abs(amountCents) - markAmountCents) / markAmountCents <= AMOUNT_TOLERANCE;
}

export interface BillsAudit {
  detectedSeries: RecurringSeries[];
  unbudgetedSeries: RecurringSeries[];
  missingActuals: string[];
}

/**
 * The longest silence between an old account record's last charge and the new
 * record's first that still reads as one bill moving. Two months: a monthly
 * bill skips at most one charge across the move.
 */
export const JOIN_GAP_DAYS = 62;

export function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime();
  return Math.round(ms / 86_400_000);
}

function addDays(date: string, days: number): string {
  // Arithmetic on a calendar date pinned to UTC midnight, so UTC is the right frame here (not "today").
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

const pad = (n: number) => String(n).padStart(2, "0");

const CADENCE_MONTHS: Partial<Record<Cadence, number>> = { monthly: 1, quarterly: 3, annual: 12 };

/**
 * The date `step` charges after `last`. Weekly rhythms count days. Monthly,
 * quarterly and yearly ones land on the same day of the month as `last`, or on
 * the month's last day when it is shorter: a bill on the 31st is due Feb 28,
 * then Mar 31 again, because every step is measured from `last` itself. Before
 * a monthly bill was predicted 30.5 days on, so one charged on the
 * 15th was expected on the 16th.
 */
export function nextDate(last: string, cadence: Cadence, step = 1): string {
  const months = CADENCE_MONTHS[cadence];
  if (months == null) return addDays(last, CADENCE_DAYS[cadence] * step);
  const [y, m, d] = last.split("-").map(Number);
  const index = y * 12 + (m - 1) + months * step;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`;
}

export function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * A bill's usual amount: the middle of its last 3 charges, oldest first in,
 * so a price change shows after two bills. The middle of every charge kept an old price for months.
 */
export function usualAmount(amountsOldestFirst: number[]): number {
  return median(amountsOldestFirst.slice(-3));
}

export function bestCadence(medianGap: number): Cadence | null {
  let best: Cadence | null = null;
  let bestScore = Infinity;
  for (const [name, ideal] of Object.entries(CADENCE_DAYS) as [Cadence, number][]) {
    const drift = Math.abs(medianGap - ideal) / ideal;
    if (drift <= INTERVAL_TOLERANCE && drift < bestScore) {
      best = name;
      bestScore = drift;
    }
  }
  return best;
}

/** One merchant on one account, oldest first. */
interface Run {
  accountId: string;
  rows: NormalizedTxn[];
}

/** Money out that is not money moving: the only rows that can be a bill. */
export function isBillCandidate(t: NormalizedTxn, mapping: Record<string, string>): boolean {
  // Money moving is not a bill: the matcher's flag, or a category that names a
  // transfer (a card payment).
  if (classify(t, mapping).kind === "transfer") return false;
  // A bill is money going out. A steady deposit (a paycheck) fit every other
  // test and was listed as a bill, in red parentheses.
  if (t.amountCents >= 0) return false;
  return ruleKeyFor(t) !== "";
}

/** Bill candidates by merchant key, then by account, each run oldest first. */
function runsByKey(txns: NormalizedTxn[], mapping: Record<string, string>): Map<string, Run[]> {
  const byKey = new Map<string, Map<string, NormalizedTxn[]>>();
  for (const t of txns) {
    if (!isBillCandidate(t, mapping)) continue;
    const key = ruleKeyFor(t);
    let accounts = byKey.get(key);
    if (!accounts) byKey.set(key, (accounts = new Map()));
    let rows = accounts.get(t.accountId);
    if (!rows) accounts.set(t.accountId, (rows = []));
    rows.push(t);
  }
  const out = new Map<string, Run[]>();
  for (const [key, accounts] of byKey) {
    out.set(
      key,
      [...accounts].map(([accountId, rows]) => ({
        accountId,
        rows: [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.sourceTransactionId.localeCompare(b.sourceTransactionId)),
      }))
    );
  }
  return out;
}

const firstDate = (r: Run) => r.rows[0].date;
const lastDate = (r: Run) => r.rows[r.rows.length - 1].date;

/**
 * One merchant's runs, joined across an account move. Runs are chained oldest
 * first when one ends before the next begins, no more than JOIN_GAP_DAYS apart.
 * If any two runs were charged over the same stretch of time, nothing is joined
 * for that merchant: two accounts paying at once are two real charges, and which one an older record continues would
 * be a guess.
 */
function joinRuns(runs: Run[]): Run[][] {
  const sorted = [...runs].sort((a, b) => firstDate(a).localeCompare(firstDate(b)));
  let latestEnd = "";
  for (const run of sorted) {
    if (latestEnd && firstDate(run) <= latestEnd) return sorted.map((r) => [r]);
    if (lastDate(run) > latestEnd) latestEnd = lastDate(run);
  }
  const chains: Run[][] = [];
  for (const run of sorted) {
    const chain = chains[chains.length - 1];
    if (chain && daysBetween(lastDate(chain[chain.length - 1]), firstDate(run)) <= JOIN_GAP_DAYS) chain.push(run);
    else chains.push([run]);
  }
  return chains;
}

/** The series a run of payments makes at a given rhythm. Null once it has lapsed. */
function seriesFrom(
  key: string,
  chain: Run[],
  cadence: Cadence,
  mapping: Record<string, string>,
  source: RecurringSeries["source"],
  asOf: string | undefined,
  markAmountCents: number | null = null
): RecurringSeries | null {
  const rows = chain.flatMap((r) => r.rows);
  const last = rows[rows.length - 1];
  const nextExpected = nextDate(last.date, cadence);
  // A series the app found that has gone a whole extra cycle past its next date has
  // stopped. One the user marked never lapses: the user's word is the test, and a
  // bill that stopped being paid is what the screen should name, until the user unmarks it.
  if (asOf && source === "found" && daysBetween(nextExpected, asOf) > CADENCE_DAYS[cadence]) return null;
  const amounts = rows.map((r) => r.amountCents);
  const middleOfAll = median(amounts);
  const sourceCat = last.sourceCategory;
  return {
    key,
    label: (last.payee ?? last.merchant ?? key) as string,
    accountId: chain[chain.length - 1].accountId,
    accountIds: chain.map((r) => r.accountId),
    cadence,
    typicalAmountCents: usualAmount(amounts),
    amountBandCents: Math.max(...amounts.map((a) => Math.abs(a - middleOfAll))),
    lastSeen: last.date,
    nextExpected,
    occurrenceCount: rows.length,
    lastFewAmounts: rows
      .slice(-3)
      .reverse()
      .map((r) => r.amountCents),
    planningCategory: sourceCat ? (mapping[sourceCat] ?? sourceCat) : null,
    charges: rows.map((r) => ({ id: r.sourceTransactionId, date: r.date, amountCents: r.amountCents })),
    source,
    markAmountCents,
  };
}

/** The rhythm a run of payments keeps, or null when it keeps none (the tests the app finds bills by). */
function foundCadence(rows: NormalizedTxn[]): Cadence | null {
  if (rows.length < MIN_OCCURRENCES) return null;

  // Interval fit.
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) gaps.push(daysBetween(rows[i - 1].date, rows[i].date));
  const medianGap = median(gaps);
  const cadence = bestCadence(medianGap);
  if (!cadence) return null;
  // Also reject when a single gap is wildly off the median: a monthly bill
  // with one 90-day skip is a broken series, not a recurring one. The
  // per-gap tolerance is doubled from INTERVAL_TOLERANCE to leave room for
  // holiday shifts on monthly bills without dropping them.
  const maxGapDrift = Math.max(...gaps.map((g) => Math.abs(g - medianGap) / medianGap));
  if (maxGapDrift > INTERVAL_TOLERANCE * 2) return null;

  // Amount fit, against the middle of EVERY charge (the usual amount is only
  // the last 3). Absolute so signs do not confuse the tolerance test.
  const amounts = rows.map((r) => r.amountCents);
  const typical = median(amounts);
  const absTypical = Math.abs(typical) || 1;
  const drifts = amounts.map((a) => Math.abs(a - typical) / absTypical);
  if (Math.max(...drifts) > AMOUNT_TOLERANCE) return null;
  return cadence;
}

export function detectRecurring(
  txns: NormalizedTxn[],
  mapping: Record<string, string>,
  /**
   * Today, YYYY-MM-DD. When given, a series that has gone a whole cycle past
   * its next expected date is dropped as lapsed, so a
   * subscription canceled years ago does not stay listed forever.
   */
  asOf?: string,
  /**
   * the user's corrections: "Not recurring" hides a charge, "Mark as
   * recurring" makes one at the rhythm the user picked. A choice applies to the run
   * whose accounts include its account, so it follows a charge across an
   * account move; when two choices meet on one run, the newer one wins.
   */
  choices: RecurringChoice[] = []
): RecurringSeries[] {
  // Grouped by merchant key, then by account. Amount is not part of the key
  // because a bill can drift in size and still be one series -- but the
  // amount check discards a run whose values are not tight enough.
  const out: RecurringSeries[] = [];
  for (const [key, runs] of runsByKey(txns, mapping)) {
    /** The newest whole-merchant choice on any account of these runs, or undefined. */
    const latestChoice = (runsIn: Run[]) => {
      const accounts = new Set(runsIn.map((r) => r.accountId));
      return choices
        .filter((c) => c.payeeKey === key && accounts.has(c.accountId) && c.amountCents == null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    };
    for (const whole of joinRuns(runs)) {
      // The user's amount marks first: each takes the merchant's charges near
      // its amount out of the run, as its own charge ("recurring") or hidden
      // ("not_recurring"); the rest of the run goes on as before. The newest mark per
      // amount wins.
      const accountsOf = new Set(whole.map((r) => r.accountId));
      const amountMarks = new Map<number, RecurringChoice>();
      for (const c of choices
        .filter((c) => c.payeeKey === key && accountsOf.has(c.accountId) && c.amountCents != null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        amountMarks.set(c.amountCents as number, c);
      }
      let chain = whole;
      for (const mark of amountMarks.values()) {
        const near = (t: NormalizedTxn) => nearAmount(t.amountCents, mark.amountCents);
        const taken = chain.map((r) => ({ accountId: r.accountId, rows: r.rows.filter(near) })).filter((r) => r.rows.length > 0);
        chain = chain.map((r) => ({ accountId: r.accountId, rows: r.rows.filter((t) => !near(t)) })).filter((r) => r.rows.length > 0);
        if (mark.choice === "recurring" && mark.cadence && taken.length > 0) {
          const series = seriesFrom(key, taken, mark.cadence, mapping, "marked", asOf, mark.amountCents as number);
          if (series) out.push(series);
        }
      }
      if (chain.length === 0) continue;
      const chainChoice = latestChoice(chain);
      // A mark needs no minimum count, rhythm or amount test: the user's word is the test,
      // and it covers the whole joined run.
      if (chainChoice?.choice === "recurring" && chainChoice.cadence) {
        const series = seriesFrom(key, chain, chainChoice.cadence, mapping, "marked", asOf);
        if (series) out.push(series);
        continue;
      }
      // A joined run that fails the tests is judged account by account, as before the
      // join existed: an old record's years of swinging electric bills (or a long gap)
      // must not sink the steady run on the new one.
      const joined = foundCadence(chain.flatMap((r) => r.rows));
      const candidates = joined || chain.length === 1 ? [chain] : chain.map((r) => [r]);
      for (const candidate of candidates) {
        // A choice applies to the charge as shown: the whole joined run (so a hide follows
        // an account move), or one account's run when the runs are shown apart.
        const choice = candidates.length === 1 ? chainChoice : latestChoice(candidate);
        if (choice?.choice === "not_recurring") continue;
        const marked = choice?.choice === "recurring" ? choice.cadence : null;
        const cadence = marked ?? foundCadence(candidate.flatMap((r) => r.rows));
        if (!cadence) continue;
        const series = seriesFrom(key, candidate, cadence, mapping, marked ? "marked" : "found", asOf);
        if (series) out.push(series);
      }
    }
  }
  return out.sort((a, b) => a.nextExpected.localeCompare(b.nextExpected));
}

/**
 * Cross-reference detected series with the recurring lines on the budget.
 *
 * The cross-check is the value: a series with no budget line is a bill you
 * are not planning for, and a budget line with no series is either a dead
 * subscription or a feed that stopped reporting it. Both are actionable in
 * ways the raw list is not.
 */
export function auditAgainstBudget(
  series: RecurringSeries[],
  recurringCategories: string[]
): BillsAudit {
  const budgeted = new Set(recurringCategories);
  const detectedCats = new Set(
    series.map((s) => s.planningCategory).filter((c): c is string => Boolean(c))
  );
  return {
    detectedSeries: series,
    unbudgetedSeries: series.filter(
      (s) => !s.planningCategory || !budgeted.has(s.planningCategory)
    ),
    missingActuals: [...budgeted].filter((c) => !detectedCats.has(c)),
  };
}


/** Whether a transaction is one of a recurring charge's payments: same merchant key, one of its accounts. */
export function isRecurringTxn(series: RecurringSeries[], t: NormalizedTxn): boolean {
  const key = ruleKeyFor(t);
  return key !== "" && series.some((s) => s.key === key && s.accountIds.includes(t.accountId));
}
