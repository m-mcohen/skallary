// tests/data/goals-wishlist-balances.test.ts
import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import type { Goal, GoalAccountLink, WishlistItem, AccountBalance } from "../../src/domain/plan-types";
import type { Account } from "../../src/domain/types";

const goal: Goal = {
  id: "g1", name: "House", goalType: "home_down_payment", targetAmountCents: 7500000, targetDate: "2030-01-01",
  priority: 1, currentAmountCents: 1000000, plannedMonthlyCents: 0, notes: "", archivedAt: null,
};
const wish: WishlistItem = { id: "w1", name: "Watch", costCents: 500000, kind: "wish", targetDate: null, priority: 1, planningCategory: null };
const bal: AccountBalance = { accountId: "demo-checking", balanceCents: 4200000, asOf: "2026-08-31T00:00:00Z" };

function account(id: string): Account {
  return { id, name: id, type: "savings", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" };
}

test("goal upsert + list + update-not-duplicate", () => {
  const repo = new NodeRepository(":memory:");
  repo.upsertGoal(goal);
  repo.upsertGoal({ ...goal, currentAmountCents: 2000000 });
  const gs = repo.listGoals();
  expect(gs).toHaveLength(1);
  expect(gs[0].currentAmountCents).toBe(2000000);
});

test("goal upsert round-trips every column, including a null target date and archive", () => {
  const repo = new NodeRepository(":memory:");
  const full: Goal = { ...goal, targetDate: null, plannedMonthlyCents: 45000, notes: "20% down", archivedAt: "2026-03-16T01:02:03.000Z",
    // The goal-cost fields default.
    ongoingMonthlyCents: 0, ongoingStartedPeriod: null, ongoingBudgetLine: null, completedAt: null };
  repo.upsertGoal(full);
  expect(repo.listGoals()[0]).toEqual(full);
  repo.upsertGoal({ ...full, archivedAt: null, targetDate: "2031-06-01" });
  expect(repo.listGoals()).toHaveLength(1);
  expect(repo.listGoals()[0]).toMatchObject({ archivedAt: null, targetDate: "2031-06-01", plannedMonthlyCents: 45000 });
});

test("goals list in priority order, ties by id", () => {
  const repo = new NodeRepository(":memory:");
  repo.upsertGoal({ ...goal, id: "b", priority: 2 });
  repo.upsertGoal({ ...goal, id: "c", priority: 1 });
  repo.upsertGoal({ ...goal, id: "a", priority: 2 });
  expect(repo.listGoals().map((g) => g.id)).toEqual(["c", "a", "b"]);
});

test("goal account links: replace-all per goal, listed across goals, deleted with the goal", () => {
  const repo = new NodeRepository(":memory:");
  repo.upsertAccounts([account("a1"), account("a2")]);
  repo.upsertGoal(goal);
  repo.upsertGoal({ ...goal, id: "g2" });

  repo.replaceGoalAccountLinks("g1", [
    { goalId: "g1", accountId: "a1", mode: "entire", amountCents: null },
    { goalId: "g1", accountId: "a2", mode: "fixed", amountCents: 5000 },
  ]);
  repo.replaceGoalAccountLinks("g2", [{ goalId: "g2", accountId: "a2", mode: "fixed", amountCents: 7000 }]);
  const expected: GoalAccountLink[] = [
    { goalId: "g1", accountId: "a1", mode: "entire", amountCents: null },
    { goalId: "g1", accountId: "a2", mode: "fixed", amountCents: 5000 },
    { goalId: "g2", accountId: "a2", mode: "fixed", amountCents: 7000 },
  ];
  expect(repo.listGoalAccountLinks()).toEqual(expected);

  // Replace-all: g1's a1 link goes away, its a2 slice changes, g2 is untouched.
  repo.replaceGoalAccountLinks("g1", [{ goalId: "g1", accountId: "a2", mode: "fixed", amountCents: 9000 }]);
  expect(repo.listGoalAccountLinks()).toEqual([
    { goalId: "g1", accountId: "a2", mode: "fixed", amountCents: 9000 },
    { goalId: "g2", accountId: "a2", mode: "fixed", amountCents: 7000 },
  ]);

  // Deleting a goal removes its links (the app never enables PRAGMA foreign_keys).
  repo.deleteGoal("g1");
  expect(repo.listGoals().map((g) => g.id)).toEqual(["g2"]);
  expect(repo.listGoalAccountLinks()).toEqual([{ goalId: "g2", accountId: "a2", mode: "fixed", amountCents: 7000 }]);
});

test("an account's entire balance can fund only one goal, and a refused replace leaves the old links intact", () => {
  const repo = new NodeRepository(":memory:");
  repo.upsertAccounts([account("a1"), account("a2")]);
  repo.upsertGoal(goal);
  repo.upsertGoal({ ...goal, id: "g2" });
  repo.replaceGoalAccountLinks("g1", [{ goalId: "g1", accountId: "a1", mode: "entire", amountCents: null }]);
  repo.replaceGoalAccountLinks("g2", [{ goalId: "g2", accountId: "a2", mode: "fixed", amountCents: 100 }]);

  expect(() =>
    repo.replaceGoalAccountLinks("g2", [
      { goalId: "g2", accountId: "a2", mode: "fixed", amountCents: 200 },
      { goalId: "g2", accountId: "a1", mode: "entire", amountCents: null },
    ])
  ).toThrow(/UNIQUE/);
  // Atomic: g2 still has exactly its old slice, not the half-applied new set.
  expect(repo.listGoalAccountLinks().filter((l) => l.goalId === "g2")).toEqual([
    { goalId: "g2", accountId: "a2", mode: "fixed", amountCents: 100 },
  ]);
});

test("wishlist upsert + list + delete", () => {
  const repo = new NodeRepository(":memory:");
  repo.upsertWishlistItem(wish);
  expect(repo.listWishlistItems()).toHaveLength(1);
  repo.deleteWishlistItem("w1");
  expect(repo.listWishlistItems()).toHaveLength(0);
});
test("account balances upsert (idempotent) + get", () => {
  const repo = new NodeRepository(":memory:");
  // account must exist (FK); seed via upsertAccounts
  repo.upsertAccounts([{ id: "demo-checking", name: "Pinecrest Checking", type: "checking", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }]);
  repo.upsertAccountBalances([bal]);
  repo.upsertAccountBalances([{ ...bal, balanceCents: 4300000 }]);
  const rows = repo.getAccountBalances();
  expect(rows).toHaveLength(1);
  expect(rows[0].balanceCents).toBe(4300000);
});
