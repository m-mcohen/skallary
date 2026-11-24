// src/domain/merchants.ts
//
// Merchants, Monarch's vendor feature.
//
// One clean name per merchant, worked out at READ time. Nothing in a transaction
// is ever rewritten, so removing a rename undoes it, past rows and future rows
// alike. The order:
//   1. the rename list the user approved, matched on the bank's exact name, ignoring case;
//   2. else the one automatic clean: a Zelle name loses the reference code at its end;
//   3. then the rename list again, on the cleaned name, following an entry that
//      names another entry (a loop stops where it started).
// Nothing else merges by itself: "Amazon and Amazon Prime are two different
// things." Merges the user might want are SUGGESTED, one pair at a time, and only the user's
// Accept writes a rename.
//
// Rules and recurring keep reading the bank's name (the user's option A): nothing here is
// passed to applyRules, ruleKeyFor or detectRecurring.
//
// A row the old
// Monarch export named just "Zelle" can be named by the person in its bank note
// (zelleNameFromMemo), behind a setting that starts OFF until the user has looked over
// the names it would create. With it on, that name stands in for the bank's name
// before the rename list is read, so a rename of the person's name applies to it.
import type { NormalizedTxn } from "./types";
import { bucketsFor, entriesIn, monthlyAverage, type DateRange, type ReportEntry } from "./report-view";

/** Shown for a row whose bank sent no name at all. */
export const NO_MERCHANT_NAME = "No merchant name";

/** The name the bank sent: the name the Transactions list has always shown. */
export function bankName(t: Pick<NormalizedTxn, "payee" | "merchant" | "description">): string {
  return (t.payee ?? t.merchant ?? t.description ?? "").trim();
}

/**
 * The Zelle reference code: SimpleFIN's Zelle names end in a per-payment code,
 * so one person read as a new name every time. In practice it is a short bank prefix, two digits and seven more letters and digits. The
 * pattern is a little wider than that, and no wider than it needs to be: the name
 * starts with "Zelle", and its last word is 8 or more letters and digits with at
 * least one of each. A last word of digits only is kept ("Room 12345678").
 */
const ZELLE_CODE = /^(zelle\b.*\S)\s+(?=[a-z0-9]*[0-9])(?=[a-z0-9]*[a-z])[a-z0-9]{8,}$/i;

/** The one automatic clean: a Zelle name without its reference code. Every other name is returned as it is. */
export function cleanMerchantName(name: string): string {
  const m = ZELLE_CODE.exec(name);
  return m ? m[1] : name;
}

export interface MerchantRename {
  /** The bank's name (or a name the Zelle clean made), as the user picked it. Matched ignoring case. */
  sourceName: string;
  /** The name to show. */
  displayName: string;
  /** ISO timestamp, set by the server. */
  createdAt: string;
}

export type MerchantRenameInput = Omit<MerchantRename, "createdAt">;

/**
 * The rename list, keyed by the bank's name in lower case, and how names are read
 * with it: `zelleByMemo` (the Settings, Merchants switch, off unless the user turns it on)
 * names an old row called just "Zelle" by the person in its note.
 */
export type RenameMap = ReadonlyMap<string, string> & { readonly zelleByMemo?: boolean };

export interface MerchantNaming {
  /** "Name old Zelle payments by the person in the note". Off unless set. */
  zelleByMemo?: boolean;
}

const keyOf = (name: string) => name.trim().toLowerCase();

export function renameMap(renames: Pick<MerchantRename, "sourceName" | "displayName">[], naming: MerchantNaming = {}): RenameMap {
  return Object.assign(new Map(renames.map((r) => [keyOf(r.sourceName), r.displayName])), { zelleByMemo: naming.zelleByMemo === true });
}

// --- old Zelle rows named by the person in the note -------------

