import { expect, test } from "vitest";
import { budgetLabel } from "../../src/domain/budget-label";

test("a budget is named by its year, never by its internal code", () => {
  expect(budgetLabel({ startDate: "2026-01-01" })).toBe("Budget: 2026");
  expect(budgetLabel({ startDate: "2027-07-01" })).toBe("Budget: 2027");
});
