import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import type { WhatIf } from "../../src/domain/what-if";

function fresh(): NodeRepository {
  const repo = new NodeRepository(":memory:");
  repo.createPlan({ id: "p", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" });
  repo.createWhatIf("p", "w1", "Toy scenario", "2026-10-15");
  return repo;
}
const base: WhatIf = { scenarioId: "w1", salaryGrossAnnualCents: 1_000_000, salaryFromPeriod: null, changes: [], rows: [] };

test("a what-if saved without an additional salary reads back without one (Same as Settings)", () => {
  const repo = fresh();
  repo.saveWhatIf(base);
  const back = repo.getWhatIf("w1")!;
  expect(back.additionalSalary ?? null).toBeNull();
  expect(back.salaryFromPeriod).toBeNull();
  expect(back.salaryGrossAnnualCents).toBe(1_000_000);
});

test("a W-2 and a monthly additional salary, and None, round-trip", () => {
  const repo = fresh();
  repo.saveWhatIf({ ...base, additionalSalary: { kind: "w2", grossAnnualCents: 2_000_000, fromPeriod: "2027-01" } });
  expect(repo.getWhatIf("w1")!.additionalSalary).toEqual({ kind: "w2", grossAnnualCents: 2_000_000, fromPeriod: "2027-01" });
  repo.saveWhatIf({ ...base, additionalSalary: { kind: "monthly", monthlyCents: 10_000, fromPeriod: "2026-12" } });
  expect(repo.getWhatIf("w1")!.additionalSalary).toEqual({ kind: "monthly", monthlyCents: 10_000, fromPeriod: "2026-12" });
  repo.saveWhatIf({ ...base, additionalSalary: "none" });
  expect(repo.listWhatIfs("p")[0].additionalSalary).toBe("none");
  repo.saveWhatIf({ ...base, additionalSalary: null });
  expect(repo.getWhatIf("w1")!.additionalSalary ?? null).toBeNull();
});
