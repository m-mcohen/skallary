// src/domain/pipeline.ts
//
// The one place the transaction-preparation order is defined, so the server
// (seedBudgetService) and the UI can't drift into applying these layers
// differently and producing two different budgets from the same rows.
import { applyRules, type CategorizationRule } from "./rules";
import { matchTransfers } from "./transfers";
import { classifySavings } from "./savings";
import { applyAdjustments, type TransactionAdjustment } from "./adjustments";
import type { Account, NormalizedTxn } from "./types";

export interface PreparationInputs {
  rules: CategorizationRule[];
  adjustments: TransactionAdjustment[];
  /**
   * Needed by the saving rule, which reads each account's savings destination.
   * Optional so older callers keep working: with no accounts nothing is
   * flagged, so nothing classifies as saving and behavior is exactly as before.
   */
  accounts?: Account[];
  /** The category mapping, so the wash rule knows a mapped return is a return. */
  mapping?: Record<string, string>;
}

/**
 * Raw feed rows -> rows the rollups can trust.
 *
 * The order is the design:
 *
 *  1. RULES first. SimpleFIN rows arrive with no category at all, so nothing
 *     downstream can match on one until the rules have assigned it.
 *  2. TRANSFER pair-matching next. It needs the whole set in hand to find both
 *     legs, and it only adds flags, so a rule that already declared a transfer
 *     survives.
 *  3. SAVING next. It needs the matcher's pairings in hand to ask whether the
 *     money crossed into a savings destination, and it must run before
 *     adjustments so an explicit correction can still override it.
 *  4. ADJUSTMENTS last. These are the user's explicit corrections, so they beat
 *     the rules, the matcher and the saving rule -- which is what makes an
 *     adjustment a reliable escape hatch rather than one more voice in the
 *     argument.
 *
 * Every layer is pure and non-mutating, so this is safe to run on each read.
 */
export function prepareTransactions(
  transactions: NormalizedTxn[],
  { rules, adjustments, accounts = [], mapping = {} }: PreparationInputs
): NormalizedTxn[] {
  return applyAdjustments(
    classifySavings(matchTransfers(applyRules(transactions, rules)), accounts, mapping),
    adjustments
  );
}

/**
 * For rows from GET /transactions, which the server has already run through the
 * rules and the pair matcher: the remaining two layers, in the same order.
 *
 * Budget, Charts, Wish List, Acquisition and Scenario compare used to call
 * applyAdjustments alone, so the saving step never ran there and brokerage
 * sweep noise still read as spending.
 */
export function prepareForRollup(
  transactions: NormalizedTxn[],
  adjustments: TransactionAdjustment[],
  accounts: Account[],
  mapping: Record<string, string>
): NormalizedTxn[] {
  return applyAdjustments(classifySavings(transactions, accounts, mapping), adjustments);
}
