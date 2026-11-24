import { describe, it, expect } from "vitest";
import { settledPairs, autoSyncDue, AUTO_SYNC_STALE_HOURS } from "../../src/domain/simplefin";
import type { NormalizedTxn } from "../../src/domain/types";

/** The pending rows' ids alone, as the settle pass retires them. */
const settledDuplicates = (pending: NormalizedTxn[], posted: NormalizedTxn[]) => settledPairs(pending, posted).map((p) => p.pendingId);

function txn(over: Partial<NormalizedTxn> & { sourceTransactionId: string }): NormalizedTxn {
  return {
    accountId: "acc-a",
    date: "2026-09-01",
    amountCents: -1234,
    sourceCategory: null,
    merchant: "Coffee",
    isTransfer: false,
    sourceUpdatedAt: null,
    pending: false,
    ...over,
  };
}

describe("settledDuplicates", () => {
  it("retires a pending row when a posted row with a new id settles it", () => {
    // Some institutions issue a fresh transaction id on settlement, so the
    // in-place upsert never sees the pending row again and it would sit in the
    // ledger forever, double-counting the purchase.
    const pending = [txn({ sourceTransactionId: "p1", date: "2026-09-01", pending: true })];
    const posted = [txn({ sourceTransactionId: "s1", date: "2026-09-03" })];
    expect(settledDuplicates(pending, posted)).toEqual(["p1"]);
  });

  it("requires the same account and amount", () => {
    const pending = [txn({ sourceTransactionId: "p1", pending: true })];
    expect(settledDuplicates(pending, [txn({ sourceTransactionId: "s1", accountId: "acc-b" })])).toEqual([]);
    expect(settledDuplicates(pending, [txn({ sourceTransactionId: "s1", amountCents: -1235 })])).toEqual([]);
  });

  it("allows at most three days between the pending and posted dates", () => {
    const pending = [txn({ sourceTransactionId: "p1", date: "2026-09-01", pending: true })];
    expect(settledDuplicates(pending, [txn({ sourceTransactionId: "s1", date: "2026-09-04" })])).toEqual(["p1"]);
    expect(settledDuplicates(pending, [txn({ sourceTransactionId: "s1", date: "2026-09-05" })])).toEqual([]);
    // The posted date can also precede the pending one (feed clock skew).
    expect(settledDuplicates(pending, [txn({ sourceTransactionId: "s1", date: "2026-08-29" })])).toEqual(["p1"]);
  });

  it("never matches a row against itself -- an in-place settle is not a duplicate", () => {
    // The normal case: the same id comes back with pending=false and the
    // upsert updates it in place. Nothing to retire.
    const pending = [txn({ sourceTransactionId: "same", pending: true })];
    const posted = [txn({ sourceTransactionId: "same" })];
    expect(settledDuplicates(pending, posted)).toEqual([]);
  });

  it("consumes each posted row once and lets the closest pending row win", () => {
    // Two identical pending coffees, one posted settle: only the closer one
    // is retired; the other is still genuinely outstanding.
    const pending = [
      txn({ sourceTransactionId: "p-far", date: "2026-08-30", pending: true }),
      txn({ sourceTransactionId: "p-near", date: "2026-09-02", pending: true }),
    ];
    const posted = [txn({ sourceTransactionId: "s1", date: "2026-09-02" })];
    expect(settledDuplicates(pending, posted)).toEqual(["p-near"]);
  });

  it("matches each pending row at most once even when several posted rows qualify", () => {
    const pending = [txn({ sourceTransactionId: "p1", date: "2026-09-01", pending: true })];
    const posted = [
      txn({ sourceTransactionId: "s-near", date: "2026-09-02" }),
      txn({ sourceTransactionId: "s-far", date: "2026-09-04" }),
    ];
    expect(settledDuplicates(pending, posted)).toEqual(["p1"]);
  });

  it("ignores posted rows that are themselves still pending", () => {
    const pending = [txn({ sourceTransactionId: "p1", pending: true })];
    const posted = [txn({ sourceTransactionId: "p2", pending: true })];
    expect(settledDuplicates(pending, posted)).toEqual([]);
  });

  it("does not let a posted row settle a pending row for a different merchant", () => {
    // Same account, same amount, a day apart -- but a $5 coffee posting on
    // Monday is not the $5 transit fare still pending on Tuesday.
    const pending = [txn({ sourceTransactionId: "p-transit", date: "2026-09-02", pending: true, merchant: "Metro Transit", payee: "Metro Transit", description: "PENDING METRO TRANSIT" })];
    const posted = [txn({ sourceTransactionId: "s-coffee", date: "2026-09-01", merchant: "Starbucks", payee: "Starbucks", description: "STARBUCKS #1234" })];
    expect(settledDuplicates(pending, posted)).toEqual([]);
  });

  it("matches on a shared identity token, ignoring the bank's boilerplate", () => {
    // The pending memo is usually the bank's own wording around the merchant
    // name, so "PENDING STARBUCKS" and "STARBUCKS #1234" are the same purchase.
    const pending = [txn({ sourceTransactionId: "p1", date: "2026-09-01", pending: true, merchant: null, payee: null, description: "PENDING PURCHASE STARBUCKS" })];
    const posted = [txn({ sourceTransactionId: "s1", date: "2026-09-03", merchant: null, payee: "Starbucks #1234", description: "POS DEBIT CARD STARBUCKS #1234" })];
    expect(settledDuplicates(pending, posted)).toEqual(["p1"]);
  });

  it("still settles on amount and date alone when either side has no usable memo", () => {
    // Boilerplate-only text ("PENDING PURCHASE") says nothing about who was
    // paid, so it must not block a match the amount and date support.
    const pending = [txn({ sourceTransactionId: "p1", date: "2026-09-01", pending: true, merchant: null, payee: null, description: "PENDING PURCHASE" })];
    const posted = [txn({ sourceTransactionId: "s1", date: "2026-09-02", merchant: "Starbucks", payee: "Starbucks", description: "STARBUCKS #1234" })];
    expect(settledDuplicates(pending, posted)).toEqual(["p1"]);

    const bare = [txn({ sourceTransactionId: "p2", date: "2026-09-01", pending: true, merchant: null, payee: null, description: null })];
    expect(settledDuplicates(bare, posted)).toEqual(["p2"]);
  });
});

