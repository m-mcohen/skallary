// src/domain/scope.ts
//
// The one definition of what "counts" toward spending and income.
//
// rollupMonthly (Reports, Budget actuals, the trailing figure) and the
// Transactions ledger filter both call this, so a figure and the ledger behind
// it cannot drift apart. Before this file the rollup applied these rules inline
// and the transaction filter did not apply the account rule at all, so a
// Reports category link could land on a list that totaled more than the number
// that was clicked.
import type { Account } from "./types";

export type TxnKind = "expense" | "income" | "saving" | "investment_income" | "transfer";

/**
 * The kinds a rollup reports. Transfers -- which now include washes and the
 * suppressed arrival leg of a contribution -- are dropped before this.
 */
export const COUNTED_KINDS = ["income", "expense", "saving", "investment_income"] as const;

/** Account id -> whether that account is counted toward spending and income. */
export function countedByAccount(accounts: Account[]): Map<string, boolean> {
  return new Map(accounts.map((a) => [a.id, a.includeInSpend]));
}

/** True when the account is counted. An account with no row counts, as it always has. */
export function isCountedAccount(accountId: string, counted: Map<string, boolean>): boolean {
  return counted.get(accountId) !== false;
}

export function inSpendScope(
  accountId: string,
  kind: TxnKind,
  counted: Map<string, boolean>
): boolean {
  if (kind === "transfer") return false; // moving money is neither spending nor income
  return isCountedAccount(accountId, counted);
}
