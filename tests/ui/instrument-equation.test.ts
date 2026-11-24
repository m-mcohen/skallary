// tests/ui/instrument-equation.test.ts
//
// The top bar's statement rides on the masthead summary:
// the same figures the domain functions give for the same inputs, and none without a budget year.
import { expect, test } from "vitest";
import { summariseForMasthead } from "../../src/ui/lib/instrument";
import { monthEquation, paySteps, payStepsEstimated, yearEquation, yearPaySteps, yearPayStepsEstimated } from "../../src/domain/equation";
import type { WhatIf } from "../../src/domain/what-if";
import type { Scenario } from "../../src/domain/scenario";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import type { BudgetLine } from "../../src/domain/plan-types";
import type { NormalizedTxn } from "../../src/domain/types";

const P = "plan-2027";
const lines: BudgetLine[] = [
  { planId: P, planningCategory: "Rent", period: null, amountCents: 200000, source: "you" },
  { planId: P, planningCategory: "Groceries", period: null, amountCents: 85000, source: "you" },
];
const prepared: NormalizedTxn[] = [
  { sourceTransactionId: "g1", accountId: "demo-checking", date: "2027-01-04", amountCents: -21000, sourceCategory: "Groceries", merchant: "Groceries", isTransfer: false, sourceUpdatedAt: null },
];
const accounts = [{ id: "demo-checking", name: "Pinecrest Checking", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }];
const salary = { ...DEFAULT_SALARY_ASSUMPTIONS, currentSalary: { kind: "gross" as const, grossAnnualCents: 12_000_000, fromPeriod: "2026-11" } };
const source = { prepared, mapping: { Rent: "Rent", Groceries: "Groceries" }, bigMonths: [], changes: [], plan: { startDate: "2027-01-01", endDate: "2027-12-31" } };
const base = {
  accounts, balances: [], categorySettings: [], uncategorizedCount: 0, ruleCount: 0, lastSyncedAt: null,
  asOfDate: "2027-01-13", budgetLines: lines, salaryAssumptions: salary,
};

test("the bar's month, year and pay steps are the domain's, on the same inputs", () => {
  const s = summariseForMasthead({ ...base, equationSource: source });
  const input = { prepared, accounts, mapping: source.mapping, lines, changes: [], bigMonths: [], salary };
  expect(s.equation!.month).toEqual(monthEquation(input, "2027-01", "2027-01-13"));
  expect(s.equation!.year).toEqual(yearEquation(input, source.plan, "2027-01-13"));
  expect(s.equation!.paySteps.monthly).toEqual(paySteps(input, "2027-01", "monthly"));
  expect(s.equation!.paySteps.yearly).toEqual(yearPaySteps(input, source.plan, "2027-01-13"));
  expect(s.equation!.paySteps.estimated).toEqual({ monthly: payStepsEstimated(input, ["2027-01"]), yearly: yearPayStepsEstimated(input, source.plan, "2027-01-13") });
  expect(s.equation!.paySteps.estimated).toEqual({ monthly: true, yearly: true });
  // Both firm figures typed in Settings, Salary: the note goes.
  const firm = summariseForMasthead({ ...base, salaryAssumptions: { ...salary, firmTaxes: { federalAnnualCents: 1_500_000, payrollAnnualCents: 900_000 } }, equationSource: source });
  expect(firm.equation!.paySteps.estimated).toEqual({ monthly: false, yearly: false });
});

test("no rows or budget year read: no statement", () => {
  expect(summariseForMasthead({ ...base }).equation).toBeNull();
  expect(summariseForMasthead({ ...base, equationSource: { ...source, plan: null } }).equation!.year).toBeNull();
});

// A what-if's switched-on change counts from this month in the bar.
test("a what-if's cost change moves this month's budget term and every coming month of the year", () => {
  const scenario: Scenario = { id: "w1", planId: P, name: "Cheaper rent", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "2027-01-01" };
  const whatIf = {
    scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null,
    changes: [{ id: "rent", position: 1, kind: "add", label: "Cheaper rent", planningCategory: "Rent", amountCents: -100000, fromPeriod: null, untilPeriod: null, loan: null }],
    rows: [{ kind: "change", refId: "rent", position: 1, on: true }],
  } as unknown as WhatIf;
  const real = summariseForMasthead({ ...base, equationSource: source }).equation!;
  const under = summariseForMasthead({ ...base, equationSource: source, scenario, whatIf }).equation!;
  expect(real.month.budgetCents - under.month.budgetCents).toBe(100000);
  expect(real.year!.budgetCents - under.year!.budgetCents).toBe(12 * 100000);
});
