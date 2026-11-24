// tests/domain/equation-rollups.test.ts
//
// Minor 7 ("C"): yearEquation sums the rows once, not once per coming month. Made-up rows.
import { expect, test, vi } from "vitest";

vi.mock("../../src/domain/budget-month", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/domain/budget-month")>();
  return { ...real, sumRollups: vi.fn(real.sumRollups) };
});

import { sumRollups } from "../../src/domain/budget-month";
import { monthEquation, yearEquation } from "../../src/domain/equation";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import type { EquationInput } from "../../src/domain/equation";

const INPUT: EquationInput = {
  prepared: [
    { sourceTransactionId: "r1", accountId: "acct-a", date: "2027-01-02", amountCents: -21000, sourceCategory: "Groceries", merchant: "Groceries", isTransfer: false, sourceUpdatedAt: null },
    { sourceTransactionId: "r2", accountId: "acct-a", date: "2027-01-05", amountCents: -200000, sourceCategory: "Rent", merchant: "Rent", isTransfer: false, sourceUpdatedAt: null },
  ],
  accounts: [{ id: "acct-a", name: "Main Checking", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }],
  mapping: { Groceries: "Groceries", Rent: "Rent" },
  lines: [
    { planId: "p", planningCategory: "Groceries", period: null, amountCents: 85000, source: "you" },
    { planId: "p", planningCategory: "Rent", period: null, amountCents: 200000, source: "you" },
  ],
  changes: [],
  bigMonths: [],
  salary: { ...DEFAULT_SALARY_ASSUMPTIONS, currentSalary: { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" } },
};

const Y2027 = { startDate: "2027-01-01", endDate: "2027-12-31" };

test("a year of twelve coming months runs the row sums a fixed number of times, not once per month", () => {
  const spy = vi.mocked(sumRollups);
  spy.mockClear();
  yearEquation(INPUT, Y2027, "2027-01-13");
  // One sum of every row, one of the rows to date; none per month.
  expect(spy.mock.calls.length).toBe(2);
});

test("monthEquation on its own still works with its public signature", () => {
  expect(monthEquation(INPUT, "2027-01", "2027-01-13").spentSoFarCents).toBe(21000 + 200000);
});
