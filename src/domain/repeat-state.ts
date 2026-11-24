// src/domain/repeat-state.ts -- "This repeats" in the category picker. What the box shows for a row, and what
// ticking or unticking it changes. Pure; both screens use it.
import { isBillCandidate, nearAmount, type Cadence, type RecurringSeries } from "./recurring";
import { guessCadence, type RecurringChoice } from "./recurring-choices";
import type { RecurringChange } from "./categorizations";
import { ruleKeyFor } from "./rules";
import type { NormalizedTxn } from "./types";

export interface RepeatState {
  payeeKey: string;
  accountId: string;
  /** The merchant as shown, kept with a mark so a hidden charge can still be listed. */
  label: string;
  /** How often it repeats now; null when it is not a recurring charge. */
  current: Cadence | null;
  /** "mine": the user marked it. "found": the app found it. null: not recurring. */
  source: "mine" | "found" | null;
  /** Preselected in How often: the current rhythm, else the app's guess from past dates, else Every month. */
  guess: Cadence;
  /** This row's amount, for "Only charges of about $X". */
  amountCents: number;
  /** The amount of the mark this row sits under, when that mark names one; null otherwise. */
  markAmountCents: number | null;
}

/** Null when the row could not be a bill: the same test as the repeat icon on Transactions. */
export function repeatStateFor(
  t: NormalizedTxn,
  label: string,
  ctx: { prepared: NormalizedTxn[]; mapping: Record<string, string>; series: RecurringSeries[]; choices: RecurringChoice[] }
): RepeatState | null {
  if (!isBillCandidate(t, ctx.mapping)) return null;
  const payeeKey = ruleKeyFor(t);
  const amountCents = Math.abs(t.amountCents);
  // An amount mark covers only the charges near its amount; the row reads against the
  // series that takes it.
  const series = ctx.series.find((s) => s.key === payeeKey && s.accountIds.includes(t.accountId) && nearAmount(amountCents, s.markAmountCents));
  const mine = ctx.choices.some(
    (c) => c.payeeKey === payeeKey && c.accountId === t.accountId && c.choice === "recurring" && nearAmount(amountCents, c.amountCents ?? null),
  );
  const dates = ctx.prepared
    .filter((x) => x.accountId === t.accountId && ruleKeyFor(x) === payeeKey && isBillCandidate(x, ctx.mapping))
    .map((x) => x.date);
  return {
    payeeKey,
    accountId: t.accountId,
    label,
    current: series?.cadence ?? null,
    source: series ? (mine ? "mine" : "found") : null,
    guess: series?.cadence ?? guessCadence(dates) ?? "monthly",
    amountCents,
    markAmountCents: series?.markAmountCents ?? null,
  };
}

/**
 * What the box asks for, or undefined when it is left as it was. Unticking the user's
 * own mark removes it (Show again); unticking one the app found records Not
 * recurring, the same as that button on the Recurring screen (plan call 1).
 */
export function recurringChange(state: RepeatState | null, ticked: boolean, cadence: Cadence, onlyAmount = false): RecurringChange | undefined {
  if (!state) return undefined;
  const base = { payeeKey: state.payeeKey, accountId: state.accountId, label: state.label };
  if (ticked) {
    // "Only charges of about $X" names this row's amount.
    const amount = onlyAmount ? state.amountCents : null;
    if (state.current === cadence && (state.markAmountCents ?? null) === amount) return undefined;
    return { action: "save", choice: { ...base, choice: "recurring", cadence, ...(amount === null ? {} : { amountCents: amount }) } };
  }
  if (!state.current) return undefined;
  if (state.source === "mine") {
    return { action: "remove", payeeKey: state.payeeKey, accountId: state.accountId, ...(state.markAmountCents === null ? {} : { amountCents: state.markAmountCents }) };
  }
  return { action: "save", choice: { ...base, choice: "not_recurring", cadence: null } };
}
