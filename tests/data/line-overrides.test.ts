// tests/data/line-overrides.test.ts
// Repo-level CRUD for migrations/0017_scenario_line_overrides.sql, on the
// ":memory:" harness tests/data/scenarios.test.ts uses.
import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import type { LineOverride, Scenario } from "../../src/domain/scenario";

function repoWithScenario(): { repo: NodeRepository; scenario: Scenario } {
  const repo = new NodeRepository(":memory:");
  repo.createPlan({ id: "plan-1", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" });
  const scenario: Scenario = {
    id: "planned", planId: "plan-1", name: "Planned life", isDefault: false,
    income: { kind: "plan" }, expenseDeltas: [], createdAt: "2026-09-14T00:00:00.000Z",
    lineOverrides: [
      { planningCategory: "Rent", amountCents: 450_000, cut: false, note: "new place", baseAmountCents: 250_000, updatedAt: "2026-09-14T00:00:00.000Z" },
      { planningCategory: "Coffee Shops", amountCents: null, cut: true, note: "", baseAmountCents: 3_000, updatedAt: "2026-09-14T00:00:00.000Z" },
    ],
  };
  repo.upsertScenario(scenario);
  return { repo, scenario };
}

test("upsertScenario stores overrides and getScenario/listScenarios return them", () => {
  const { repo, scenario } = repoWithScenario();
  const sorted = [...scenario.lineOverrides!].sort((a, b) => a.planningCategory.localeCompare(b.planningCategory));
  expect(repo.getScenario("planned")?.lineOverrides).toEqual(sorted);
  expect(repo.listScenarios("plan-1")[0].lineOverrides).toEqual(sorted);
});

test("a scenario saved without lineOverrides reads back with an empty array", () => {
  const repo = new NodeRepository(":memory:");
  repo.createPlan({ id: "plan-1", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" });
  repo.upsertScenario({ id: "s", planId: "plan-1", name: "S", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" });
  expect(repo.getScenario("s")?.lineOverrides).toEqual([]);
});

test("upsertScenario swaps the whole override set and drops empty rows", () => {
  const { repo, scenario } = repoWithScenario();
  const next: LineOverride[] = [
    { planningCategory: "Groceries", amountCents: 80_000, cut: false, note: "", baseAmountCents: 90_000, updatedAt: "2026-09-15T00:00:00.000Z" },
    { planningCategory: "Gifts", amountCents: null, cut: false, note: "", baseAmountCents: 20_000, updatedAt: "2026-09-15T00:00:00.000Z" }, // empty: no amount, no cut, no note
  ];
  repo.upsertScenario({ ...scenario, lineOverrides: next });
  expect(repo.getScenario("planned")?.lineOverrides.map((o) => o.planningCategory)).toEqual(["Groceries"]);
});

test("deleteScenario removes all its line overrides", () => {
  const { repo } = repoWithScenario();
  expect(repo.getScenario("planned")?.lineOverrides).toHaveLength(2);
  repo.deleteScenario("planned");
  expect((repo as any).db.prepare("select count(*) c from scenario_line_overrides").get().c).toBe(0);
});

// The database's cascade also removes them, which kept the test above green
// with deleteScenario's own delete taken out. With foreign keys off, only that delete can.
test("deleteScenario removes its line overrides itself, not only through the cascade", () => {
  const { repo } = repoWithScenario();
  const db = (repo as any).db;
  db.pragma("foreign_keys = OFF");
  repo.deleteScenario("planned");
  expect(db.prepare("select count(*) c from scenario_line_overrides").get().c).toBe(0);
});
