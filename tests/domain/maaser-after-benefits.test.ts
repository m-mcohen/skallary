// tests/domain/maaser-after-benefits.test.ts
// Maaser is a tenth of what lands in the bank: pay after federal income tax, Social Security
// and Medicare AND benefits, not a tenth taken before benefits come out. An additional monthly
// amount still carries no maaser.
import { describe, expect, test } from "vitest";
import { DEFAULT_SALARY_ASSUMPTIONS, currentSalaryBreakdown, monthlyPayCents, salaryForView, w2Breakdown, type SalaryAssumptions } from "../../src/domain/salary";
import { incomeStatement, statementCents } from "../../src/domain/income-statement";

const a: SalaryAssumptions = { ...DEFAULT_SALARY_ASSUMPTIONS, premiumMonthlyCents: 50_000, premiumFromSettings: true, maaserRate: 0.1, children: 1 };

describe("maaser is a tenth of what lands in the bank", () => {
  test("a year: a tenth of pay after tax, less benefits", () => {
    const b = w2Breakdown(15_000_000, 0, a);
    expect(b.charityAnnualCents).toBe(Math.round(0.1 * (b.afterTaxAnnualCents - b.premiumAnnualCents)));
  });

  test("a month: a tenth of the paycheck that lands in the bank", () => {
    const b = w2Breakdown(15_000_000, 0, a);
    const pay = monthlyPayCents(b, a);
    expect(pay.maaserCents).toBe(Math.round((0.1 * (b.afterTaxAnnualCents - b.premiumAnnualCents)) / 12));
    // Within a cent of a tenth of the deposit itself (each is rounded once).
    expect(Math.abs(pay.maaserCents - 0.1 * pay.paycheckCents)).toBeLessThanOrEqual(1);
  });

  test("the current salary with firm tax figures, the same rule", () => {
    const firm = { ...a, firmTaxes: { federalAnnualCents: 1_000_000, payrollAnnualCents: 1_000_000 } };
    const b = currentSalaryBreakdown(15_000_000, 0, firm);
    expect(b.charityAnnualCents).toBe(Math.round(0.1 * (15_000_000 - 2_000_000 - 50_000 * 12)));
  });

  test("an after-tax benefit also comes out before maaser: it never lands in the bank", () => {
    const after = { ...a, afterTaxBenefitsMonthlyCents: 10_000 };
    const b = w2Breakdown(15_000_000, 0, after);
    expect(b.charityAnnualCents).toBe(Math.round(0.1 * (b.afterTaxAnnualCents - b.premiumAnnualCents)));
  });

  test("an additional monthly amount still has no maaser worked on it", () => {
    const withOther = { ...a, additionalSalary: { kind: "monthly" as const, monthlyCents: 200_000, fromPeriod: "2026-11" } };
    expect(w2Breakdown(15_000_000, 0, withOther).charityAnnualCents).toBe(w2Breakdown(15_000_000, 0, a).charityAnnualCents);
  });

  test("the Charity line still wins when it is more", () => {
    expect(w2Breakdown(15_000_000, 2_000_000 * 12, a).charityAnnualCents).toBe(2_000_000 * 12);
  });

  test("the statement's Maaser line says so, and take-home is the deposit less it", () => {
    const b = w2Breakdown(15_000_000, 0, a);
    const s = incomeStatement({ breakdown: b, assumptions: a, charityLineMonthlyCents: 0, expenses: [] });
    expect(s.monthly.find((l) => l.id === "maaser")!.label).toBe("Charity (its share of pay into the bank)");
    const pay = monthlyPayCents(b, a);
    expect(statementCents(s.monthly, "maaser")).toBe(-pay.maaserCents);
    expect(statementCents(s.monthly, "take-home")).toBe(pay.paycheckCents - pay.maaserCents);
  });

  test("Salary needed covers the need under the new rule", () => {
    const need = 700_000 * 12;
    const b = salaryForView(need, 0, a);
    expect(b.takeHomeAnnualCents).toBeGreaterThanOrEqual(need - 100 * 12);
    expect(b.charityAnnualCents).toBe(Math.round(0.1 * (b.afterTaxAnnualCents - b.premiumAnnualCents)));
  });
});
