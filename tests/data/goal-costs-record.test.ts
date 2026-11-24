// tests/data/goal-costs-record.test.ts
// Optional fields on a goal for what it costs once reached, when that cost started,
// the budget line it went into, and when the goal was marked complete.
import { describe, expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import { normalizeGoal } from "../../server/services/readService";

const base = { id: "g1", name: "House", goalType: "savings", targetAmountCents: 24000000, targetDate: "2030-09-01", priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null };

describe("the goal record", () => {
  test("a goal written without the new fields reads back with none set", () => {
    const repo = new NodeRepository(":memory:");
    repo.upsertGoal(base as never);
    expect(repo.listGoals()[0]).toMatchObject({ ongoingMonthlyCents: 0, ongoingStartedPeriod: null, ongoingBudgetLine: null, completedAt: null });
  });

  test("the ongoing cost, its start month, its budget line and the completed mark round-trip", () => {
    const repo = new NodeRepository(":memory:");
    repo.upsertGoal({ ...base, ongoingMonthlyCents: 250000, ongoingStartedPeriod: "2026-10", ongoingBudgetLine: "Housing", completedAt: "2026-10-01T12:00:00.000Z" } as never);
    expect(repo.listGoals()[0]).toMatchObject({ ongoingMonthlyCents: 250000, ongoingStartedPeriod: "2026-10", ongoingBudgetLine: "Housing", completedAt: "2026-10-01T12:00:00.000Z" });
  });

  test("the server refuses a negative ongoing cost or a malformed month, in plain words", () => {
    expect(() => normalizeGoal({ ...base, ongoingMonthlyCents: -1 })).toThrow("Ongoing cost a month cannot be negative.");
    expect(() => normalizeGoal({ ...base, ongoingStartedPeriod: "Oct 2026" })).toThrow("The month a cost started must be a month (YYYY-MM) or blank.");
    expect(() => normalizeGoal({ ...base, completedAt: 5 })).toThrow("Completed timestamp must be text or blank.");
  });

  test("the server fills the new fields when an older payload leaves them out", () => {
    // A payload that leaves them out must not clear them, so they stay absent here
    // and the repository keeps what is stored (see "a save that leaves the marks out keeps them").
    const n = normalizeGoal(base);
    expect([n.ongoingMonthlyCents, n.ongoingStartedPeriod, n.ongoingBudgetLine, n.completedAt]).toEqual([undefined, undefined, undefined, undefined]);
    expect(() => normalizeGoal({ ...base, ongoingBudgetLine: 7 })).toThrow("The budget line must be text or blank.");
  });
});

// The command-line tool and older payloads
// rebuild a goal without these fields; that must not erase a started cost's marks.
describe("keeping a goal's marks", () => {
  const started = { ...base, ongoingMonthlyCents: 250000, ongoingStartedPeriod: "2026-10", ongoingBudgetLine: "Housing", completedAt: "2026-10-01T12:00:00.000Z" };
  test("a save that leaves the marks out keeps them", () => {
    const repo = new NodeRepository(":memory:");
    repo.upsertGoal(started as never);
    repo.upsertGoal({ ...base, name: "House, renamed" } as never);
    expect(repo.listGoals()[0]).toMatchObject({ name: "House, renamed", ongoingMonthlyCents: 250000, ongoingStartedPeriod: "2026-10", ongoingBudgetLine: "Housing", completedAt: "2026-10-01T12:00:00.000Z" });
  });
  test("a save that sets a mark to null clears it", () => {
    const repo = new NodeRepository(":memory:");
    repo.upsertGoal(started as never);
    repo.upsertGoal({ ...started, completedAt: null } as never);
    expect(repo.listGoals()[0].completedAt).toBeNull();
    expect(repo.listGoals()[0].ongoingStartedPeriod).toBe("2026-10");
  });
});

// Prove the one step really is all or nothing.
test("a budget write that fails part way leaves the goal and the budget as they were", () => {
  const repo = new NodeRepository(":memory:");
  repo.createPlan({ id: "p", name: "p", startDate: "2026-01-01", endDate: "2026-12-31" } as never);
  repo.upsertGoal({ ...base, ongoingMonthlyCents: 20000 } as never);
  const good = { planId: "p", planningCategory: "Gym", period: null, amountCents: 20000 };
  const bad = { planId: "p", planningCategory: null, period: "2026-01", amountCents: 0 };
  expect(() => repo.applyGoalChange({ ...base, ongoingMonthlyCents: 20000, ongoingStartedPeriod: "2026-10", completedAt: "2026-10-01T00:00:00.000Z" } as never, [good, bad] as never)).toThrow();
  expect(repo.getBudgetLines("p")).toEqual([]);
  expect(repo.listGoals()[0]).toMatchObject({ ongoingStartedPeriod: null, completedAt: null });
});
