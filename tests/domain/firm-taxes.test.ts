// tests/domain/firm-taxes.test.ts
//
// Giving is a tenth of pay into the bank (after tax and benefits); figures below worked by hand.
//
// Firm yearly figures for federal income tax and Social Security and Medicare apply to the
// CURRENT salary only; every other salary the app tries (Salary needed, a what-if's salary,
// a salary typed into Check a salary) keeps estimated taxes. A premium typed in Settings applies to
// every salary. A cleared figure returns to the estimate.
import { describe, expect, test } from "vitest";
import {
  DEFAULT_SALARY_ASSUMPTIONS,
  currentSalaryBreakdown,
  salaryForView,
  spendableAtSalary,
  w2Breakdown,
  type SalaryAssumptions,
} from "../../src/domain/salary";
import { cashForecast, monthIncome } from "../../src/domain/cash-forecast";
import { salaryVerdict, whatIfLadder, type WhatIf } from "../../src/domain/what-if";
import type { BudgetLine } from "../../src/domain/plan-types";

// Premium $500.00 a month, typed; giving a tenth; one child.
const BASE: SalaryAssumptions = { premiumMonthlyCents: 50_000, premiumFromSettings: true, maaserRate: 0.1, children: 1 };
const current = { kind: "gross" as const, grossAnnualCents: 9_600_000, fromPeriod: "2026-11" };
// Firm: federal $6,000.00 and Social Security and Medicare $6,000.00 a year.
const FIRM: SalaryAssumptions = { ...BASE, currentSalary: current, firmTaxes: { federalAnnualCents: 600_000, payrollAnnualCents: 600_000 } };

// $96,000 estimated by the app's tables: payroll 6,885.00 (7.65% of pay after the premium); federal 4,240.00; after tax 84,875.00.
// Firm: after tax 96,000 - 6,000 - 6,000 = 84,000.00; paycheck (84,000 - 6,000) / 12 = 6,500.00;
// giving on what lands in the bank (84,000 - 6,000) x 10% = 7,800.00 / 12 = 650.00.
describe("the current salary takes the firm figures", () => {
  test("the year, worked by hand", () => {
    const b = currentSalaryBreakdown(9_600_000, 0, FIRM);
    expect([b.federalAnnualCents, b.ficaAnnualCents, b.afterTaxAnnualCents]).toEqual([600_000, 600_000, 8_400_000]);
    expect([b.firmFederal, b.firmPayroll]).toEqual([true, true]);
    // 84,000 - 6,000 premium - 7,800 giving = 70,200.00
    expect(b.takeHomeAnnualCents).toBe(7_020_000);
  });

  test("with no firm figures, the current salary is estimated like any other", () => {
    const est = { ...FIRM, firmTaxes: null };
    expect(currentSalaryBreakdown(9_600_000, 0, est)).toEqual(w2Breakdown(9_600_000, 0, est));
  });

  test("the Forecast's income from the current salary uses them", () => {
    const m = cashForecast({ budgetLines: [], asOfDate: "2026-10-15", assumptions: FIRM });
    expect(m[0].incomeCents).toBe(650_000); // (8,400,000 - 600,000) / 12 = 650,000
  });

  test("Settings, Salary's bank line uses them too", () => {
    expect(monthIncome("2027-01", { main: current, other: null, mainIsReal: true }, FIRM)).toEqual({ bankCents: 650_000, maaserCents: 65_000 });
  });

  test("with an additional W-2 salary, the extra tax that salary adds stays estimated", () => {
    const joint: SalaryAssumptions = { ...FIRM, additionalSalary: { kind: "w2", grossAnnualCents: 6_000_000, fromPeriod: "2026-11" } };
    const est = w2Breakdown(9_600_000, 0, joint);
    const aloneEst = w2Breakdown(9_600_000, 0, { ...joint, additionalSalary: null });
    const b = currentSalaryBreakdown(9_600_000, 0, joint);
    // Firm $6,000.00 plus what the second salary adds to the joint estimate (within a cent:
    // the extra is worked before rounding).
    expect(Math.abs(b.federalAnnualCents - (600_000 + (est.federalAnnualCents - aloneEst.federalAnnualCents)))).toBeLessThanOrEqual(1);
    expect(Math.abs(b.ficaAnnualCents - (600_000 + (est.ficaAnnualCents - aloneEst.ficaAnnualCents)))).toBeLessThanOrEqual(1);
    expect(b.federalAnnualCents).toBeGreaterThan(600_000);
  });
});

