import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/data/migrate.node";
import { NodeRepository } from "../../src/data/repo.node";
import type { Scenario } from "../../src/domain/scenario";

function seedPlan(repo: NodeRepository, id = "2027-base"): void {
  repo.createPlan({ id, name: "2027 Base", startDate: "2027-01-01", endDate: "2027-12-31" });
}

test("upsertScenario + getScenario round-trip a schedule income model with steps + expense deltas", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo);

  const scenario: Scenario = {
    id: "s-schedule-1",
    planId: "2027-base",
    name: "Toy scenario",
    isDefault: false,
    income: {
      kind: "schedule",
      steps: [
        { fromPeriod: "2027-03", netMonthlyCents: 400_000 },
        { fromPeriod: "2027-01", netMonthlyCents: 0 },
        { fromPeriod: "2027-06", netMonthlyCents: 100_000 },
      ],
    },
    expenseDeltas: [
      { planningCategory: "Groceries", period: null, deltaCents: -20_000 },
      { planningCategory: "Shopping", period: "2027-04", deltaCents: -49_300 },
    ],
    createdAt: "2027-01-01T00:00:00.000Z",
  };

  repo.upsertScenario(scenario);
  const got = repo.getScenario("s-schedule-1");
  expect(got).not.toBeNull();
  expect(got!.id).toBe("s-schedule-1");
  expect(got!.planId).toBe("2027-base");
  expect(got!.name).toBe(scenario.name);
  expect(got!.isDefault).toBe(false);
  expect(got!.income.kind).toBe("schedule");
  if (got!.income.kind === "schedule") {
    // steps must round-trip ordered by from_period, regardless of insert order
    expect(got!.income.steps).toEqual([
      { fromPeriod: "2027-01", netMonthlyCents: 0 },
      { fromPeriod: "2027-03", netMonthlyCents: 400_000 },
      { fromPeriod: "2027-06", netMonthlyCents: 100_000 },
    ]);
  }
  expect(got!.expenseDeltas).toEqual(
    expect.arrayContaining([
      { planningCategory: "Groceries", period: null, deltaCents: -20_000 },
      { planningCategory: "Shopping", period: "2027-04", deltaCents: -49_300 },
    ])
  );
  expect(got!.expenseDeltas).toHaveLength(2);
});

test("upsertScenario is idempotent: re-upserting the same id replaces its row, steps, and deltas (not accumulate)", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo);

  const v1: Scenario = {
    id: "s-replace-1",
    planId: "2027-base",
    name: "v1",
    isDefault: false,
    income: { kind: "schedule", steps: [{ fromPeriod: "2027-01", netMonthlyCents: 100_000 }] },
    expenseDeltas: [{ planningCategory: "Groceries", period: null, deltaCents: -1000 }],
    createdAt: "2027-01-01T00:00:00.000Z",
  };
  repo.upsertScenario(v1);

  const v2: Scenario = {
    ...v1,
    name: "v2",
    income: { kind: "custom", netMonthlyCents: 500_000, startPeriod: "2027-03" },
    expenseDeltas: [],
  };
  repo.upsertScenario(v2);

  const got = repo.getScenario("s-replace-1");
  expect(got!.name).toBe("v2");
  expect(got!.income).toEqual({ kind: "custom", netMonthlyCents: 500_000, startPeriod: "2027-03" });
  expect(got!.expenseDeltas).toEqual([]);
});

test("listScenarios returns all scenarios for a plan, not other plans'", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo, "plan-a");
  seedPlan(repo, "plan-b");

  repo.upsertScenario({
    id: "sa-1", planId: "plan-a", name: "A1", isDefault: false,
    income: { kind: "plan" }, expenseDeltas: [], createdAt: "2027-01-01T00:00:00.000Z",
  });
  repo.upsertScenario({
    id: "sa-2", planId: "plan-a", name: "A2", isDefault: false,
    income: { kind: "custom", netMonthlyCents: 10000, startPeriod: "2027-01" }, expenseDeltas: [],
    createdAt: "2027-01-01T00:00:00.000Z",
  });
  repo.upsertScenario({
    id: "sb-1", planId: "plan-b", name: "B1", isDefault: false,
    income: { kind: "plan" }, expenseDeltas: [], createdAt: "2027-01-01T00:00:00.000Z",
  });

  const planA = repo.listScenarios("plan-a");
  expect(planA.map((s) => s.id).sort()).toEqual(["sa-1", "sa-2"]);
  const planB = repo.listScenarios("plan-b");
  expect(planB.map((s) => s.id)).toEqual(["sb-1"]);
});

