// tests/data/what-if.test.ts
// Repo-level round trip for the what-if tables, on the same ":memory:" NodeRepository harness tests/data/scenarios.test.ts uses.
import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import type { WhatIf } from "../../src/domain/what-if";

function fresh(): NodeRepository {
  const repo = new NodeRepository(":memory:");
  repo.createPlan({ id: "p", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" });
  repo.upsertScenario({ id: "w1", planId: "p", name: "Offer base", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "2026-09-23" });
  return repo;
}

const sample: WhatIf = {
  scenarioId: "w1",
  salaryGrossAnnualCents: 12_000_000,
  salaryFromPeriod: "2026-11",
  changes: [
    { id: "c2", position: 2, kind: "cut", label: "Takeout", planningCategory: "Restaurants & Bars", amountCents: 15_000, fromPeriod: "2026-10", untilPeriod: null, loan: null },
    {
      id: "c1", position: 1, kind: "car", label: "New car", planningCategory: "Car payment", amountCents: 60_000, fromPeriod: "2027-03", untilPeriod: "2032-02",
      loan: { priceCents: 3_000_000, downPaymentCents: 500_000, annualRate: 0.065, years: 5 },
    },
    {
      id: "c3", position: 3, kind: "mortgage", label: "House", planningCategory: "Mortgage", amountCents: 250_000, fromPeriod: "2028-01", untilPeriod: null,
      loan: { priceCents: 40_000_000, downPaymentCents: 8_000_000, annualRate: 0.065, years: 30, propertyTaxYearCents: 600_000, insuranceYearCents: 240_000 },
    },
  ],
  // The one list, each row switched on or off.
  rows: [
    { kind: "goal-saving", refId: "g-trip", position: 2, on: false },
    { kind: "goal-saving", refId: "g-house", position: 1, on: true },
  ],
};

test("a what-if round-trips: salary, ordered changes with loans, and its rows", () => {
  const repo = fresh();
  repo.saveWhatIf(sample);
  const back = repo.getWhatIf("w1")!;
  expect(back.salaryGrossAnnualCents).toBe(12_000_000);
  expect(back.salaryFromPeriod).toBe("2026-11");
  expect(back.changes.map((c) => c.id)).toEqual(["c1", "c2", "c3"]); // read back in position order
  expect(back.changes[0]).toEqual(sample.changes[1]);
  expect(back.changes[1]).toEqual(sample.changes[0]);
  expect(back.changes[2]).toEqual(sample.changes[2]);
  expect(back.rows).toEqual([
    { kind: "goal-saving", refId: "g-house", position: 1, on: true },
    { kind: "goal-saving", refId: "g-trip", position: 2, on: false },
  ]);
});

test("a scenario with no what-if reads back null; listWhatIfs returns only this plan's what-ifs", () => {
  const repo = fresh();
  expect(repo.getWhatIf("w1")).toBeNull();
  repo.createPlan({ id: "q", name: "Other", startDate: "2026-01-01", endDate: "2026-12-31" });
  repo.upsertScenario({ id: "w9", planId: "q", name: "Elsewhere", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" });
  repo.saveWhatIf({ ...sample, scenarioId: "w9", changes: [], rows: [] });
  repo.saveWhatIf(sample);
  expect(repo.listWhatIfs("p").map((w) => w.scenarioId)).toEqual(["w1"]);
  expect(repo.listWhatIfs("p")[0].changes).toHaveLength(3);
});

test("no income is stored as null, not zero", () => {
  const repo = fresh();
  repo.saveWhatIf({ ...sample, salaryGrossAnnualCents: null, salaryFromPeriod: null });
  const back = repo.getWhatIf("w1")!;
  expect(back.salaryGrossAnnualCents).toBeNull();
  expect(back.salaryFromPeriod).toBeNull();
});

test("saving again replaces, never appends; deleting the scenario removes the what-if", () => {
  const repo = fresh();
  repo.saveWhatIf(sample);
  repo.saveWhatIf({ ...sample, changes: [sample.changes[0]], rows: [] });
  const back = repo.getWhatIf("w1")!;
  expect(back.changes.map((c) => c.id)).toEqual(["c2"]);
  expect(back.rows).toEqual([]);
  repo.deleteScenario("w1");
  expect(repo.getWhatIf("w1")).toBeNull();
  expect(repo.listWhatIfs("p")).toEqual([]);
});

// Creating a what-if used to be two requests (a scenario
// row, then its what-if); a failure between them left an empty scenarios row
// no screen showed. createWhatIf writes both together, in one transaction.
test("createWhatIf writes the scenario row and its empty what-if together", () => {
  const repo = fresh();
  const created = repo.createWhatIf("p", "w2", "Job offer", "2026-09-24");
  expect(created).toEqual({ scenarioId: "w2", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] });
  expect(repo.getScenario("w2")).toMatchObject({ id: "w2", planId: "p", name: "Job offer", isDefault: false, income: { kind: "plan" }, expenseDeltas: [] });
  expect(repo.getWhatIf("w2")).toEqual(created);
  expect(repo.listWhatIfs("p").map((w) => w.scenarioId).sort()).toEqual(["w2"]);
});

test("createWhatIf is one transaction: a failure leaves neither row behind, and the id it collided with is untouched", () => {
  const repo = fresh();
  // "w1" already exists (a plain scenario with no what-if, from fresh()) --
  // colliding with it must fail the whole write, not half of it.
  expect(() => repo.createWhatIf("p", "w1", "New name", "2026-09-24")).toThrow();
  expect(repo.getScenario("w1")).toMatchObject({ name: "Offer base" }); // untouched, not renamed
  expect(repo.getWhatIf("w1")).toBeNull(); // no what-if leaked in from the failed attempt
});
