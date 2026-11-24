// @vitest-environment jsdom
// tests/ui/GoalCard.test.tsx -- the goal card leads with its savings target and
// carries its ongoing cost.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import GoalCard from "../../src/ui/goals/GoalCard";
import { goalFunding, goalStatus } from "../../src/domain/goals";
import type { Goal } from "../../src/domain/plan-types";

afterEach(cleanup);

const AS_OF = "2026-09-30";
const base: Goal = { id: "g1", name: "House", goalType: "savings", targetAmountCents: 24_000_000, targetDate: "2030-09-01", priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null };

function renderCard(over: Partial<Goal> = {}, saved = 0) {
  const goal = { ...base, ...over };
  const handlers = { onStartCost: vi.fn(), onMarkComplete: vi.fn(), onUnmarkComplete: vi.fn() };
  render(
    <GoalCard
      status={goalStatus(goal, saved, AS_OF)}
      funding={goalFunding(goal, [], [], [])}
      accountsAvailable
      busy={false}
      onEdit={vi.fn()}
      onAccounts={vi.fn()}
      onArchive={vi.fn()}
      onUnarchive={vi.fn()}
      onDelete={vi.fn()}
      {...handlers}
    />
  );
  return handlers;
}

describe("GoalCard", () => {
  test("the card leads with the savings target and date, and the monthly amount is a smaller line", () => {
    renderCard();
    expect(screen.getByTestId("goal-target-line-g1").textContent).toBe("Save $240,000 by Sep 2030");
    // 49 months, Sep 2026 through Sep 2030: $240,000 / 49 = $4,897.96 (rounded up), shown as $4,898.
    expect(screen.getByTestId("goal-monthly-line-g1").textContent).toBe("About $4,898 a month to get there");
  });

  test("a fully saved goal has no monthly line", () => {
    renderCard({}, 24_000_000);
    expect(screen.queryByTestId("goal-monthly-line-g1")).toBeNull();
  });

  test("a planned cost reads Then, with Start this cost", () => {
    const h = renderCard({ ongoingMonthlyCents: 250000 });
    expect(screen.getByTestId("goal-cost-line-g1").textContent).toBe("Then $2,500 a month");
    screen.getByRole("button", { name: "Start this cost for House" }).click();
    expect(h.onStartCost).toHaveBeenCalled();
  });

  test("a started cost names its budget line and month, with no Start button", () => {
    renderCard({ ongoingMonthlyCents: 250000, ongoingStartedPeriod: "2026-10", ongoingBudgetLine: "Housing" });
    expect(screen.getByTestId("goal-cost-line-g1").textContent).toBe("$2,500 a month, in your budget as Housing since Oct 2026");
    expect(screen.queryByRole("button", { name: /Start this cost/ })).toBeNull();
  });

  test("no ongoing cost, no cost line", () => {
    renderCard();
    expect(screen.queryByTestId("goal-cost-line-g1")).toBeNull();
    expect(screen.queryByRole("button", { name: /Start this cost/ })).toBeNull();
  });

  test("Mark complete, and Unmark complete once completed", () => {
    const h = renderCard();
    screen.getByRole("button", { name: "Mark House complete" }).click();
    expect(h.onMarkComplete).toHaveBeenCalled();
    cleanup();
    const h2 = renderCard({ completedAt: "2026-10-01T00:00:00.000Z" });
    expect(screen.queryByRole("button", { name: "Mark House complete" })).toBeNull();
    screen.getByRole("button", { name: "Unmark House complete" }).click();
    expect(h2.onUnmarkComplete).toHaveBeenCalled();
  });

  test("an archived goal offers neither Start this cost nor Mark complete", () => {
    renderCard({ archivedAt: "2026-09-01T00:00:00.000Z", ongoingMonthlyCents: 250000 });
    expect(screen.queryByRole("button", { name: /Start this cost/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /complete/ })).toBeNull();
  });
});
