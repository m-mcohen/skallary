// src/domain/adjustments.ts
//
// App-owned transaction adjustments: a data-quality mechanism that neutralizes
// miscoded/junk transactions at rollup time, without ever mutating the synced
// transaction rows -- so a Monarch re-sync never reverts it. Rows live in the
// transaction_adjustments table (migrations/0004_adjustments.sql); this file
// is the pure function that consumes them.
import type { NormalizedTxn } from "./types";

export interface TransactionAdjustment {
  matchKind: "id" | "category_amount";
  sourceTransactionId?: string | null;
  matchCategory?: string | null;
  matchAmountCents?: number | null;
  action: "transfer" | "exclude" | "recategorize";
  /** For action 'recategorize': the category the matching transaction should count under. */
  toCategory?: string | null;
  note?: string | null;
}

function matches(txn: NormalizedTxn, adj: TransactionAdjustment): boolean {
  if (adj.matchKind === "id") {
    return txn.sourceTransactionId === adj.sourceTransactionId;
  }
  // A null/undefined matchAmountCents means "any amount in this category" (a
  // category-only rule, e.g. treat every set-aside inflow as a transfer).
  return (
    txn.sourceCategory === adj.matchCategory &&
    (adj.matchAmountCents == null || txn.amountCents === adj.matchAmountCents)
  );
}

// Pure: 'exclude' drops matching transactions entirely; 'transfer' flips
// isTransfer=true on matches (so rollupMonthly's existing transfer rule
// drops them from income/expense rollups); 'recategorize' re-labels a match
// into `toCategory` AND clears isTransfer, so a payment Monarch mis-filed
// (or mis-flagged as a transfer) counts as a real expense in the right
// category. Non-matching transactions pass through unchanged. Precedence
// when several rules hit one txn: exclude > recategorize > transfer.
export function applyAdjustments(txns: NormalizedTxn[], adj: TransactionAdjustment[]): NormalizedTxn[] {
  const out: NormalizedTxn[] = [];
  for (const t of txns) {
    let excluded = false;
    let transferred = false;
    let recategorizeTo: string | null = null;
    for (const a of adj) {
      if (!matches(t, a)) continue;
      if (a.action === "exclude") { excluded = true; break; }
      if (a.action === "recategorize" && a.toCategory) recategorizeTo = a.toCategory;
      if (a.action === "transfer") transferred = true;
    }
    if (excluded) continue;
    if (recategorizeTo !== null) {
      // Clears the saving tags too. An adjustment is the last word: if the user
      // says a row is Rent, the fact that it crossed into a flagged account, or
      // washed against a same-day twin, must not override the user.
      out.push({ ...t, sourceCategory: recategorizeTo, isTransfer: false, savingBucket: null, isWash: false, transferByCorrection: false });
    } else {
      out.push(transferred ? { ...t, isTransfer: true, savingBucket: null, transferByCorrection: true } : t);
    }
  }
  return out;
}
