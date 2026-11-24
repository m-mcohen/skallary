// @vitest-environment jsdom
// tests/ui/GoalsCard.test.tsx
//
// The Dashboard's Goals card: each active goal's
// progress and what it needs a month, computed by the same function the Goals screen
// uses, so the two can never disagree.
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import GoalsCard from "../../src/ui/dashboard/GoalsCard";
import type { Goal, GoalAccountLink, AccountBalance } from "../../src/domain/plan-types";
import type { Account } from "../../src/domain/types";

afterEach(cleanup);

// The Goals screen's fixture: $10,000 by Jan 2030, $1,500 saved outside plus all of
// Savings ($2,500) linked, so $4,000 saved = 40%.
const GOAL: Goal = {
  id: "g1",
  name: "House down payment",
  goalType: "home_down_payment",
  targetAmountCents: 1_000_000,
  targetDate: "2030-01-01",
  priority: 1,
  currentAmountCents: 150_000,
  plannedMonthlyCents: 50_000,
  notes: "",
  archivedAt: null,
};
const ACCOUNTS: Account[] = [
  { id: "acc-sav", name: "Savings", type: "savings", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];
const BALANCES: AccountBalance[] = [{ accountId: "acc-sav", balanceCents: 250_000, asOf: "2026-09-16T00:00:00Z" }];
const LINKS: GoalAccountLink[] = [{ goalId: "g1", accountId: "acc-sav", mode: "entire", amountCents: null }];

const layer = (goals: Goal[]) => ({
  loadDb: async () => ({}) as never,
  listGoals: async () => goals,
  getAccounts: async () => ACCOUNTS,
  getAccountBalances: async () => BALANCES,
  listGoalAccountLinks: async () => LINKS,
  getTransactions: async () => [],
});

test("each active goal shows its progress and what it needs a month", async () => {
  render(<GoalsCard dataLayer={layer([GOAL])} asOf="2026-09-23" />);
  expect(await screen.findByText("House down payment")).toBeTruthy();
  expect(screen.getByTestId("goal-progress-g1").textContent).toBe("40%");
  // $6,000 left over the 41 months from Sep 2026 through Jan 2030, rounded up to the cent ($146.35), shown as $146.
  expect(screen.getByTestId("goal-need-g1").textContent).toBe("About $146 a month");
  // The savings target and date lead.
  expect(screen.getByTestId("goal-target-g1").textContent).toBe("Save $10,000 by Jan 2030");
  expect(screen.getByRole("link", { name: "Open Goals" }).getAttribute("href")).toBe("#/goals/goals");
});

test("a goal with no target date says what it needs instead of a figure", async () => {
  render(<GoalsCard dataLayer={layer([{ ...GOAL, targetDate: null }])} asOf="2026-09-23" />);
  expect((await screen.findByTestId("goal-need-g1")).textContent).toBe("Needs a target date");
});

// 100% saved is Fully saved; only Mark complete is Completed.
test("a fully saved goal reads Fully saved", async () => {
  render(<GoalsCard dataLayer={layer([{ ...GOAL, targetAmountCents: 100_000 }])} asOf="2026-09-23" />);
  expect((await screen.findByTestId("goal-need-g1")).textContent).toBe("Fully saved");
});

test("a goal marked complete reads Completed", async () => {
  render(<GoalsCard dataLayer={layer([{ ...GOAL, completedAt: "2026-09-23T12:00:00.000Z" }])} asOf="2026-09-23" />);
  expect((await screen.findByTestId("goal-need-g1")).textContent).toBe("Completed");
});

test("no active goals says so and links to Goals", async () => {
  render(<GoalsCard dataLayer={layer([{ ...GOAL, archivedAt: "2026-02-01T00:00:00Z" }])} asOf="2026-09-23" />);
  expect(await screen.findByText("No active goals yet.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open Goals" }).getAttribute("href")).toBe("#/goals/goals");
});

test("says so plainly when the local server cannot be reached", async () => {
  render(<GoalsCard dataLayer={{ loadDb: async () => { throw new Error("down"); } }} asOf="2026-09-23" />);
  expect(await screen.findByText("Goals could not be loaded. The local server is not reachable.")).toBeTruthy();
});
