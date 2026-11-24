// Transaction notes and categorization history share an in-memory repository in each test.
import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";

const at = "2027-02-15T12:00:00.000Z";

test("a note is saved, replaced, and an empty note deletes it", () => {
  const repo = new NodeRepository(":memory:");
  repo.setTransactionNote("t1", "First toy order", at);
  repo.setTransactionNote("t1", "Updated toy order", at);
  expect(repo.listTransactionNotes()).toEqual([{ sourceTransactionId: "t1", note: "Updated toy order", updatedAt: at }]);
  repo.setTransactionNote("t1", "   ", at);
  expect(repo.listTransactionNotes()).toEqual([]);
});

test("a note moves to the settled row only when that row has none", () => {
  const repo = new NodeRepository(":memory:");
  repo.setTransactionNote("pending-1", "Toy reservation", at);
  expect(repo.moveTransactionNote("pending-1", "posted-1")).toBe(true);
  expect(repo.listTransactionNotes().map((n) => [n.sourceTransactionId, n.note])).toEqual([["posted-1", "Toy reservation"]]);
  repo.setTransactionNote("pending-2", "Pending toy order", at);
  repo.setTransactionNote("posted-2", "Settled toy order", at);
  expect(repo.moveTransactionNote("pending-2", "posted-2")).toBe(false);
  expect(repo.listTransactionNotes().find((n) => n.sourceTransactionId === "posted-2")?.note).toBe("Settled toy order");
});

test("an adjustment returns its id and can be deleted by it", () => {
  const repo = new NodeRepository(":memory:");
  // Removing the new adjustment preserves existing rows.
  const before = repo.getTransactionAdjustments();
  const id = repo.addTransactionAdjustment({ matchKind: "id", sourceTransactionId: "t1", action: "recategorize", toCategory: "Gas", note: null });
  expect(id).toBeGreaterThan(0);
  expect(repo.getTransactionAdjustments()).toHaveLength(before.length + 1);
  repo.deleteTransactionAdjustment(id);
  expect(repo.getTransactionAdjustments()).toEqual(before);
});

test("one recurring choice is read by merchant and account", () => {
  const repo = new NodeRepository(":memory:");
  expect(repo.getRecurringChoice("toy bookshop", "a1")).toBeNull();
  repo.upsertRecurringChoice({ payeeKey: "toy bookshop", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Toy Bookshop", createdAt: at });
  expect(repo.getRecurringChoice("toy bookshop", "a1")?.cadence).toBe("monthly");
});

test("the log round trips, lists newest first from a date, and records an undo", () => {
  const repo = new NodeRepository(":memory:");
  const base = {
    sourceTransactionId: "t1", label: "Toy Bookshop", fromCategory: "Fuel", toCategory: "Gas", ruleId: 7, adjustmentId: null,
    recurringPayeeKey: null, recurringAccountId: null, priorRecurringChoice: null, writtenRecurringChoice: null,
  };
  const old = repo.addCategorizationLog({ ...base, createdAt: "2026-12-01T12:00:00.000Z" });
  const a = repo.addCategorizationLog({ ...base, createdAt: "2027-02-01T12:00:00.000Z" });
  const b = repo.addCategorizationLog({ ...base, createdAt: "2027-02-10T12:00:00.000Z" });
  expect(repo.listCategorizationLog("2027-01-01T00:00:00.000Z").map((e) => e.id)).toEqual([b, a]);
  repo.markCategorizationUndone(a, at);
  expect(repo.getCategorizationLog(a)?.undoneAt).toBe(at);
  expect(repo.getCategorizationLog(old)?.ruleId).toBe(7);
  expect(repo.getCategorizationLog(999)).toBeNull();
});

test("a logged recurring choice comes back whole", () => {
  const repo = new NodeRepository(":memory:");
  const prior = { payeeKey: "toy market", accountId: "a1", choice: "recurring" as const, cadence: "monthly" as const, label: "Toy Market", createdAt: at };
  const id = repo.addCategorizationLog({
    createdAt: at, sourceTransactionId: "t1", label: "Toy Market", fromCategory: "Streaming", toCategory: "Fun", ruleId: null, adjustmentId: 3,
    recurringPayeeKey: "toy market", recurringAccountId: "a1", priorRecurringChoice: prior, writtenRecurringChoice: null,
  });
  const e = repo.getCategorizationLog(id)!;
  expect(e.priorRecurringChoice).toEqual(prior);
  expect(e.writtenRecurringChoice).toBeNull();
  expect(e.recurringPayeeKey).toBe("toy market");
});

test("inTransaction rolls every write back when one throws", () => {
  const repo = new NodeRepository(":memory:");
  expect(() =>
    repo.inTransaction(() => {
      repo.setTransactionNote("t1", "Temporary toy note", at);
      throw new Error("boom");
    })
  ).toThrow("boom");
  expect(repo.listTransactionNotes()).toEqual([]);
});