/**
 * The parsing rule, in plain words. A note is read only when it starts "Zelle
 * payment to" or "Zelle payment from" (also "Zelle transfer ..." or "Zelle to ...",
 * any capital letters, extra spaces ignored). The person is the words after "to" or
 * "from", up to whichever comes first:
 *   - the word "for" (what the payment was for follows it),
 *   - "Conf#" (a confirmation code follows it),
 *   - the end of the note,
 * and a last word that is a reference code is dropped: 8 or more letters and digits
 * with at least one digit (a note can end in a bank prefix, two digits and seven more, or in
 * eleven digits). The name shown is "Zelle payment to" (or "from") and the person, as
 * the note writes them. No person left means no name: the row stays "Zelle".
 */
const ZELLE_NOTE = /^zelle\s+(?:(?:payment|transfer)\s+)?(to|from)\s+(.+)$/i;
const REFERENCE_CODE = /^(?=[a-z0-9]*[0-9])[a-z0-9]{8,}$/i;

export function zelleNameFromMemo(memo: string | null | undefined): string | null {
  const note = (memo ?? "").replace(/\s+/g, " ").trim();
  const m = ZELLE_NOTE.exec(note);
  if (!m) return null;
  const words: string[] = [];
  for (const word of m[2].split(" ")) {
    if (/^for$/i.test(word) || /^conf#?/i.test(word)) break;
    words.push(word);
  }
  if (words.length > 0 && REFERENCE_CODE.test(words[words.length - 1])) words.pop();
  if (words.length === 0) return null;
  return `Zelle payment ${m[1].toLowerCase()} ${words.join(" ")}`;
}

/** A row the old Monarch export named just "Zelle": the only rows the note naming touches. */
const isPlainZelle = (bank: string) => bank.toLowerCase() === "zelle";

/** The name a row starts from: the bank's, or, with the switch on, the person in an old Zelle row's note. */
function startingName(t: Pick<NormalizedTxn, "payee" | "merchant" | "description" | "memo">, naming: MerchantNaming): string {
  const bank = bankName(t);
  if (naming.zelleByMemo && isPlainZelle(bank)) return zelleNameFromMemo(t.memo) ?? bank;
  return bank;
}

export interface ZelleMemoNames {
  /** Rows named just "Zelle". */
  rows: number;
  /** Of those, notes the rule could not read (they stay "Zelle"). */
  unparsed: number;
  /** Each name it would create, with its rows, most rows first, then A to Z. */
  names: { name: string; rows: number }[];
}

/** What the switch would do, for the user's once-over before the user turns it on. */
export function zelleMemoNames(txns: Pick<NormalizedTxn, "payee" | "merchant" | "description" | "memo">[]): ZelleMemoNames {
  const counts = new Map<string, number>();
  let rows = 0;
  let unparsed = 0;
  for (const t of txns) {
    if (!isPlainZelle(bankName(t))) continue;
    rows++;
    const name = zelleNameFromMemo(t.memo);
    if (name == null) unparsed++;
    else counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = [...counts].map(([name, n]) => ({ name, rows: n })).sort((a, b) => b.rows - a.rows || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { rows, unparsed, names };
}

/** Follow the list from `name`; a name already visited stops it, so two entries naming each other cannot loop. */
function follow(name: string, renames: RenameMap): string {
  const seen = new Set<string>();
  let current = name;
  for (;;) {
    const key = keyOf(current);
    if (seen.has(key)) return current;
    seen.add(key);
    const next = renames.get(key);
    if (next == null) return current;
    current = next;
  }
}

/** The name shown for a bank name: the rename list, else the Zelle clean, then the list again. */
export function shownName(bank: string, renames: RenameMap): string {
  const name = bank.trim();
  if (!name) return NO_MERCHANT_NAME;
  return follow(renames.has(keyOf(name)) ? name : cleanMerchantName(name), renames);
}

/** The merchant a transaction is shown under. Reads the row; never changes it. */
export function merchantOf(t: Pick<NormalizedTxn, "payee" | "merchant" | "description" | "memo">, renames: RenameMap): string {
  return shownName(startingName(t, { zelleByMemo: renames.zelleByMemo }), renames);
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A rename as sent by the screen, or the plain-words reason it is refused. */
export function validateRename(input: unknown): MerchantRenameInput | string {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const sourceName = text(raw.sourceName).slice(0, 200);
  if (!sourceName) return "Pick the bank's name to rename.";
  const displayName = text(raw.displayName).slice(0, 200);
  if (!displayName) return "Type the name to show.";
  return { sourceName, displayName };
}

// --- suggested merges -----------------------------------------------------------

/**
 * same-letters: the names differ only in capital letters, spaces or punctuation.
 * same-person:  both are Zelle payments with the same person, written differently
 *               (once the codes are left off), money to or from them.
 * payment:      a name that starts with another name and ends in "Payment".
 */
export type SuggestionKind = "same-letters" | "same-person" | "payment";
const KINDS: SuggestionKind[] = ["same-letters", "same-person", "payment"];

export interface MergeSuggestion {
  id: string;
  kind: SuggestionKind;
  /** The shown name that would change. */
  from: string;
  /** The shown name it would read as. */
  into: string;
  fromCount: number;
  intoCount: number;
  /** Why it is offered, in plain words. */
  reason: string;
}

export interface SuggestionDismissal {
  id: string;
  kind: SuggestionKind;
  fromName: string;
  intoName: string;
  createdAt: string;
}

/**
 * A pair's id: the kind and the two names, in a fixed order, so a pair that turns
 * round (when the counts change) is still the same dismissal. Exact names, because
 * a suggestion is about two names as shown.
 */
export function suggestionId(kind: SuggestionKind, a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `${kind}|${x}|${y}`;
}

/** A dismissal as sent by the screen; the id is worked out here, never trusted from the screen. */
export function validateDismissal(input: unknown): Omit<SuggestionDismissal, "createdAt"> | string {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const kind = raw.kind as SuggestionKind;
  const fromName = text(raw.fromName);
  const intoName = text(raw.intoName);
  if (!KINDS.includes(kind) || !fromName || !intoName || fromName === intoName) return "Unknown suggestion.";
  return { id: suggestionId(kind, fromName, intoName), kind, fromName, intoName };
}

/** Letters and digits only, lower case: what is left when capitals, spaces and punctuation are ignored. */
const letters = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Zelle Payment to X", "Zelle Transfer from X", "Zelle to X": X is the person. */
const ZELLE_PERSON = /^zelle\b(?:\s+(?:payment|transfer))?\s+(?:to|from)\s+(.+)$/i;

/** Every shown name with how many transactions carry it. */
function shownCounts(txns: NormalizedTxn[], renames: RenameMap): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of txns) {
    const name = merchantOf(t, renames);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  counts.delete(NO_MERCHANT_NAME);
  return counts;
}

/** The name most used in a group, ties broken A to Z, so a group always folds the same way. */
function mostUsed(names: string[], counts: Map<string, number>): string {
  return [...names].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0))[0];
}

/**
 * Merges the user might want, one pair at a time. Nothing is applied: each pair waits
 * for Accept (which writes one rename, from -> into) or Dismiss (stored, so the
 * pair never comes back). A pair already showing as one name is not offered.
 */
export function suggestMerges(txns: NormalizedTxn[], renames: RenameMap, dismissed: ReadonlySet<string>): MergeSuggestion[] {
  const counts = shownCounts(txns, renames);
  const names = [...counts.keys()];
  const out: MergeSuggestion[] = [];
  const offered = new Set<string>();
  const offer = (kind: SuggestionKind, from: string, into: string, reason: string) => {
    if (from === into) return;
    const pair = suggestionId("same-letters", from, into).slice("same-letters|".length);
    if (offered.has(pair)) return;
    offered.add(pair);
    const id = suggestionId(kind, from, into);
    if (dismissed.has(id)) return;
    out.push({ id, kind, from, into, fromCount: counts.get(from) ?? 0, intoCount: counts.get(into) ?? 0, reason });
  };
  const groups = (keyFn: (name: string) => string | null) => {
    const by = new Map<string, string[]>();
    for (const name of names) {
      const key = keyFn(name);
      if (!key) continue;
      by.set(key, [...(by.get(key) ?? []), name]);
    }
    return [...by.values()].filter((g) => g.length > 1);
  };

  // 1. Capital letters, spaces or punctuation only.
  for (const group of groups((n) => letters(n) || null)) {
    const into = mostUsed(group, counts);
    for (const from of group) offer("same-letters", from, into, "They differ only in capital letters, spaces or punctuation.");
  }
  // 2. Zelle payments with the same person.
  for (const group of groups((n) => {
    const m = ZELLE_PERSON.exec(n);
    return m ? letters(m[1]) || null : null;
  })) {
    const into = mostUsed(group, counts);
    const person = ZELLE_PERSON.exec(into)![1];
    for (const from of group) offer("same-person", from, into, `Both are Zelle payments with ${person}.`);
  }
  // 3. "X ... Payment" folds into the closest X it starts with.
  for (const from of names) {
    const lower = from.toLowerCase();
    if (!/\spayment$/.test(lower)) continue;
    const into = names
      .filter((n) => n !== from && !/payment$/i.test(n) && lower.startsWith(`${n.toLowerCase()} `))
      .sort((a, b) => b.length - a.length)[0];
    if (into) offer("payment", from, into, `It reads as a payment to ${into}.`);
  }

  return out.sort(
    (a, b) => b.fromCount + b.intoCount - (a.fromCount + a.intoCount) || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)
  );
}

