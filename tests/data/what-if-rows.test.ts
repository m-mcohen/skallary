import { describe, expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import type { WhatIf } from "../../src/domain/what-if";

describe("the repository reads and writes the rows", () => {
  function fresh(): NodeRepository {
    const repo = new NodeRepository(":memory:");
    repo.createPlan({ id: "p", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" });
    repo.upsertScenario({ id: "w1", planId: "p", name: "Toy scenario", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" });
    return repo;
  }
  const sample: WhatIf = {
    scenarioId: "w1",
    salaryGrossAnnualCents: 1_000_000,
    salaryFromPeriod: null,
    changes: [{ id: "c1", position: 1, kind: "add", label: "Toy blocks", planningCategory: "Toy blocks", amountCents: 10_000, fromPeriod: "2026-11", untilPeriod: null, loan: null }],
    rows: [
      { kind: "goal-saving", refId: "g-house", position: 1, on: true },
      { kind: "change", refId: "c1", position: 2, on: false },
      { kind: "goal-cost", refId: "g-house", position: 3, on: true },
    ],
  };

  test("rows round-trip in their saved order, with each one's switch", () => {
    const repo = fresh();
    repo.saveWhatIf(sample);
    expect(repo.getWhatIf("w1")!.rows).toEqual(sample.rows);
  });

  test("saving again replaces the rows; deleting the what-if removes them", () => {
    const repo = fresh();
    repo.saveWhatIf(sample);
    repo.saveWhatIf({ ...sample, rows: [sample.rows[1]] });
    expect(repo.getWhatIf("w1")!.rows).toEqual([sample.rows[1]]);
    repo.deleteScenario("w1");
    expect(repo.getWhatIf("w1")).toBeNull();
  });

  test("a new what-if starts with no rows: every goal shows switched off", () => {
    const repo = fresh();
    expect(repo.createWhatIf("p", "w2", "New", "").rows).toEqual([]);
  });
});
