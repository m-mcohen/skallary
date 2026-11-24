// tests/domain/what-if-normal-month.test.ts
//
// One sum for "your budget before a what-if": the What if card and the top bar both start from it, so the two cannot drift apart if an
// income line ever lands on the budget. Default lines only; income left out.
import { expect, test } from "vitest";
import { normalMonthCents } from "../../src/domain/what-if";
import type { BudgetLine } from "../../src/domain/plan-types";

test("sums the every-month lines, leaving out income and one-month overrides", () => {
  const lines: BudgetLine[] = [
    { planId: "p", planningCategory: "Rent", period: null, amountCents: 210_000 },
    { planId: "p", planningCategory: "Groceries", period: "", amountCents: 65_000 },
    { planId: "p", planningCategory: "Groceries", period: "2026-11", amountCents: 99_999 },
    { planId: "p", planningCategory: "Paychecks", period: null, amountCents: 50_000 },
    { planId: "p", planningCategory: "Other Income", period: null, amountCents: 1_000 },
  ];
  expect(normalMonthCents(lines, "2026-11")).toBe(210_000 + 65_000);
});
