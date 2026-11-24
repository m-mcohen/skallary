// src/domain/transactions-view.ts
//
// The filter engine behind the Transactions screen.
//
// Pure and DOM-free on purpose: everything the screen does to thousands of rows
// happens here, so it is unit-testable and the component stays presentation.
//
// The category shown comes from classify() -- the SAME function rollupMonthly
// uses -- so the list and the budget cannot disagree. A second categorisation
// path is the one thing this module must never grow.
import { MAASER_CATEGORY, maaserFiguresOf, maaserRole, potAccountIds, potRowKind, type MaaserFigure, type MaaserRole } from "./maaser-pot";
import type { MaaserMark } from "./maaser-marks";
import type { PotCounts } from "./maaser-pot";
import { classify } from "./dedup";
import { countedByAccount, isCountedAccount, type TxnKind } from "./scope";
import { ruleKeyFor } from "./rules";
import type { Account, NormalizedTxn } from "./types";
import { displayAccountName } from "./account-display";
import { merchantOf, type RenameMap } from "./merchants";

export interface TxnFilter {
  /** Matches payee, merchant, description, and resolved category. */
  search: string;
  /** Empty means every account. */
  accountIds: string[];
  /** Empty means every category; matched on the resolved planning category. */
  categories: string[];
  /** YYYY-MM-DD, inclusive. */
  from: string | null;
  to: string | null;
  /** Bounds on the ABSOLUTE amount: a range means size, not sign. */
  minCents: number | null;
  maxCents: number | null;
  needsCategory: boolean;
  /**
   * Transfers are not spending, so they are out by default. "only" exists
   * because auditing what the transfer matcher claimed is its own task.
   */
  transfers: "exclude" | "include" | "only";
  /**
   * One side only. Null means both, which is how the screen has always
   * behaved; only a click-through ledger link sets it. The side comes from the
   * category, not the sign, so a refund stays with its spending category.
   */
  kind: "expense" | "income" | "saving" | "investment_income" | null;
  /**
   * Leave out accounts that are not counted toward spending and income. Off by
   * default, so every account is still listed; a ledger link turns it on so the
   * list adds up to the figure that was clicked.
   */
  countedAccountsOnly: boolean;
  /**
   * A recurring series: the payments (money out, not transfers) to this payee
   * key. It is the detector's own key (rules.ts ruleKeyFor), so together with the
   * account it lists exactly the payments a Bills series counted. Null otherwise.
   */
  payeeKey: string | null;
  /**
   * One direction only: "out" lists money that left, "in" money that came back.
   * Null means both. Only a click-through link sets it: Reports shows a spending
   * category's purchases and its refunds on separate lines,
   * and each line opens the rows behind it.
   */
  flow: "out" | "in" | null;
  /**
   * Merchants by their shown name: a merchant's figure on
   * Reports, or its page. Empty means every merchant.
   */
  merchants: string[];
  /** Every merchant except these: Reports' Other line when grouped by merchant. */
  exceptMerchants: string[];
  /** Only rows behind these maaser ledger figures (drill-down from the Charity panel); empty = no limit. */
  maaser: MaaserFigure[];
}

export interface TxnRow {
  txn: NormalizedTxn;
  planningCategory: string;
  kind: TxnKind;
  accountName: string;
  /** The merchant it is shown under: the rename list, else the Zelle clean (merchants.ts). */
  merchant: string;
  /**
   * True when the feed gave no category, no rule filled one in, and the app did
   * not file the row itself (a saving move, a wash, a transfer). The same test as
   * the review queue in Settings (connectorService.getUncategorized).
   */
  needsCategory: boolean;
  /** False when the row's account is not counted toward spending and income. */
  counted: boolean;
  /** The user's note on this transaction; search reads it. */
  note: string | null;
  /** Which maaser mark this row can take, if any; null = none, so the screen shows no control. */
  maaserRole: MaaserRole | null;
  /** The mark on it, when the user set one. */
  maaserMark: MaaserMark | null;
  /** The maaser ledger figures this row is one of the rows behind. */
  maaserFigures: MaaserFigure[];
}

export const EMPTY_FILTER: TxnFilter = {
  search: "",
  accountIds: [],
  categories: [],
  from: null,
  to: null,
  minCents: null,
  maxCents: null,
  needsCategory: false,
  transfers: "exclude",
  kind: null,
  countedAccountsOnly: false,
  payeeKey: null,
  flow: null,
  merchants: [],
  exceptMerchants: [],
  maaser: [],
};

