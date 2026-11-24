// tests/data/budget-log-state.test.ts
// Repo-level CRUD tests for migrations/0007_budget_log_state.sql, mirroring
// the direct-NodeRepository harness used by tests/data/acquisition.test.ts
// (":memory:" DB, migrations auto-run via applyMigrations in the
// NodeRepository constructor).
import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import type { BudgetNote, SnapshotHistoryEntry, DataQualityFlag } from "../../src/domain/notes-types";

function seedPlan(repo: NodeRepository, id = "2027-base"): void {
  repo.createPlan({ id, name: "2027 Base", startDate: "2027-01-01", endDate: "2027-12-31" });
}

function makeDecisionNote(overrides: Partial<BudgetNote> = {}): BudgetNote {
  return {
    id: "note-decision-1",
    planId: "2027-base",
    kind: "decision",
    text: "Pay the annual fee up front",
    status: "locked",
    monthlyCents: null,
    createdAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

function makeTrimNote(overrides: Partial<BudgetNote> = {}): BudgetNote {
  return {
    id: "note-trim-1",
    planId: "2027-base",
    kind: "trim",
    text: "Cancel a streaming plan",
    status: "committed",
    monthlyCents: -1500,
    createdAt: "2026-07-05T00:00:00.000Z",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<SnapshotHistoryEntry> = {}): SnapshotHistoryEntry {
  return {
    id: "snap-1",
    planId: "2027-base",
    asOf: "2026-08-12",
    drawableCents: 6_000_000,
    burn3moCents: 750_000,
    burn12moCents: 800_000,
    note: "Month-end export",
    createdAt: "2026-08-12T13:16:42.000Z",
    ...overrides,
  };
}

function makeFlag(overrides: Partial<DataQualityFlag> = {}): DataQualityFlag {
  return {
    id: "flag-1",
    planId: "2027-base",
    label: "$5,000 brokerage cash entry",
    detail: "Unverified brokerage withdrawal",
    status: "resolved",
    resolution: "Confirmed transfer in the bank data; no action needed",
    createdAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

test("upsertBudgetNote + listBudgetNotes: a decision and a trim note round-trip, plan-scoped", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo);
  const decision = makeDecisionNote();
  const trim = makeTrimNote();

  repo.upsertBudgetNote(decision);
  repo.upsertBudgetNote(trim);

  const notes = repo.listBudgetNotes("2027-base");
  expect(notes).toHaveLength(2);
  const gotDecision = notes.find((n) => n.id === "note-decision-1");
  const gotTrim = notes.find((n) => n.id === "note-trim-1");
  expect(gotDecision).toEqual(decision);
  expect(gotTrim).toEqual(trim);
  expect(gotTrim!.monthlyCents).toBe(-1500);
});

test("listBudgetNotes is scoped to the given plan", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo, "plan-a");
  seedPlan(repo, "plan-b");

  repo.upsertBudgetNote(makeDecisionNote({ id: "a-1", planId: "plan-a" }));
  repo.upsertBudgetNote(makeTrimNote({ id: "b-1", planId: "plan-b" }));

  expect(repo.listBudgetNotes("plan-a").map((n) => n.id)).toEqual(["a-1"]);
  expect(repo.listBudgetNotes("plan-b").map((n) => n.id)).toEqual(["b-1"]);
});

test("deleteBudgetNote removes it", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo);
  repo.upsertBudgetNote(makeDecisionNote());
  expect(repo.listBudgetNotes("2027-base")).toHaveLength(1);

  repo.deleteBudgetNote("note-decision-1");
  expect(repo.listBudgetNotes("2027-base")).toHaveLength(0);
});

test("upsertBudgetNote re-upserting the same id replaces the row (not duplicate)", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo);
  repo.upsertBudgetNote(makeTrimNote());
  repo.upsertBudgetNote(makeTrimNote({ status: "pending", monthlyCents: -1000 }));

  const notes = repo.listBudgetNotes("2027-base");
  expect(notes).toHaveLength(1);
  expect(notes[0].status).toBe("pending");
  expect(notes[0].monthlyCents).toBe(-1000);
});

test("upsertSnapshotHistory + listSnapshotHistory round-trip, plan-scoped", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo, "plan-a");
  seedPlan(repo, "plan-b");
  const snap = makeSnapshot({ planId: "plan-a" });

  repo.upsertSnapshotHistory(snap);
  repo.upsertSnapshotHistory(makeSnapshot({ id: "snap-b", planId: "plan-b" }));

  const gotA = repo.listSnapshotHistory("plan-a");
  expect(gotA).toHaveLength(1);
  expect(gotA[0]).toEqual(snap);
  expect(repo.listSnapshotHistory("plan-b").map((s) => s.id)).toEqual(["snap-b"]);
});

test("upsertSnapshotHistory re-upserting the same id replaces the row", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo);
  repo.upsertSnapshotHistory(makeSnapshot());
  repo.upsertSnapshotHistory(makeSnapshot({ drawableCents: 7_000_000, note: "revised" }));

  const snaps = repo.listSnapshotHistory("2027-base");
  expect(snaps).toHaveLength(1);
  expect(snaps[0].drawableCents).toBe(7_000_000);
  expect(snaps[0].note).toBe("revised");
});

test("upsertDataQualityFlag + listDataQualityFlags: a resolved flag with resolution round-trips", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo);
  const flag = makeFlag();

  repo.upsertDataQualityFlag(flag);

  const flags = repo.listDataQualityFlags("2027-base");
  expect(flags).toHaveLength(1);
  expect(flags[0]).toEqual(flag);
  expect(flags[0].status).toBe("resolved");
  expect(flags[0].resolution).toBe("Confirmed transfer in the bank data; no action needed");
});

test("listDataQualityFlags is scoped to the given plan", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo, "plan-a");
  seedPlan(repo, "plan-b");

  repo.upsertDataQualityFlag(makeFlag({ id: "fa", planId: "plan-a" }));
  repo.upsertDataQualityFlag(makeFlag({ id: "fb", planId: "plan-b", status: "open", resolution: null }));

  expect(repo.listDataQualityFlags("plan-a").map((f) => f.id)).toEqual(["fa"]);
  const bFlags = repo.listDataQualityFlags("plan-b");
  expect(bFlags.map((f) => f.id)).toEqual(["fb"]);
  expect(bFlags[0].status).toBe("open");
  expect(bFlags[0].resolution).toBeNull();
});

test("deleteDataQualityFlag removes it", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo);
  repo.upsertDataQualityFlag(makeFlag());
  expect(repo.listDataQualityFlags("2027-base")).toHaveLength(1);

  repo.deleteDataQualityFlag("flag-1");
  expect(repo.listDataQualityFlags("2027-base")).toHaveLength(0);
});

test("upsertDataQualityFlag re-upserting the same id replaces the row (not duplicate)", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo);
  repo.upsertDataQualityFlag(makeFlag({ status: "open", resolution: null }));
  repo.upsertDataQualityFlag(makeFlag({ status: "resolved", resolution: "fixed at the bank" }));

  const flags = repo.listDataQualityFlags("2027-base");
  expect(flags).toHaveLength(1);
  expect(flags[0].status).toBe("resolved");
  expect(flags[0].resolution).toBe("fixed at the bank");
});
