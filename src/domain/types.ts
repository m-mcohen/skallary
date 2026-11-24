// src/domain/types.ts
import type { OwnerSlot } from "./household";

export interface Account {
  id: string;
  name: string;
  type: string | null;
  institution: string | null;
  currency: string;
  isOwned: boolean;
  includeInSpend: boolean;
  owner: OwnerSlot;
  /**
   * Who last set `type`:
   *   'feed'  -- a source that genuinely reports types (Monarch did)
   *   'guess' -- inferred from the account name, because SimpleFIN reports none
   *   'user'  -- confirmed by hand; always wins, and no sync may override it
   */
  typeSource?: "feed" | "guess" | "user";
  /** Balance snapshot the feed reported (SimpleFIN); absent on older rows. */
  balanceCents?: number | null;
  availableBalanceCents?: number | null;
  /** YYYY-MM-DD the balance was taken -- the feed's own freshness, not ours. */
  balanceDate?: string | null;
  /**
   * Whether this account's balance counts toward drawable cash.
   * undefined = never chosen, fall back to defaultDrawableFor().
   * Separate question from includeInSpend, which is about transactions.
   */
  drawable?: boolean;
  /**
   * A superseded account record: kept because it still owns transaction
   * history, hidden from the UI so the list shows one row per real account.
   * Its TRANSACTIONS still count everywhere (includeInSpend answers that
   * separate question); its BALANCE never does, because the live row that
   * superseded it already reports the same money.
   */
  archived?: boolean;
  /**
   * Where money put away lands: null (an ordinary spending or cash account),
   * 'Investing', or 'Retirement'. One setting does both jobs -- it flags the
   * account as a savings destination, and its value names the flavor the money
   * counts under. Money CROSSING from an unflagged account into a flagged one
   * is saving; nothing inside a flagged account counts anywhere. See
   * src/domain/savings.ts.
   */
  savingsDestination?: string | null;
  /**
   * The pot account: the one account the charity pot is set aside in and gifts
   * are paid back from (migration 0033). Its rows stay transfers; the Charity
   * figure reads them by account. Cleared on read while the pot is off. See
   * src/domain/maaser-pot.ts.
   */
  maaserPot?: boolean;
}
export interface NormalizedTxn {
  sourceTransactionId: string;
  accountId: string;
  date: string;
  amountCents: number;
  sourceCategory: string | null;
  merchant: string | null;
  isTransfer: boolean;
  sourceUpdatedAt: string | null;
  // Fields the SimpleFIN feed carries that Monarch never did. Optional because
  // the Monarch and CSV paths produce rows without them.
  /** The feed's human-readable summary of the transaction. */
  description?: string | null;
  /** The RAW bank memo -- what the categorization rules match on. */
  memo?: string | null;
  /** Cleaned payee, when the institution supplies one. */
  payee?: string | null;
  /** ISO 18245 merchant category code, when the institution supplies one. */
  mcc?: string | null;
  /** True while the transaction is authorized but not yet settled. */
  pending?: boolean;
  // Fields set by the pipeline, not by any feed.
  /**
   * The account the pair matcher paired this leg with. The saving rule needs it
   * to ask whether the money crossed into a savings destination; the matcher
   * used to flag both legs and forget the relationship.
   */
  transferPartnerAccountId?: string | null;
  /**
   * Set by classifySavings: the flavor this row counts as ('Investing' or
   * 'Retirement'). Only ever set on the leg LEAVING an unflagged account, so a
   * two-leg move is counted once.
   */
  savingBucket?: string | null;
  /**
   * Set by classifySavings: this row counts nowhere. Either an internal wash
   * (equal and opposite, same account, same day) or any row inside a savings
   * destination account.
   */
  isWash?: boolean;
  /**
   * Set by an explicit "transfer" adjustment only. Unlike isTransfer, which the
   * pair matcher also sets, this is the user's own word and beats a saving
   * category.
   */
  transferByCorrection?: boolean;
}
