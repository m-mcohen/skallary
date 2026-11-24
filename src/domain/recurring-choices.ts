// src/domain/recurring-choices.ts
//
// The user's corrections to the recurring charges. "Not recurring" hides a charge the app found; "Mark as recurring" makes one
// from a merchant the app missed, at the rhythm the user picks. One choice per merchant
// key and account, stored in recurring_choices (migration 0024); detectRecurring
// applies them. Pure: the server validates with the same function the UI trusts.
import { bestCadence, daysBetween, median, type Cadence } from "./recurring";

export type RecurringChoiceKind = "recurring" | "not_recurring";

export interface RecurringChoice {
  /** The merchant key (rules.ts ruleKeyFor). */
  payeeKey: string;
  /** The account the choice was made on; it follows the charge across an account move. */
  accountId: string;
  choice: RecurringChoiceKind;
  /** How often it repeats; set only for "recurring". */
  cadence: Cadence | null;
  /**
   * The charge's size in cents, above zero, when the choice covers only the merchant's
   * charges near that amount. Null or absent: every
   * charge of the merchant, as before.
   */
  amountCents?: number | null;
  /** The name shown, kept so a hidden charge can be listed after its payments age out. */
  label: string;
  /** ISO timestamp, set by the server. The newer choice wins where two meet. */
  createdAt: string;
}

export type RecurringChoiceInput = Omit<RecurringChoice, "createdAt">;

/** In the order the dialog lists them. */
export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
  quarterly: "Every 3 months",
  annual: "Every year",
};

const CADENCES = Object.keys(CADENCE_LABELS) as Cadence[];

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A choice as sent by the screen, or the plain-words reason it is refused. */
export function validateChoice(input: unknown): RecurringChoiceInput | string {
  if (!input || typeof input !== "object") return "Unknown choice.";
  const raw = input as Record<string, unknown>;
  if (raw.choice !== "recurring" && raw.choice !== "not_recurring") return "Unknown choice.";
  const payeeKey = text(raw.payeeKey);
  if (!payeeKey) return "This charge has no merchant name, so it cannot be recurring.";
  const accountId = text(raw.accountId);
  if (!accountId) return "This charge has no account.";
  let cadence: Cadence | null = null;
  if (raw.choice === "recurring") {
    if (!CADENCES.includes(raw.cadence as Cadence)) return "Pick how often it repeats.";
    cadence = raw.cadence as Cadence;
  }
  let amountCents: number | null = null;
  if (raw.amountCents !== undefined && raw.amountCents !== null) {
    if (typeof raw.amountCents !== "number" || !Number.isInteger(raw.amountCents) || raw.amountCents <= 0) {
      return "The amount is whole dollars and cents, above zero.";
    }
    amountCents = raw.amountCents;
  }
  return { payeeKey, accountId, choice: raw.choice, cadence, ...(amountCents === null ? {} : { amountCents }), label: text(raw.label).slice(0, 200) || payeeKey };
}

/** The rhythm a merchant's payments suggest, to preselect in the dialog; null when they suggest none. */
export function guessCadence(dates: string[]): Cadence | null {
  const sorted = [...dates].sort();
  if (sorted.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1], sorted[i]));
  return bestCadence(median(gaps));
}
