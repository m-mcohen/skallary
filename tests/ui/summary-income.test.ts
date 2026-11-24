// tests/ui/summary-income.test.ts
// With an additional salary set,
// Salary needed in the top bar is the main salary given the other one; a what-if can
// carry its own additional salary (or None), which then decides it.
import { describe, expect, it } from "vitest";
import { summariseForMasthead } from "../../src/ui/lib/instrument";
import { salaryForView, DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import type { WhatIf } from "../../src/domain/what-if";
import type { Scenario } from "../../src/domain/scenario";

const A = DEFAULT_SALARY_ASSUMPTIONS;
const budgetLines = [
  { planId: "p", planningCategory: "Rent", period: null, amountCents: 600_000 },
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 50_000 },
];
const base = {
  accounts: [],
  balances: [],
  budgetLines,
  categorySettings: [],
  uncategorizedCount: 0,
  ruleCount: 0,
  lastSyncedAt: null,
  asOfDate: "2026-09-02",
};
const TWO_K = { kind: "monthly" as const, monthlyCents: 200_000, fromPeriod: "2026-09" };
const row: Scenario = { id: "w1", planId: "p", name: "Without it", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" };
const whatIf = (over: Partial<WhatIf>): WhatIf => ({ scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [], ...over });

describe("Salary needed given an additional salary", () => {
  it("Real numbers: $2,000 a month from the other salary covers $24,000 a year of the need", () => {
    const s = summariseForMasthead({ ...base, salaryAssumptions: { ...A, additionalSalary: TWO_K } });
    // The take-home must cover $6,000 x 12 - $24,000 = $48,000; the Charity line is priced on its own as before.
    expect(s.salary!.grossAnnualCents).toBe(salaryForView(600_000 * 12 - 2_400_000, 50_000 * 12, A).grossAnnualCents);
    expect(s.salary!.grossAnnualCents).toBeLessThan(summariseForMasthead(base).salary!.grossAnnualCents);
  });

  it("a what-if whose additional salary is None prices the main salary alone", () => {
    const s = summariseForMasthead({ ...base, salaryAssumptions: { ...A, additionalSalary: TWO_K }, scenario: row, whatIf: whatIf({ additionalSalary: "none" }) });
    expect(s.salary!.grossAnnualCents).toBe(summariseForMasthead(base).salary!.grossAnnualCents);
  });

  it("a what-if with no additional salary of its own uses the real one", () => {
    const s = summariseForMasthead({ ...base, salaryAssumptions: { ...A, additionalSalary: TWO_K }, scenario: row, whatIf: whatIf({}) });
    expect(s.salary!.grossAnnualCents).toBe(salaryForView(600_000 * 12 - 2_400_000, 50_000 * 12, A).grossAnnualCents);
  });
});
