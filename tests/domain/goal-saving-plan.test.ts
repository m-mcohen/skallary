// tests/domain/goal-saving-plan.test.ts
//
// A goal's saving row on What if is set up once, on the Goals screen. Its monthly amount is
// (target minus saved) divided by the months left to the target date; or, when a Planned per
// month is typed, that amount, and the goal then shows its finish date at that pace. Saved is
// linked balances plus money saved outside accounts.
import { describe, expect, test } from "vitest";
import { goalSavingPlan, goalStatus } from "../../src/domain/goals";
import type { Goal } from "../../src/domain/plan-types";

const goal = (over: Partial<Goal>): Goal => ({
  id: "g", name: "Vehicle", goalType: "car", targetAmountCents: 5_000_000, targetDate: "2027-09-01", priority: 0,
  currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null, ...over,
});
const AS_OF = "2026-10-02";

describe("goalSavingPlan", () => {
  test("no amount typed: worked out from the target date", () => {
    // $50,000 to save, $2,000 saved: $48,000 left. Months Oct 2026 through Sep 2027 = 12.
    // 4,800,000 / 12 = 400,000 exactly: $4,000 a month, finishing on the target date.
    const s = goalStatus(goal({}), 200_000, AS_OF);
    expect(goalSavingPlan(s)).toEqual({ monthlyCents: 400_000, source: "target-date", finishPeriod: "2027-09" });
  });

  test("a typed amount wins, and the goal finishes when that pace gets there", () => {
    // $48,000 left at $5,000 a month: ceil(48,000 / 5,000) = 10 (9.6 rounds up) payments, Oct 2026 through Jul 2027.
    const s = goalStatus(goal({ plannedMonthlyCents: 500_000 }), 200_000, AS_OF);
    expect(goalSavingPlan(s)).toEqual({ monthlyCents: 500_000, source: "planned", finishPeriod: "2027-07" });
  });

  test("fully saved or marked complete: nothing more a month", () => {
    expect(goalSavingPlan(goalStatus(goal({}), 5_000_000, AS_OF))).toEqual({ monthlyCents: 0, source: "done", finishPeriod: null });
    expect(goalSavingPlan(goalStatus(goal({ completedAt: "2026-09-30T00:00:00Z", plannedMonthlyCents: 500_000 }), 0, AS_OF))).toEqual({ monthlyCents: 0, source: "done", finishPeriod: null });
  });

  test("no target date and nothing typed: no amount", () => {
    expect(goalSavingPlan(goalStatus(goal({ targetDate: null }), 0, AS_OF))).toEqual({ monthlyCents: null, source: "none", finishPeriod: null });
  });
});