/** Shown when an account id has no row -- never a blank cell. */
export const UNKNOWN_ACCOUNT = "Unknown account";

/**
 * Decorate prepared transactions for display.
 *
 * Call with the output of prepareTransactions(), never with raw rows: the
 * category, transfer flag, and manual corrections are all applied there.
 */
export function toRows(
  txns: NormalizedTxn[],
  accounts: Account[],
  mapping: Record<string, string>,
  /** The rename list. Only the shown merchant name follows it; nothing else does. */
  renames: RenameMap = new Map(),
  /** The user's notes, by transaction id. */
  notes: Map<string, string> = new Map(),
  /** The pot marks, by transaction id. */
  marks: Map<string, MaaserMark> = new Map(),
  /** The charity pot's switch and whose accounts count; absent: the user's own accounts. */
  pot?: PotCounts | null
): TxnRow[] {
  const names = new Map(accounts.map((a) => [a.id, displayAccountName(a.name)]));
  const counted = countedByAccount(accounts);
  const potIds = potAccountIds(accounts);
  return txns.map((txn) => {
    const classified = classify(txn, mapping);
    // A gift paid straight from the pot reached a charity: it lists under Charity and counts, as Reports and
    // the Charity line already read it, so the ordinary Charity links find it.
    const potGift = potIds.has(txn.accountId) && potRowKind(txn, potIds, mapping) === "gift";
    const planningCategory = potGift ? MAASER_CATEGORY : classified.planningCategory;
    const kind: TxnKind = potGift ? "expense" : classified.kind;
    return {
      txn,
      planningCategory,
      kind,
      accountName: names.get(txn.accountId) ?? UNKNOWN_ACCOUNT,
      merchant: merchantOf(txn, renames),
      needsCategory: !txn.sourceCategory && !txn.isTransfer && !txn.isWash && !txn.savingBucket,
      counted: potGift ? true : isCountedAccount(txn.accountId, counted),
      note: notes.get(txn.sourceTransactionId) ?? null,
      maaserRole: maaserRole(txn, accounts, mapping, pot),
      maaserMark: marks.get(txn.sourceTransactionId) ?? null,
      maaserFigures: maaserFiguresOf(txn, accounts, mapping, marks.get(txn.sourceTransactionId), pot),
    };
  });
}

