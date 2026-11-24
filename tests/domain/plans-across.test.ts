import { expect, test } from "vitest";
import { linesAcrossPlans } from "../../src/domain/plans-across";
import { resolveMonthlyPlan } from "../../src/domain/budget";
import type { BudgetLine, Plan } from "../../src/domain/plan-types";

const plan = (y: number): Plan => ({ id: `plan-${y}`, name: `${y}`, startDate: `${y}-01-01`, endDate: `${y}-12-31`, createdAt: "" });
const line = (planId: string, cat: string, amountCents: number, period: string | null = null): BudgetLine => ({ planId, planningCategory: cat, period, amountCents });

test("one plan: the lines go through unchanged", () => {
  const lines = [line("plan-2026", "Groceries", 50000)];
  expect(linesAcrossPlans([plan(2026)], new Map([["plan-2026", lines]]), ["2026-11", "2027-01"])).toBe(lines);
});

test("each month reads its own year's plan; past the last plan, its amounts in force at its last month", () => {
  const byPlan = new Map([
    ["plan-2026", [line("plan-2026", "Groceries", 50000), line("plan-2026", "Gifts", 10000), line("plan-2026", "Gifts", 60000, "2026-12")]],
    ["plan-2027", [line("plan-2027", "Groceries", 55000)]],
  ]);
  const out = linesAcrossPlans([plan(2026), plan(2027)], byPlan, ["2026-12", "2027-01", "2028-02"]);
  expect(resolveMonthlyPlan(out, "Groceries", "2026-12")).toBe(50000);
  expect(resolveMonthlyPlan(out, "Gifts", "2026-12")).toBe(60000);
  expect(resolveMonthlyPlan(out, "Groceries", "2027-01")).toBe(55000);
  expect(resolveMonthlyPlan(out, "Gifts", "2027-01")).toBe(0);
  expect(resolveMonthlyPlan(out, "Groceries", "2028-02")).toBe(55000);
});
