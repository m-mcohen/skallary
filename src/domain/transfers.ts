// src/domain/transfers.ts
//
// Transfer detection by pair matching.
//
// SimpleFIN carries no transfer flag, and Monarch's was actively wrong -- it
// flagged a rent Zelle payment as a Transfer, which quietly removed it
// from spending. Pair matching gets that case right by construction: a payment
// to a landlord has no matching leg in another of the user's own accounts, so it stays
// spend. Only money that leaves one tracked account and lands in another is a
// transfer.
import type { NormalizedTxn } from "./types";

/**
 * How many days apart the two legs of a transfer may post. Internal moves
 * usually settle same-day or next-day; three days covers a weekend without
 * making unrelated equal amounts look like a pair.
 */
export const TRANSFER_WINDOW_DAYS = 3;

const DAY_MS = 86_400_000;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

/**
 * Returns a new array with both legs of each detected transfer flagged.
 *
 * Only ever ADDS flags: a transfer already declared by a user rule or an app
 * adjustment stays declared, even with no visible counterpart. Never mutates
 * the input.
 */
export function matchTransfers(transactions: NormalizedTxn[]): NormalizedTxn[] {
  const outflows = transactions.filter((t) => t.amountCents < 0);
  const inflows = transactions.filter((t) => t.amountCents > 0);

  const matched = new Set<string>();
  const claimedInflows = new Set<string>();
  const partnerAccount = new Map<string, string>();

  for (const out of outflows) {
    let best: NormalizedTxn | null = null;
    let bestDistance = Infinity;

    for (const inflow of inflows) {
      if (claimedInflows.has(inflow.sourceTransactionId)) continue;
      // Both legs of a real transfer sit in DIFFERENT accounts; two opposite
      // rows in one account are a refund or a correction, not a move.
      if (inflow.accountId === out.accountId) continue;
      if (inflow.amountCents !== -out.amountCents) continue;

      const distance = daysApart(out.date, inflow.date);
      if (distance > TRANSFER_WINDOW_DAYS) continue;
      // Nearest date wins, so two identical outflows don't both grab the same
      // inflow and leave the wrong one paired.
      if (distance < bestDistance) {
        best = inflow;
        bestDistance = distance;
      }
    }

    if (best) {
      matched.add(out.sourceTransactionId);
      matched.add(best.sourceTransactionId);
      claimedInflows.add(best.sourceTransactionId);
      // Remember WHO each leg was paired with. The saving rule asks whether the
      // money crossed into a savings destination, which is a question about the
      // partner's account, not this row's.
      partnerAccount.set(out.sourceTransactionId, best.accountId);
      partnerAccount.set(best.sourceTransactionId, out.accountId);
    }
  }

  return transactions.map((t) => {
    const partner = partnerAccount.get(t.sourceTransactionId);
    if (!matched.has(t.sourceTransactionId)) return t;
    return {
      ...t,
      isTransfer: true,
      ...(partner ? { transferPartnerAccountId: partner } : {}),
    };
  });
}
