// src/domain/categorizations.ts
//
// Notes on transactions and the log of categorizations, so any filing can be
// undone. Pure: the server validates with
// the same functions the screens use to build a filing.
import { validateChoice, type RecurringChoice, type RecurringChoiceInput } from "./recurring-choices";
import { ruleKeyFor, type CategorizationRule } from "./rules";
import type { TransactionAdjustment } from "./adjustments";
import type { NormalizedTxn } from "./types";

/** How far back the Recent categorizations list reaches. Older rows stay in the table. */
export const RECENT_DAYS = 30;

/** What "This repeats" asks for: a mark saved, or the user's mark removed. */
export type RecurringChange =
  | { action: "save"; choice: RecurringChoiceInput }
  | { action: "remove"; payeeKey: string; accountId: string; amountCents?: number | null };

/** One filing as the screen sends it: POST /api/categorizations. */
export interface FilingInput {
  sourceTransactionId: string;
  label: string;
  fromCategory: string;
  toCategory: string;
  rule: Omit<CategorizationRule, "id"> | null;
  adjustment: TransactionAdjustment | null;
  /** Absent: the note is left as it is. A string replaces it; "" deletes it. */
  note?: string;
  /** Absent: the recurring mark is left as it is. */
  recurring?: RecurringChange;
}

/** The user's note on one transaction (migration 0031). */
export interface TransactionNote {
  sourceTransactionId: string;
  note: string;
  /** ISO timestamp, set by the server. */
  updatedAt: string;
}

/** One filing made through the category picker, and what it wrote. */
export interface CategorizationLogEntry {
  id: number;
  createdAt: string;
  sourceTransactionId: string;
  /** The merchant as shown when it was filed. */
  label: string;
  /** What the user saw before and after, for the Recent categorizations list. */
  fromCategory: string;
  toCategory: string;
  ruleId: number | null;
  adjustmentId: number | null;
  /** Set when the filing touched a recurring mark. */
  recurringPayeeKey: string | null;
  recurringAccountId: string | null;
  /** The mark before the filing (null: there was none). */
  priorRecurringChoice: RecurringChoice | null;
  /** The mark the filing left (null: it removed the mark). */
  writtenRecurringChoice: RecurringChoice | null;
  undoneAt: string | null;
}

/** The longest note kept (plan call 5). */
export const NOTE_MAX = 1000;

/** A note as typed, trimmed; or the plain-words reason it is refused. "" means delete. */
export function cleanNote(raw: unknown): { note: string } | string {
  if (typeof raw !== "string") return "A note must be text.";
  const note = raw.trim();
  if (note.length > NOTE_MAX) return "A note can be at most 1,000 characters.";
  return { note };
}

const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Hand decisions sit at 100, above every learned rule (400/500). The server sets it, not the screen. */
export const HAND_PRIORITY = 100;

function cleanRule(raw: unknown): Omit<CategorizationRule, "id"> | null | string {
  if (raw == null) return null;
  if (typeof raw !== "object") return "Unknown rule.";
  const r = raw as Record<string, unknown>;
  // A blank payeeContains would match every transaction in the database.
  const payeeContains = text(r.payeeContains);
  if (!payeeContains) return "This transaction has no merchant name, so it cannot become a rule.";
  const note = text(r.note) || null;
  if (r.action === "transfer") return { priority: HAND_PRIORITY, payeeContains, action: "transfer", note };
  if (r.action !== "categorize") return "Unknown rule.";
  const toCategory = text(r.toCategory);
  if (!toCategory) return "Pick a category first.";
  return { priority: HAND_PRIORITY, payeeContains, action: "categorize", toCategory, note };
}

function cleanAdjustment(raw: unknown, rowId: string): TransactionAdjustment | null | string {
  if (raw == null) return null;
  if (typeof raw !== "object") return "Unknown change.";
  const a = raw as Record<string, unknown>;
  if (a.matchKind !== "id") return "Unknown change.";
  if (a.sourceTransactionId !== rowId) return "That change is for a different transaction.";
  const note = text(a.note) || null;
  if (a.action === "transfer") return { matchKind: "id", sourceTransactionId: rowId, action: "transfer", toCategory: null, note };
  if (a.action !== "recategorize") return "Unknown change.";
  const toCategory = text(a.toCategory);
  if (!toCategory) return "Pick a category first.";
  return { matchKind: "id", sourceTransactionId: rowId, action: "recategorize", toCategory, note };
}