function haystack(row: TxnRow): string {
  const t = row.txn;
  return [t.payee, t.merchant, t.description, row.merchant, row.planningCategory, row.note]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Conjunctive: every set condition must hold. Newest first. */
export function filterRows(rows: TxnRow[], filter: TxnFilter): TxnRow[] {
  const needle = filter.search.trim().toLowerCase();

  const out = rows.filter((row) => {
    if (filter.transfers === "exclude" && row.kind === "transfer") return false;
    if (filter.transfers === "only" && row.kind !== "transfer") return false;
    if (filter.kind && row.kind !== filter.kind) return false;
    if (filter.countedAccountsOnly && !row.counted) return false;
    if (filter.payeeKey) {
      // The same three tests detectRecurring applies before it groups by key,
      // except on an income ledger: there the payer is who paid IN.
      if (row.kind === "transfer") return false;
      if (filter.kind !== "income" && row.txn.amountCents >= 0) return false;
      if (ruleKeyFor(row.txn) !== filter.payeeKey) return false;
    }
    // A zero amount reads as money out, the side Reports files it on.
    if (filter.flow === "out" && row.txn.amountCents > 0) return false;
    if (filter.flow === "in" && row.txn.amountCents <= 0) return false;
    if (filter.needsCategory && !row.needsCategory) return false;
    if (filter.merchants.length > 0 && !filter.merchants.includes(row.merchant)) return false;
    if (filter.exceptMerchants.length > 0 && filter.exceptMerchants.includes(row.merchant)) return false;
    if (filter.maaser.length > 0 && !row.maaserFigures.some((f) => filter.maaser.includes(f))) return false;
    if (needle && !haystack(row).includes(needle)) return false;
    if (filter.accountIds.length > 0 && !filter.accountIds.includes(row.txn.accountId)) return false;
    if (filter.categories.length > 0 && !filter.categories.includes(row.planningCategory)) {
      return false;
    }
    // Dates are ISO YYYY-MM-DD, so string comparison is date comparison.
    // The first ten characters, so a row stamped with a time on the last day is still in the window.
    const day = row.txn.date.slice(0, 10);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;

    // Absolute, so "at least $100" finds a $250 charge as well as a $250
    // deposit. A signed comparison would exclude every expense.
    const size = Math.abs(row.txn.amountCents);
    if (filter.minCents != null && size < filter.minCents) return false;
    if (filter.maxCents != null && size > filter.maxCents) return false;
    return true;
  });

  // Newest first, with the id as a tiebreak so the order is stable across
  // reloads rather than depending on the server's row order.
  return out.sort(
    (a, b) =>
      b.txn.date.localeCompare(a.txn.date) ||
      b.txn.sourceTransactionId.localeCompare(a.txn.sourceTransactionId)
  );
}

export interface TxnSummary {
  count: number;
  inCents: number;
  outCents: number;
  netCents: number;
}

/** `outCents` is positive: the magnitude leaving, not a negative number. */
export function summarise(rows: TxnRow[]): TxnSummary {
  let inCents = 0;
  let outCents = 0;
  for (const row of rows) {
    if (row.txn.amountCents >= 0) inCents += row.txn.amountCents;
    else outCents += -row.txn.amountCents;
  }
  return { count: rows.length, inCents, outCents, netCents: inCents - outCents };
}

export interface LedgerTotal {
  incomeCents: number;
  /** Positive: the magnitude leaving, not a negative number. */
  expenseCents: number;
  /** Positive when money was put away, negative when it was drawn back out. */
  savingCents: number;
  /** What the user's money earned, kept apart from what the user earned. */
  investmentIncomeCents: number;
  /** Income + investment income - spending: Left over. Saving is its own figure. */
  netCents: number;
}

/**
 * Totals computed the way rollupMonthly computes them, so a ledger's total
 * equals the Reports or Budget figure that linked to it: the category decides
 * the side, and a refund nets against its spending category. summarise() above
 * answers a different question (money in versus money out, by sign).
 */
export function ledgerTotal(rows: TxnRow[]): LedgerTotal {
  let incomeCents = 0;
  let expenseCents = 0;
  let savingCents = 0;
  let investmentIncomeCents = 0;
  for (const row of rows) {
    if (row.kind === "income") incomeCents += row.txn.amountCents;
    else if (row.kind === "expense") expenseCents -= row.txn.amountCents;
    // Saving counts in spending terms like expense does, so a contribution is
    // positive and a withdrawal is negative -- the same convention the rollup
    // uses, so a ledger opened from a cash flow figure adds up to it.
    else if (row.kind === "saving") savingCents -= row.txn.amountCents;
    else if (row.kind === "investment_income") investmentIncomeCents += row.txn.amountCents;
  }
  return {
    incomeCents,
    expenseCents,
    savingCents,
    investmentIncomeCents,
    // The same arithmetic the cash flow table's "Left over" column uses, so a
    // ledger opened from that figure adds up to it.
    netCents: incomeCents + investmentIncomeCents - expenseCents,
  };
}

export interface LedgerRow extends TxnRow {
  /** Cents accumulated down the page; a transfer leaves it unchanged. */
  runningCents: number;
}

/**
 * Oldest first, the way a ledger reads, with a running total. Does not mutate.
 *
 * A spending ledger counts up in spending terms (a purchase adds, a refund
 * subtracts), so its last line IS the header figure. Reading $2,250.00 at the
 * top and -$2,250.00 at the bottom of the same ledger is the kind of mismatch
 * that makes a person stop trusting both. Income and two-sided ledgers stay
 * signed: money in is positive.
 */
export function withRunningTotal(
  rows: TxnRow[],
  kind: TxnKind | null = null,
  /** An account's own activity: a transfer moves its money like anything else, so it counts. */
  includeTransfers = false
): LedgerRow[] {
  const ordered = [...rows].sort(
    (a, b) =>
      a.txn.date.localeCompare(b.txn.date) ||
      a.txn.sourceTransactionId.localeCompare(b.txn.sourceTransactionId)
  );
  // Saving counts up the way spending does: a contribution adds, a withdrawal
  // subtracts, so the last line equals the figure that opened the ledger.
  const direction = kind === "expense" || kind === "saving" ? -1 : 1;
  let running = 0;
  return ordered.map((row) => {
    if (includeTransfers || row.kind !== "transfer") running += direction * row.txn.amountCents;
    return { ...row, runningCents: running };
  });
}
