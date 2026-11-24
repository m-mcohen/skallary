// tests/domain/what-if-salary-and-loan-checks.test.ts
// What if checks that were once wrong: Check a salary prices each step against the steps it
// accepted, down payments of same-named loans both count, a mortgage's tax and insurance
// outlast the loan, and loan problems read in plain words.
import { describe, expect, test } from "vitest";
import { checkSalary, composeWhatIf, loanProblem, whatIfLadder, type WhatIf, type WhatIfChange } from "../../src/domain/what-if";
import { spendableAtSalary } from "../../src/domain/salary";
import { applyScenarioToLines, type Scenario } from "../../src/domain/scenario";
import { resolveMonthlyPlan } from "../../src/domain/budget";
import type { BudgetLine } from "../../src/domain/plan-types";

const line = (planningCategory: string, amountCents: number): BudgetLine => ({ planId: "p", planningCategory, period: null, amountCents });
const change = (over: Partial<WhatIfChange>): WhatIfChange => ({
  id: "c", position: 1, kind: "add", label: "x", planningCategory: "Rent", amountCents: 0, fromPeriod: "2026-10", untilPeriod: null, loan: null, ...over,
});
const row: Scenario = { id: "w", planId: "p", name: "w", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" };
const empty: WhatIf = { scenarioId: "w", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
const plain = { premiumMonthlyCents: 0, maaserRate: 0, children: 0 };

describe("Check a salary prices each step against the steps it accepted, not the ones it refused", () => {
  test("rent $1,000, changed to $3,000 then to $2,000: a salary that covers neither covers neither", () => {
    const lines = [line("Rent", 100_000)];
    const w: WhatIf = { ...empty, changes: [
      change({ id: "to3000", position: 1, kind: "change", amountCents: 300_000 }),
      change({ id: "to2000", position: 2, kind: "change", amountCents: 200_000 }),
    ] };
    const ladder = whatIfLadder(w, lines, [], "2026-10", plain);
    const gross = 2_400_000;
    const room = spendableAtSalary(gross, 0, plain).spendableMonthlyCents; // about $1,847
    expect(room).toBeLessThan(200_000);
    const r = checkSalary(ladder, gross, plain, { whatIf: w, baseLines: lines });
    expect(r.items.map((i) => [i.id, i.covered])).toEqual([["to3000", false], ["to2000", false]]);
    expect(r.leftOverMonthlyCents).toBe(room - 100_000);
  });

  test("the same two changes with a salary that covers only the smaller one: the smaller one is covered, priced alone", () => {
    const lines = [line("Rent", 100_000)];
    const w: WhatIf = { ...empty, changes: [
      change({ id: "to3000", position: 1, kind: "change", amountCents: 300_000 }),
      change({ id: "to2000", position: 2, kind: "change", amountCents: 200_000 }),
    ] };
    const ladder = whatIfLadder(w, lines, [], "2026-10", plain);
    const gross = 3_600_000; // leaves between $2,000 and $3,000 a month
    const room = spendableAtSalary(gross, 0, plain).spendableMonthlyCents;
    expect(room).toBeGreaterThan(200_000);
    expect(room).toBeLessThan(300_000);
    const r = checkSalary(ladder, gross, plain, { whatIf: w, baseLines: lines });
    expect(r.items.map((i) => [i.id, i.covered])).toEqual([["to3000", false], ["to2000", true]]);
    expect(r.leftOverMonthlyCents).toBe(room - 200_000);
  });
});

describe("down payments", () => {
  test("two loans with the same name starting the same month both take their down payment out", () => {
    const loan = { priceCents: 3_000_000, downPaymentCents: 500_000, annualRate: 0.065, years: 5 };
    const w: WhatIf = { ...empty, changes: [
      change({ id: "car1", kind: "car", label: "New car", planningCategory: "Car payment", fromPeriod: "2027-03", untilPeriod: "2032-02", loan }),
      change({ id: "car2", position: 2, kind: "car", label: "New car", planningCategory: "Car payment", fromPeriod: "2027-03", untilPeriod: "2032-02", loan }),
    ] };
    const out = composeWhatIf(row, w, [], ["2027-03"], plain);
    const composed = applyScenarioToLines([line("Rent", 1)], out, ["2027-03"]);
    expect(resolveMonthlyPlan(composed, "Down payment: New car", "2027-03")).toBe(1_000_000);
  });
});

describe("a mortgage saved before tax and insurance outlasted the loan", () => {
  test("its stored end month (the payoff) no longer stops the tax and insurance", () => {
    const loan = { priceCents: 1_200_000, downPaymentCents: 0, annualRate: 0, years: 1, propertyTaxYearCents: 120_000, insuranceYearCents: 0 };
    // An older save stored the end month as the payoff month, 2027-09. The stored months are
    // no longer read: the loan starts with the what-if's costs (here Oct 2026), so
    // its one year of payments runs Oct 2026 to Sep 2027, and tax and insurance keep going.
    const w: WhatIf = { ...empty, changes: [change({ id: "m", kind: "mortgage", label: "House", planningCategory: "Mortgage", fromPeriod: "2026-10", untilPeriod: "2027-09", loan })] };
    const out = composeWhatIf(row, w, [], ["2027-09", "2027-10"], plain, [], "2026-10");
    const composed = applyScenarioToLines([line("Rent", 1)], out, ["2027-09", "2027-10"]);
    expect(resolveMonthlyPlan(composed, "Mortgage", "2027-09")).toBe(100_000 + 10_000);
    expect(resolveMonthlyPlan(composed, "Mortgage", "2027-10")).toBe(10_000);
  });
});

describe("loan checks", () => {
  test("property tax or insurance below zero is refused in plain words", () => {
    const base = { priceCents: 12_000_000, downPaymentCents: 0, annualRate: 0, years: 1 };
    expect(loanProblem({ ...base, propertyTaxYearCents: -120_000 })).toBe("Property tax and insurance cannot be below zero.");
    expect(loanProblem({ ...base, insuranceYearCents: -1 })).toBe("Property tax and insurance cannot be below zero.");
    expect(loanProblem({ ...base, propertyTaxYearCents: Number.NaN })).toBe("Property tax and insurance cannot be below zero.");
    expect(loanProblem({ ...base, propertyTaxYearCents: 0, insuranceYearCents: 0 })).toBeNull();
  });
});