describe("every other salary keeps estimated taxes", () => {
  test("Salary needed", () => {
    expect(salaryForView(600_000 * 12, 0, FIRM)).toEqual(salaryForView(600_000 * 12, 0, { ...FIRM, firmTaxes: null }));
  });

  test("a salary tried in Check a salary, unless it is the current salary", () => {
    expect(spendableAtSalary(9_600_000, 0, FIRM)).toEqual(spendableAtSalary(9_600_000, 0, { ...FIRM, firmTaxes: null }));
    // The current salary: paycheck 6,500.00 less giving 650.00 = 5,850.00
    expect(spendableAtSalary(9_600_000, 0, FIRM, undefined, { current: true }).spendableMonthlyCents).toBe(585_000);
  });

  test("a what-if's own salary in the Forecast; the current salary until it starts", () => {
    const w: WhatIf = { scenarioId: "w", salaryGrossAnnualCents: 9_600_000, salaryFromPeriod: "2027-01", changes: [], rows: [] };
    const m = cashForecast({ budgetLines: [], asOfDate: "2026-10-15", assumptions: FIRM, whatIf: w });
    expect(m.find((x) => x.period === "2026-12")!.incomeCents).toBe(650_000); // the current salary, firm
    // The what-if's $96,000, estimated: (84,875.00 - 6,000) / 12 = 6,572.92
    expect(m.find((x) => x.period === "2027-01")!.incomeCents).toBe(657_292);
  });

  test("the verdict on the current salary uses them; on a what-if's own salary it does not", () => {
    const lines: BudgetLine[] = [{ planId: "p", planningCategory: "Living", period: null, amountCents: 550_000 }];
    const keeps: WhatIf = { scenarioId: "w", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
    const ladder = whatIfLadder(keeps, lines, [], "2026-11", FIRM);
    // Firm: 5,850.00 - 5,500.00 = 350.00 left over a month. Estimated: giving (84,875.00 - 6,000) x 10% / 12
    // = 657.29; 6,572.92 - 657.29 - 5,500.00 = 415.63.
    expect(salaryVerdict(ladder, 9_600_000, FIRM, { whatIf: keeps, baseLines: lines, currentSalary: true }).leftOverMonthlyCents).toBe(35_000);
    expect(salaryVerdict(ladder, 9_600_000, FIRM, { whatIf: keeps, baseLines: lines }).leftOverMonthlyCents).toBe(41_563);
  });
});

describe("a premium typed in Settings applies to every salary", () => {
  test("Salary needed, a tried salary and the current salary all take it", () => {
    const typed = { ...BASE, premiumMonthlyCents: 45_000 };
    const estimate = { ...BASE, premiumMonthlyCents: DEFAULT_SALARY_ASSUMPTIONS.premiumMonthlyCents, premiumFromSettings: false };
    expect(salaryForView(600_000 * 12, 0, typed).premiumAnnualCents).toBe(540_000);
    expect(w2Breakdown(9_600_000, 0, typed).premiumAnnualCents).toBe(540_000);
    expect(currentSalaryBreakdown(9_600_000, 0, { ...typed, firmTaxes: { federalAnnualCents: 1, payrollAnnualCents: 1 } }).premiumAnnualCents).toBe(540_000);
    expect(salaryForView(600_000 * 12, 0, estimate).premiumAnnualCents).toBe(DEFAULT_SALARY_ASSUMPTIONS.premiumMonthlyCents * 12);
  });
});
