import { describe, it, expect } from "vitest";
import { matchTransfers } from "../../src/domain/transfers";
import type { NormalizedTxn } from "../../src/domain/types";

const txn = (over: Partial<NormalizedTxn> & { sourceTransactionId: string }): NormalizedTxn => ({
  accountId: "demo-checking", date: "2026-09-02", amountCents: -10000, sourceCategory: null,
  merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over,
});

/** Ids the matcher flagged as transfers. */
const flagged = (rows: NormalizedTxn[]) =>
  matchTransfers(rows).filter((t) => t.isTransfer).map((t) => t.sourceTransactionId).sort();

describe("matchTransfers", () => {
  it("pairs equal and opposite legs across two accounts", () => {
    const rows = [
      txn({ sourceTransactionId: "out", accountId: "checking", amountCents: -250000, date: "2026-09-02" }),
      txn({ sourceTransactionId: "in", accountId: "demo-brokerage", amountCents: 250000, date: "2026-09-03" }),
    ];
    expect(flagged(rows)).toEqual(["in", "out"]);
  });

  it("leaves a payment with no counterpart alone -- this is the rent case", () => {
    // A $2,100 rent payment leaves the account and never lands in another
    // account. Flagged as a Transfer it would vanish from spending. Pair-matching
    // gets it right by construction: no matching leg, so it stays spend.
    const rows = [
      txn({ sourceTransactionId: "rent", accountId: "demo-checking", amountCents: -210000, date: "2026-09-01", merchant: "Zelle" }),
      txn({ sourceTransactionId: "groceries", accountId: "demo-checking", amountCents: -12000, date: "2026-09-01" }),
    ];
    expect(flagged(rows)).toEqual([]);
  });

  it("does not pair two legs inside the same account", () => {
    const rows = [
      txn({ sourceTransactionId: "a", accountId: "checking", amountCents: -5000 }),
      txn({ sourceTransactionId: "b", accountId: "checking", amountCents: 5000 }),
    ];
    expect(flagged(rows)).toEqual([]);
  });

  it("does not pair two legs pointing the same way", () => {
    const rows = [
      txn({ sourceTransactionId: "a", accountId: "checking", amountCents: -5000 }),
      txn({ sourceTransactionId: "b", accountId: "savings", amountCents: -5000 }),
    ];
    expect(flagged(rows)).toEqual([]);
  });

  it("does not pair legs whose amounts differ, however close", () => {
    const rows = [
      txn({ sourceTransactionId: "a", accountId: "checking", amountCents: -5000 }),
      txn({ sourceTransactionId: "b", accountId: "savings", amountCents: 5001 }),
    ];
    expect(flagged(rows)).toEqual([]);
  });

  it("does not pair legs further apart than the settlement window", () => {
    // A coincidence of equal amounts weeks apart is not a transfer.
    const rows = [
      txn({ sourceTransactionId: "a", accountId: "checking", amountCents: -5000, date: "2026-09-01" }),
      txn({ sourceTransactionId: "b", accountId: "savings", amountCents: 5000, date: "2026-09-20" }),
    ];
    expect(flagged(rows)).toEqual([]);
  });

  it("pairs each leg at most once when several candidates match", () => {
    // Two $500 moves out and one $500 in: exactly one pair, not three flags.
    const rows = [
      txn({ sourceTransactionId: "out1", accountId: "checking", amountCents: -50000, date: "2026-09-01" }),
      txn({ sourceTransactionId: "out2", accountId: "checking", amountCents: -50000, date: "2026-09-05" }),
      txn({ sourceTransactionId: "in1", accountId: "savings", amountCents: 50000, date: "2026-09-01" }),
    ];
    const result = flagged(rows);
    expect(result).toHaveLength(2);
    // Prefers the closest date, so it pairs with out1 rather than out2.
    expect(result).toEqual(["in1", "out1"]);
  });

  it("matches a credit-card payment: money out of checking, into the card", () => {
    const rows = [
      txn({ sourceTransactionId: "pay", accountId: "checking", amountCents: -120000, date: "2026-09-10" }),
      txn({ sourceTransactionId: "card", accountId: "demo-card-alex", amountCents: 120000, date: "2026-09-11" }),
    ];
    expect(flagged(rows)).toEqual(["card", "pay"]);
  });

  it("never unsets a transfer flag something else already set", () => {
    // A user rule or an app adjustment may have declared a transfer the
    // matcher can't see a counterpart for. The matcher only ever adds.
    const rows = [txn({ sourceTransactionId: "manual", isTransfer: true, accountId: "checking", amountCents: -999 })];
    expect(flagged(rows)).toEqual(["manual"]);
  });

  it("returns rows unchanged rather than mutating the input", () => {
    const rows = [
      txn({ sourceTransactionId: "out", accountId: "checking", amountCents: -250000 }),
      txn({ sourceTransactionId: "in", accountId: "demo-brokerage", amountCents: 250000 }),
    ];
    matchTransfers(rows);
    expect(rows.every((r) => r.isTransfer === false)).toBe(true);
  });
});
