import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";

test("setBudgetLine writes a change_log entry (old→new)", () => {
  const repo = new NodeRepository(":memory:");
  repo.createPlan({ id: "p", name: "p", startDate: "2027-01-01", endDate: "2027-12-31" });
  repo.setBudgetLine({ planId: "p", planningCategory: "Dining Out", period: null, amountCents: 70000 });
  repo.setBudgetLine({ planId: "p", planningCategory: "Dining Out", period: null, amountCents: 65000 });
  const log = repo.getChangeLog("p:Dining Out:");
  expect(log.length).toBe(2);
  expect(log[1]).toMatchObject({ field: "amount_cents", oldValue: "70000", newValue: "65000", actor: "USER" });
});
