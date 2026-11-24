// tests/ui/GoalDialog.test.ts -- the goal dialog's save logic.
import { describe, expect, test } from "vitest";
import { draftFor, goalFromDraft } from "../../src/ui/goals/GoalDialog";
import type { Goal } from "../../src/domain/plan-types";

const someGoal: Goal = { id: "g1", name: "House", goalType: "savings", targetAmountCents: 24_000_000, targetDate: "2030-09-01", priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null };

describe("goalFromDraft", () => {
  // The dialog rebuilds the whole goal; it must never drop the marks.
  test("saving an edit keeps the ongoing cost's start month, its budget line and the completed mark", () => {
    const editing: Goal = { ...someGoal, ongoingMonthlyCents: 250000, ongoingStartedPeriod: "2026-10", ongoingBudgetLine: "Housing", completedAt: "2026-10-01T12:00:00.000Z" };
    const r = goalFromDraft({ ...draftFor(editing), name: "House, renamed" }, editing);
    if ("error" in r) throw new Error(r.error);
    expect(r.goal).toMatchObject({ name: "House, renamed", ongoingMonthlyCents: 250000, ongoingStartedPeriod: "2026-10", ongoingBudgetLine: "Housing", completedAt: "2026-10-01T12:00:00.000Z" });
  });

  test("the ongoing cost box reads dollars; blank is none; negative is refused", () => {
    const d = { ...draftFor(null), name: "X", targetDollars: "100" };
    expect(goalFromDraft({ ...d, ongoingDollars: "" }, null)).toMatchObject({ goal: { ongoingMonthlyCents: 0, ongoingStartedPeriod: null, completedAt: null } });
    expect(goalFromDraft({ ...d, ongoingDollars: "200" }, null)).toMatchObject({ goal: { ongoingMonthlyCents: 20000 } });
    expect(goalFromDraft({ ...d, ongoingDollars: "-5" }, null)).toEqual({ error: "Ongoing cost a month cannot be negative." });
  });

  test("an edit opens with the goal's ongoing cost in the box", () => {
    expect(draftFor({ ...someGoal, ongoingMonthlyCents: 20000 }).ongoingDollars).toBe("200.00");
    expect(draftFor(someGoal).ongoingDollars).toBe("");
  });
});
