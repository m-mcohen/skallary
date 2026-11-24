// tests/ui/goal-card-labels.test.ts
// The goal card's words for a goal with
// nothing left to save. Fully saved is automatic; Completed is Mark complete.
import { describe, expect, test } from "vitest";
import { STATUS_LABEL, finishLine } from "../../src/ui/goals/GoalCard";
import type { Goal, GoalStatus } from "../../src/domain/plan-types";

const goal = { id: "g1", name: "House", goalType: "savings", targetAmountCents: 1000, targetDate: "2027-01-01", priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null } as Goal;
const status = (s: GoalStatus["status"]): GoalStatus =>
  ({ goal, savedCents: 1000, progressPct: 1, remainingCents: 0, monthsRemaining: 4, recommendedMonthlyCents: null, forecastPeriod: null, monthsUntilDone: 0, monthsVsTarget: null, status: s, thisMonthCents: null }) as GoalStatus;

describe("the goal card's words", () => {
  test("the pill says Fully saved or Completed", () => {
    expect(STATUS_LABEL.fully_saved).toBe("Fully saved");
    expect(STATUS_LABEL.completed).toBe("Completed");
  });
  test("Projected finish says Fully saved or Completed, never a vague Done", () => {
    expect(finishLine(status("fully_saved"))).toBe("Fully saved");
    expect(finishLine(status("completed"))).toBe("Completed");
  });
});
