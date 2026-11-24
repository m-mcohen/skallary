import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";

test("setBudgetLine upserts on (plan,category,period); default + override coexist", () => {
  const repo = new NodeRepository(":memory:");
  repo.createPlan({ id: "2027-base", name: "2027", startDate: "2027-01-01", endDate: "2027-12-31" });
  repo.setBudgetLine({ planId: "2027-base", planningCategory: "Dining Out", period: null, amountCents: 70000 });
  repo.setBudgetLine({ planId: "2027-base", planningCategory: "Dining Out", period: "2027-06", amountCents: 120000 });
  repo.setBudgetLine({ planId: "2027-base", planningCategory: "Dining Out", period: null, amountCents: 65000 }); // overwrite default
  const lines = repo.getBudgetLines("2027-base");
  expect(lines).toHaveLength(2);
  expect(lines.find((l) => l.period === null)?.amountCents).toBe(65000);
  expect(lines.find((l) => l.period === "2027-06")?.amountCents).toBe(120000);
});
