// @vitest-environment jsdom
// tests/ui/goal-saving-row.test.tsx
//
// A goal's saving row on What if is set up once, on the
// Goals screen. The card says what What if saves a month for the goal and where
// the amount comes from; the dialog says how Planned per month feeds it.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import GoalCard from "../../src/ui/goals/GoalCard";
import GoalDialog from "../../src/ui/goals/GoalDialog";
import { goalFunding, goalStatus } from "../../src/domain/goals";
import type { Goal } from "../../src/domain/plan-types";

afterEach(cleanup);

const AS_OF = "2026-09-30";
const base: Goal = { id: "g1", name: "House", goalType: "savings", targetAmountCents: 23_400_000, targetDate: "2030-09-01", priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null };

function renderCard(over: Partial<Goal> = {}, saved = 0) {
  const goal = { ...base, ...over };
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
    />
  );
}

describe("the goal card's What if line", () => {
  test("nothing typed: What if saves what the target date needs", () => {
    renderCard();
    // 49 months, Sep 2026 through Sep 2030: $234,000 / 49 = $4,775.52 (rounded up). The Goals
    // screen shows whole dollars (goals-wishlist-whole-dollars), so $4,776.
    expect(screen.getByTestId("goal-whatif-line-g1").textContent).toBe("On What if: saves $4,776 a month, worked out from the target date (Sep 2030).");
  });

  test("a planned amount typed: What if saves that, and says when it finishes at that pace", () => {
    // $234,000 at $5,000 a month: ceil(46.8) = 47 payments, Sep 2026 through Jul 2030.
    renderCard({ plannedMonthlyCents: 500_000 });
    expect(screen.getByTestId("goal-whatif-line-g1").textContent).toBe("On What if: saves your planned $5,000 a month, fully saved by Jul 2030.");
  });

  test("fully saved: nothing more; no date and nothing typed: says what is missing", () => {
    renderCard({}, 23_400_000);
    expect(screen.getByTestId("goal-whatif-line-g1").textContent).toBe("On What if: nothing more to save.");
    cleanup();
    renderCard({ targetDate: null });
    expect(screen.getByTestId("goal-whatif-line-g1").textContent).toBe("On What if: saves nothing until it has a target date or a planned amount.");
  });

  test("an archived goal is not on What if, so the card has no line", () => {
    renderCard({ archivedAt: "2026-09-01T00:00:00.000Z" });
    expect(screen.queryByTestId("goal-whatif-line-g1")).toBeNull();
  });
});

describe("the goal dialog", () => {
  test("Planned per month says it is what What if saves, and that blank means the target date decides", () => {
    render(<GoalDialog open onOpenChange={vi.fn()} editing={null} linkedCents={0} onSave={vi.fn(async () => {})} getRates={async () => null} />);
    expect(screen.getByText("What if saves this a month for the goal. Leave it blank to save what the target date needs.")).toBeTruthy();
  });
});