describe("autoSyncDue", () => {
  const NOW = Date.parse("2026-09-02T12:00:00.000Z");
  const HOUR = 3_600_000;

  it("is never due when the connector is not set up", () => {
    expect(autoSyncDue({ accessUrl: null, lastSyncedAt: null }, NOW)).toBe(false);
  });

  it("is due when connected but never synced", () => {
    expect(autoSyncDue({ accessUrl: "https://bridge.example/simplefin", lastSyncedAt: null }, NOW)).toBe(true);
  });

  it("is due only once the last sync is older than the stale threshold", () => {
    const state = (hoursAgo: number) => ({
      accessUrl: "https://bridge.example/simplefin",
      lastSyncedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
    });
    expect(AUTO_SYNC_STALE_HOURS).toBe(12);
    expect(autoSyncDue(state(1), NOW)).toBe(false);
    expect(autoSyncDue(state(11.9), NOW)).toBe(false);
    expect(autoSyncDue(state(12.1), NOW)).toBe(true);
    expect(autoSyncDue(state(48), NOW)).toBe(true);
  });

  it("honors a custom threshold", () => {
    const state = { accessUrl: "https://bridge.example/simplefin", lastSyncedAt: new Date(NOW - 2 * HOUR).toISOString() };
    expect(autoSyncDue(state, NOW, 1)).toBe(true);
    expect(autoSyncDue(state, NOW, 3)).toBe(false);
  });
});

describe("settledPairs", () => {
  it("names the posted row that settled each pending row, so its note can follow", () => {
    const pending = [txn({ sourceTransactionId: "p1", date: "2026-09-01", pending: true })];
    const posted = [txn({ sourceTransactionId: "s1", date: "2026-09-03" })];
    expect(settledPairs(pending, posted)).toEqual([{ pendingId: "p1", postedId: "s1" }]);
  });
  it("pairs the closest dates when two posted rows could settle one pending row", () => {
    const pending = [txn({ sourceTransactionId: "p1", date: "2026-09-01", pending: true })];
    const posted = [txn({ sourceTransactionId: "far", date: "2026-09-04" }), txn({ sourceTransactionId: "near", date: "2026-09-02" })];
    expect(settledPairs(pending, posted)).toEqual([{ pendingId: "p1", postedId: "near" }]);
  });
});
