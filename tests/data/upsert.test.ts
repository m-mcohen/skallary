import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import type { NormalizedTxn } from "../../src/domain/types";

const txn: NormalizedTxn = {
  sourceTransactionId: "csv:abc", accountId: "demo-checking", date: "2026-08-01",
  amountCents: -12000, sourceCategory: "Groceries", merchant: "Whole Foods",
  isTransfer: false, sourceUpdatedAt: null,
};

test("upsert is idempotent: run twice, one row, no dup", () => {
  const repo = new NodeRepository(":memory:");
  const r1 = repo.upsertTransactions([txn]);
  expect(r1).toEqual({ inserted: 1, updated: 0 });
  const r2 = repo.upsertTransactions([txn]);
  expect(r2).toEqual({ inserted: 0, updated: 1 });
  expect(repo.getTransactions()).toHaveLength(1);
});

test("lastSyncedDate returns max date", () => {
  const repo = new NodeRepository(":memory:");
  repo.upsertTransactions([txn, { ...txn, sourceTransactionId: "csv:def", date: "2026-08-09" }]);
  expect(repo.lastSyncedDate()).toBe("2026-08-09");
});

test("re-sending a retired row leaves it retired", () => {
  // The settle pass retires a pending row the bank keeps reporting, and the
  // seam re-cut retires older imported rows a CSV could be re-imported over. Neither
  // may come back just because the same id was upserted again.
  const repo = new NodeRepository(":memory:");
  repo.upsertTransactions([txn]);
  expect(repo.retireTransactions([txn.sourceTransactionId])).toBe(1);
  const r = repo.upsertTransactions([{ ...txn, amountCents: -99 }]);
  expect(r).toEqual({ inserted: 0, updated: 1 });
  expect(repo.getTransactions()).toHaveLength(0);
});
