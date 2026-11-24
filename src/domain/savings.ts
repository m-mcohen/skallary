// src/domain/savings.ts
//
// Saving/Investing is its own bucket: not income, not expense. Putting $4,000 into a brokerage is not consumption, so calling it
// spending is wrong; it is not earnings either, so calling it income is absurd.
// Before this, the pair matcher flagged both legs as an internal transfer and
// every report dropped them, so the money the user set aside was invisible.
//
// THE RULE IS CROSSING, NOT ARRIVING. Money counts as saving when it leaves an
// UNFLAGGED account for a FLAGGED one, counted once, on the leg that leaves.
// Two consequences, both of them the user's stated constraints:
//
//  * a two-leg move is never double counted -- the arrival leg is suppressed;
//   * flagged -> flagged (brokerage to IRA) counts as ZERO -- rearranging money
//     already set aside is not saving.
//
// The flag lives on the ACCOUNT because a bank feed never says WHY money moved,
// only where it landed. Keying off the payee would break the day another
// brokerage account opens or the brokerage renames something in the feed.
import type { Account, NormalizedTxn } from "./types";

/**
 * The flavors a savings destination can carry. The account setting's value IS
 * the planning category the money counts under, so there is no second list to
 * keep in sync.
 */
export const SAVING_CATEGORIES = ["Investing", "Retirement"] as const;

/**
 * True for a planning category that counts as saving rather than spending.
 *
 * This is the escape hatch, and it is why the account flag alone is not enough:
 * older checking-to-brokerage rows may have no second leg in
 * the data, because the bank feed only starts at a later date. The crossing rule cannot see
 * a move whose other half is absent, so a rule or the transaction picker routes
 * those rows in by category instead -- exactly as `Credit Card Payment` carries
 * the transfer kind today.
 */
export function isSavingCategory(name: string): boolean {
  const n = name.trim().toLowerCase();
  return SAVING_CATEGORIES.some((c) => c.toLowerCase() === n);
}

/**
 * Returns you can actually spend: interest and dividends landing in a spending
 * or cash account. These get their own line rather than
 * inflating wage income, because "what I earn" and "what my money earns" answer
 * different questions.
 *
 * Returns INSIDE a savings destination never reach this test -- they are
 * silenced by the account rule below, since reinvested growth is not cash.
 */
const INVESTMENT_INCOME = ["interest", "interest income", "dividends", "dividend", "investment income", "capital gains"];

export function isInvestmentIncomeCategory(name: string): boolean {
  return INVESTMENT_INCOME.includes(name.trim().toLowerCase());
}

/** Account id -> its savings destination, or null for an ordinary account. */
export function savingsDestinationByAccount(accounts: Account[]): Map<string, string | null> {
  return new Map(accounts.map((a) => [a.id, a.savingsDestination ?? null]));
}

/**
 * Equal-and-opposite rows in the SAME account on the SAME day, paired off.
 *
 * The SimpleFIN brokerage feed emits these constantly -- a dividend credit and
 * the reinvestment that spends it, a money-market sweep in both directions.
 * Without this, the credit leg was caught as INTEREST INCOME while its twin
 * fell through every rule into UNCATEGORIZED SPEND, inflating both sides of the budget.
 *
 * Deliberately general rather than brokerage-specific: a card charge and its
 * same-day refund are also a wash, and netting them to zero is correct.
 *
 * Pairs off one-to-one, so a third row of the same amount survives rather than
 * being silently swallowed.
 */
function washedIds(transactions: NormalizedTxn[], mapping: Record<string, string>): Set<string> {
  const byKey = new Map<string, { outs: NormalizedTxn[]; ins: NormalizedTxn[] }>();
  for (const t of transactions) {
    if (t.amountCents === 0) continue;
    // A wash cancels two rows that would EACH otherwise land in a bucket. If one
    // leg is already silent, there is nothing to cancel, and washing the pair
    // would delete the other leg for no reason.
    //
    // This is not hypothetical: interest on a cash-management account is reinvested the
    // same day, and the reinvestment leg already carries the transfer flag. The
    // first version of this rule washed the pair and quietly erased real
    // investment income.
    if (t.isTransfer) continue;
    const key = `${t.accountId}|${t.date}|${Math.abs(t.amountCents)}`;
    const slot = byKey.get(key) ?? { outs: [], ins: [] };
    (t.amountCents < 0 ? slot.outs : slot.ins).push(t);
    byKey.set(key, slot);
  }

  const washed = new Set<string>();
  for (const { outs, ins } of byKey.values()) {
    const pairs = Math.min(outs.length, ins.length);
    for (let i = 0; i < pairs; i++) {
      const out = outs[i];
      const inflow = ins[i];
      // Interest paid and immediately reinvested is still interest. Monarch
      // labelled the second leg "Re-Investment" and flagged it a transfer, so
      // the test above caught it; SimpleFIN sends that leg with no category at
      // all, and washing the pair made that interest vanish from
      // the reports -- the same money, reported differently only because the
      // feed changed. So when exactly one leg is a return, keep it and silence
      // only the move it paid for.
      // A return by its own name, or by the name the mapping gives it: classify()
      // reads both, so this must too.
      const isReturn = (t: NormalizedTxn) =>
        isInvestmentIncomeCategory(t.sourceCategory ?? "") ||
        isInvestmentIncomeCategory(mapping[t.sourceCategory ?? ""] ?? "");
      const outIsReturn = isReturn(out);
      const inIsReturn = isReturn(inflow);
      if (outIsReturn !== inIsReturn) {
        washed.add(outIsReturn ? inflow.sourceTransactionId : out.sourceTransactionId);
        continue;
      }
      washed.add(out.sourceTransactionId);
      washed.add(inflow.sourceTransactionId);
    }
  }
  return washed;
}

/**
 * Tags each row with what the saving rule makes of it. Pure; never mutates.
 *
 * Runs AFTER the pair matcher (it needs the partner each leg was matched with)
 * and BEFORE adjustments, so the user's explicit corrections still beat it.
 */
export function classifySavings(
  transactions: NormalizedTxn[],
  accounts: Account[],
  mapping: Record<string, string> = {}
): NormalizedTxn[] {
  const destination = savingsDestinationByAccount(accounts);
  const washed = washedIds(transactions, mapping);

  return transactions.map((t) => {
    // Everything inside a savings destination counts nowhere. Dividend
    // reinvestments, sweeps, the buy side of a contribution: none of it is
    // household money moving in or out, and the crossing is already counted on
    // the other side. This is also what makes flagged -> flagged come to zero.
    if (destination.get(t.accountId)) return { ...t, isWash: true, savingBucket: null };

    if (washed.has(t.sourceTransactionId)) return { ...t, isWash: true, savingBucket: null };

    // The crossing itself, read from an unflagged account's leg. A negative
    // amount (money leaving for the brokerage) is a contribution; a positive one
    // (money coming back to checking) is a withdrawal, and stays in this bucket
    // as NEGATIVE saving rather than masquerading as income.
    const partnerDestination = t.transferPartnerAccountId ? destination.get(t.transferPartnerAccountId) : null;
    if (partnerDestination) return { ...t, savingBucket: partnerDestination };

    return t;
  });
}