test("deleteScenario removes the scenario and its steps + deltas", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo);

  repo.upsertScenario({
    id: "s-del-1",
    planId: "2027-base",
    name: "to delete",
    isDefault: false,
    income: { kind: "schedule", steps: [{ fromPeriod: "2027-01", netMonthlyCents: 100_000 }] },
    expenseDeltas: [{ planningCategory: "Groceries", period: null, deltaCents: -1000 }],
    createdAt: "2027-01-01T00:00:00.000Z",
  });
  expect(repo.getScenario("s-del-1")).not.toBeNull();

  repo.deleteScenario("s-del-1");
  expect(repo.getScenario("s-del-1")).toBeNull();

  // Verify the child rows are actually gone, not just orphaned (the app
  // never enables PRAGMA foreign_keys, so ON DELETE CASCADE is inert for
  // in-process deletes -- deleteScenario must remove children explicitly).
  const db = (repo as unknown as { db: Database.Database }).db;
  const steps = db.prepare("SELECT * FROM scenario_income_steps WHERE scenario_id=?").all("s-del-1");
  const deltas = db.prepare("SELECT * FROM scenario_expense_deltas WHERE scenario_id=?").all("s-del-1");
  expect(steps).toHaveLength(0);
  expect(deltas).toHaveLength(0);
});

// Schema-level FK cascade check: the app's shared NodeRepository connection
// never enables PRAGMA foreign_keys (verified: no call anywhere in the repo
// layer), so ON DELETE CASCADE is inert for in-process NodeRepository
// deletes. This test opens a raw connection with foreign_keys explicitly ON
// to confirm the migration SQL itself is written correctly (deleting a plan
// cascades to its scenarios, which cascades to their steps/deltas) -- the
// behavior a future Postgres-backed FinanceRepository (real FK enforcement)
// or an app-level `PRAGMA foreign_keys = ON` would actually exercise.
test("schema FK cascade: deleting a plan cascades to its scenarios, steps, and deltas (foreign_keys=ON)", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  db.prepare("INSERT INTO plans (id, name, start_date, end_date, created_at) VALUES (?,?,?,?,?)")
    .run("p1", "P1", "2027-01-01", "2027-12-31", "2027-01-01T00:00:00.000Z");
  db.prepare(`INSERT INTO scenarios (id, plan_id, name, is_default, income_kind, created_at)
    VALUES (?,?,?,?,?,?)`).run("s1", "p1", "S1", 0, "schedule", "2027-01-01T00:00:00.000Z");
  db.prepare(`INSERT INTO scenario_income_steps (scenario_id, from_period, net_monthly_cents) VALUES (?,?,?)`)
    .run("s1", "2027-01", 100000);
  db.prepare(`INSERT INTO scenario_expense_deltas (scenario_id, planning_category, period, delta_cents) VALUES (?,?,?,?)`)
    .run("s1", "Groceries", null, -1000);

  db.prepare("DELETE FROM plans WHERE id=?").run("p1");

  expect(db.prepare("SELECT * FROM scenarios WHERE id=?").get("s1")).toBeUndefined();
  expect(db.prepare("SELECT * FROM scenario_income_steps WHERE scenario_id=?").all("s1")).toHaveLength(0);
  expect(db.prepare("SELECT * FROM scenario_expense_deltas WHERE scenario_id=?").all("s1")).toHaveLength(0);
});

test("an open-ended delta keeps its fromPeriod across a save, and a plain one gains no key", () => {
  const repo = new NodeRepository(":memory:");
  seedPlan(repo);
  const scenario: Scenario = {
    id: "s-live-1",
    planId: "2027-base",
    name: "Maintain from Mar 2027",
    isDefault: false,
    income: { kind: "custom", netMonthlyCents: 995_000, startPeriod: "2027-03" },
    expenseDeltas: [
      { planningCategory: "Charity", period: null, deltaCents: 10_000, fromPeriod: "2027-03" },
      { planningCategory: "Groceries", period: null, deltaCents: -20_000 },
    ],
    createdAt: "2027-01-01T00:00:00.000Z",
  };
  repo.upsertScenario(scenario);
  const got = repo.getScenario("s-live-1")!;
  expect(got.expenseDeltas).toEqual(scenario.expenseDeltas);
  // The plain delta must come back WITHOUT a fromPeriod key at all.
  expect("fromPeriod" in got.expenseDeltas[1]).toBe(false);
  expect(repo.listScenarios("2027-base")[0].expenseDeltas).toEqual(scenario.expenseDeltas);
});