/** The names a rename can start from: every name before the rename list, Zelle codes left off, A to Z. */
export function namesBeforeRenames(txns: NormalizedTxn[], naming: MerchantNaming = {}): string[] {
  const names = new Set<string>();
  for (const t of txns) {
    const start = startingName(t, naming);
    if (start) names.add(cleanMerchantName(start));
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** The bank's names behind a shown merchant, A to Z, so a rename can be traced back. */
export function bankNamesFor(txns: NormalizedTxn[], renames: RenameMap, shown: string): string[] {
  const names = new Set<string>();
  for (const t of txns) if (merchantOf(t, renames) === shown) names.add(bankName(t));
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// --- a merchant's page --------------------------------------------------------------

export interface MerchantFigures {
  /** Every month of the range, YYYY-MM. */
  months: string[];
  /** Spent each month: purchases less what came back. */
  byMonth: Record<string, number>;
  /** Purchases less refunds over the range. */
  spentCents: number;
  purchasesCents: number;
  /** Positive: what came back. */
  refundsCents: number;
  /** Money received from this merchant (income), if any. */
  receivedCents: number;
  completeMonths: string[];
  /** Spent over the complete months, divided by how many there are; null when there are none. */
  averageCents: number | null;
}

/**
 * A merchant's figures over a range. `spending` are its Spending entries (money
 * spent positive, money back negative), `income` its Income entries; both already
 * narrowed to the merchant, any dates.
 */
export function merchantFigures(spending: ReportEntry[], income: ReportEntry[], range: DateRange, today: string): MerchantFigures {
  const months = bucketsFor(range, "month").map((b) => b.key);
  const byMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
  let purchases = 0;
  let refunds = 0;
  for (const e of entriesIn(spending, range)) {
    byMonth[e.date.slice(0, 7)] = (byMonth[e.date.slice(0, 7)] ?? 0) + e.cents;
    if (e.cents < 0) refunds -= e.cents;
    else purchases += e.cents;
  }
  const received = entriesIn(income, range).reduce((sum, e) => sum + e.cents, 0);
  const average = monthlyAverage(byMonth, range, today);
  return {
    months,
    byMonth,
    spentCents: purchases - refunds,
    purchasesCents: purchases,
    refundsCents: refunds,
    receivedCents: received,
    completeMonths: average.months,
    averageCents: average.averageCents,
  };
}