function cleanRecurring(raw: unknown): RecurringChange | undefined | string {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object") return "Unknown choice.";
  const r = raw as Record<string, unknown>;
  if (r.action === "remove") {
    const payeeKey = text(r.payeeKey);
    const accountId = text(r.accountId);
    if (!payeeKey || !accountId) return "Unknown choice.";
    if (r.amountCents === undefined || r.amountCents === null) return { action: "remove", payeeKey, accountId };
    if (typeof r.amountCents !== "number" || !Number.isInteger(r.amountCents) || r.amountCents <= 0) return "The amount is whole dollars and cents, above zero.";
    return { action: "remove", payeeKey, accountId, amountCents: r.amountCents };
  }
  if (r.action !== "save") return "Unknown choice.";
  const choice = validateChoice(r.choice);
  return typeof choice === "string" ? choice : { action: "save", choice };
}

/** A filing as the screen sends it, or the plain-words reason it is refused. */
export function validateFiling(input: unknown): FilingInput | string {
  if (!input || typeof input !== "object") return "Unknown filing.";
  const raw = input as Record<string, unknown>;
  const sourceTransactionId = text(raw.sourceTransactionId, 500);
  if (!sourceTransactionId) return "Unknown transaction.";
  const rule = cleanRule(raw.rule);
  if (typeof rule === "string") return rule;
  const adjustment = cleanAdjustment(raw.adjustment, sourceTransactionId);
  if (typeof adjustment === "string") return adjustment;
  if (!rule && !adjustment) return "Pick a category first.";
  let note: string | undefined;
  if (raw.note !== undefined) {
    const checked = cleanNote(raw.note);
    if (typeof checked === "string") return checked;
    note = checked.note;
  }
  const recurring = cleanRecurring(raw.recurring);
  if (typeof recurring === "string") return recurring;
  return {
    sourceTransactionId,
    label: text(raw.label) || "This transaction",
    fromCategory: text(raw.fromCategory) || "Uncategorized",
    toCategory: text(raw.toCategory) || "Uncategorized",
    rule,
    adjustment,
    ...(note !== undefined ? { note } : {}),
    ...(recurring ? { recurring } : {}),
  };
}

/**
 * What a filing writes for this row: the same choice both screens made before
 * (NowSection.file and TransactionsSection.apply), now in one place.
 * Null when nothing can be written (Waiting on you, on a row with no merchant name).
 */
export function buildFiling(a: {
  txn: NormalizedTxn;
  choice: string;
  isTransfer: boolean;
  from: "Now" | "Transactions";
  needsCategory: boolean;
  alsoRule: boolean;
}): Pick<FilingInput, "rule" | "adjustment"> | null {
  const key = ruleKeyFor(a.txn);
  const note = `Set from ${a.from}`;
  const rule: Omit<CategorizationRule, "id"> | null = key
    ? a.isTransfer
      ? { priority: HAND_PRIORITY, payeeContains: key, action: "transfer", note }
      : { priority: HAND_PRIORITY, payeeContains: key, action: "categorize", toCategory: a.choice, note }
    : null;
  const adjustment: TransactionAdjustment = {
    matchKind: "id",
    sourceTransactionId: a.txn.sourceTransactionId,
    action: a.isTransfer ? "transfer" : "recategorize",
    toCategory: a.isTransfer ? null : a.choice,
    note,
  };
  if (a.from === "Now") return rule ? { rule, adjustment: null } : null;
  // A blank row takes the forward rule (rules fill blanks); with no key, the one-row change.
  if (a.needsCategory) return rule ? { rule, adjustment: null } : { rule: null, adjustment };
  // A filed row: rules never overwrite a category, so the one-row change, plus the rule when asked.
  return { rule: a.alsoRule ? rule : null, adjustment };
}

/** How far a filing reached, for the Recent categorizations list. */
export function filingScope(e: Pick<CategorizationLogEntry, "ruleId" | "adjustmentId">): string {
  if (e.ruleId != null && e.adjustmentId != null) return "This transaction, and every one from this merchant";
  return e.ruleId != null ? "Every transaction from this merchant" : "This transaction";
}
