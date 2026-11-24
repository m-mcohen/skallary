import { expect, test } from "vitest";
import { resolveMonthlyPlan, plannedCategories } from "../../src/domain/budget";
import type { BudgetLine } from "../../src/domain/plan-types";

const lines: BudgetLine[] = [
  { planId: "p", planningCategory: "Dining Out", period: null, amountCents: 70000 },
  { planId: "p", planningCategory: "Dining Out", period: "2027-06", amountCents: 120000 },
  { planId: "p", planningCategory: "Travel", period: null, amountCents: 60000 },
];
test("override wins over default for its month", () => {
  expect(resolveMonthlyPlan(lines, "Dining Out", "2027-06")).toBe(120000);
  expect(resolveMonthlyPlan(lines, "Dining Out", "2027-05")).toBe(70000);
});
test("missing category resolves to 0", () => {
  expect(resolveMonthlyPlan(lines, "Shopping", "2027-01")).toBe(0);
});
test("plannedCategories lists distinct", () => {
  expect(plannedCategories(lines).sort()).toEqual(["Dining Out", "Travel"]);
});
