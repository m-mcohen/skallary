import { expect, test } from "vitest";
import { currentPlan, nextYearOf, planForMonth } from "../../src/domain/plan-choice";
import type { Plan } from "../../src/domain/plan-types";

const plan = (y: number): Plan => ({ id: `plan-${y}`, name: `${y}`, startDate: `${y}-01-01`, endDate: `${y}-12-31`, createdAt: "" });

test("the plan whose year holds the month, else the latest earlier one", () => {
  const plans = [plan(2027), plan(2026)];
  expect(planForMonth(plans, "2026-12")?.id).toBe("plan-2026");
  expect(planForMonth(plans, "2027-01")?.id).toBe("plan-2027");
  expect(planForMonth(plans, "2028-03")?.id).toBe("plan-2027");
  expect(planForMonth(plans, "2025-06")).toBeNull();
});

test("the app-wide budget follows today, not the lowest id", () => {
  expect(currentPlan([plan(2026), plan(2027)], "2027-01-01")?.id).toBe("plan-2027");
  expect(currentPlan([plan(2026), plan(2027)], "2026-12-31")?.id).toBe("plan-2026");
  expect(currentPlan([plan(2026)], "2025-06-01")?.id).toBe("plan-2026");
  expect(currentPlan([], "2026-06-01")).toBeNull();
});

test("Start next year's budget shows from December 1 until that plan exists", () => {
  expect(nextYearOf([plan(2026)], "2026-11-30")).toBeNull();
  expect(nextYearOf([plan(2026)], "2026-12-01")).toBe("2027");
  expect(nextYearOf([plan(2026), plan(2027)], "2026-12-15")).toBeNull();
});

// Missing December must not strand the Budget in a year that is over.
test("in January with no budget for the new year, it is offered at once", () => {
  expect(nextYearOf([plan(2026)], "2027-01-05")).toBe("2027");
  expect(nextYearOf([plan(2026)], "2027-06-30")).toBe("2027");
  expect(nextYearOf([plan(2026), plan(2027)], "2027-01-05")).toBeNull();
});
