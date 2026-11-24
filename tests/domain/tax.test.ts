// tests/domain/tax.test.ts
//
// The federal tables by filing status, and other taxes withheld. Single and head of household are
// checked against Revenue Procedure 2025-32's own tax tables (section 4.01, Tables 2 and 3), whose
// "plus" amounts add up every lower bracket, so a wrong threshold anywhere below shows.
import { describe, expect, test } from "vitest";
import { TAX_2026_MFJ, childCreditCents, federalIncomeTaxCents, taxConstantsFor } from "../../src/domain/tax";
import { DEFAULT_SALARY_ASSUMPTIONS, currentSalaryBreakdown, w2Breakdown, type SalaryAssumptions } from "../../src/domain/salary";
import { salaryFigures, type PaycheckFigures } from "../../src/domain/paycheck";
import { demoCharityPot, demoSalary } from "../demo";

describe("federal tax by filing status", () => {
  test("each filing status taxes the same income by its own table", () => {
    expect(taxConstantsFor("mfj")).toEqual(TAX_2026_MFJ);
    // $60,000 taxable. Single: $5,800 + 22% of ($60,000 - $50,400) = $7,912.00.
    expect(federalIncomeTaxCents(6_000_000, taxConstantsFor("single"))).toBe(791_200);
    // Head of household: $1,770 + 12% of ($60,000 - $17,700) = $6,846.00.
    expect(federalIncomeTaxCents(6_000_000, taxConstantsFor("hoh"))).toBe(684_600);
    // $300,000 taxable, from the tables' own sums. Single: $58,448 + 35% of $43,775 = $73,769.25.
    expect(federalIncomeTaxCents(30_000_000, taxConstantsFor("single"))).toBe(7_376_925);
    // Head of household: $56,631 + 35% of $43,800 = $71,961.00.
    expect(federalIncomeTaxCents(30_000_000, taxConstantsFor("hoh"))).toBe(7_196_100);
    // $700,000 taxable. Single: $192,979.25 + 37% of $59,400 = $214,957.25; head of household $191,171 + $21,978.
    expect(federalIncomeTaxCents(70_000_000, taxConstantsFor("single"))).toBe(21_495_725);
    expect(federalIncomeTaxCents(70_000_000, taxConstantsFor("hoh"))).toBe(21_314_900);
  });

  test("the salary math taxes by the household's filing status and its standard deduction", () => {
    // $100,000, the demo's $4,080.00 benefits before tax, one child, filing single:
    // taxable $95,920 - $16,100 = $79,820; $5,800 + 22% of $29,420 = $12,272.40, less the $2,200 credit.
    const single: SalaryAssumptions = { ...demoSalary(), tax: { filingStatus: "single", children: 1 } };
    expect(w2Breakdown(10_000_000, 0, single).federalAnnualCents).toBe(1_007_240);
  });
});

describe("returns by filing status", () => {
  const plain = (filingStatus: "single" | "mfj" | "hoh", children: number): SalaryAssumptions => ({ ...DEFAULT_SALARY_ASSUMPTIONS, tax: { filingStatus, children }, children });

  test("not filing jointly, an additional W-2 salary is its own single return", () => {
    // Head of household, $80,000 and one child: taxable $55,850; $1,770 + 12% of $38,150 = $6,348.00, less $2,200 = $4,148.00.
    // The additional $50,000 on its own single return: taxable $33,900; $1,240 + 12% of $21,500 = $3,820.00.
    const hoh = { ...plain("hoh", 1), additionalSalary: { kind: "w2" as const, grossAnnualCents: 5_000_000, fromPeriod: "2026-01" } };
    const b = w2Breakdown(8_000_000, 0, hoh);
    expect(b.federalAnnualCents).toBe(796_800);
    expect(b.ficaAnnualCents).toBe(994_500); // 7.65% of each salary: $6,120.00 + $3,825.00
  });

  test("the child credit phases out by $50 per $1,000 or part over $200,000, or $400,000 filing jointly", () => {
    // Two children, $4,400. $210,500 is $10,500 over: 11 steps of $50 = $550 off, $3,850 left.
    expect(childCreditCents(taxConstantsFor("single"), 2, 21_050_000)).toBe(385_000);
    expect(childCreditCents(taxConstantsFor("hoh"), 2, 21_050_000)).toBe(385_000);
    expect(childCreditCents(taxConstantsFor("mfj"), 2, 21_050_000)).toBe(440_000);
    expect(childCreditCents(taxConstantsFor("mfj"), 2, 41_050_000)).toBe(385_000);
    // The salary math takes it: single, $210,500 of wages, two children against none.
    expect(w2Breakdown(21_050_000, 0, plain("single", 0)).federalAnnualCents - w2Breakdown(21_050_000, 0, plain("single", 2)).federalAnnualCents).toBe(385_000);
  });

  test("single: the 0.9% Additional Medicare starts at $200,000 of wages", () => {
    // $250,000: 7.65% of the $184,500 wage base, 1.45% of the $65,500 above it, 0.9% of the $50,000 over $200,000.
    expect(w2Breakdown(25_000_000, 0, plain("single", 0)).ficaAnnualCents).toBe(1_551_400);
  });
});

describe("other taxes withheld", () => {
  // Typed per paycheck, twice a month: the federal and payroll figures, then the same with $100.00
  // of state and local tax a paycheck as well, which comes to $2,400.00 a year.
  const typed = (paycheck: PaycheckFigures): SalaryAssumptions => {
    const a = { ...demoSalary(), pot: demoCharityPot() };
    const f = salaryFigures({ paySchedule: "twice-a-month", paycheck, olderPremiumMonthlyCents: null, olderFirmTaxes: null });
    return { ...a, paySchedule: "twice-a-month", paycheck, firmTaxes: f.firmTaxes };
  };
  const figures: PaycheckFigures = { federalCents: 40_000, payrollCents: 30_000, premiumCents: null };
  const gross = 9_600_000; // the demo's yearly base salary

  test("other taxes withheld lower take-home and the pot base by their yearly amount", () => {
    const without = currentSalaryBreakdown(gross, 0, typed(figures));
    const withOther = currentSalaryBreakdown(gross, 0, typed({ ...figures, otherTaxesCents: 10_000 }));
    expect(without.afterTaxAnnualCents - withOther.afterTaxAnnualCents).toBe(240_000);
    expect(withOther.otherTaxesAnnualCents).toBe(240_000);
    expect(without.otherTaxesAnnualCents).toBe(0);
    // The pot is 5% of pay into the bank, so it falls by 5% of $2,400.00.
    expect(without.charityAnnualCents - withOther.charityAnnualCents).toBe(12_000);
    // Typed on their own, with both federal figures left to the estimate, they still come out.
    const none: PaycheckFigures = { federalCents: null, payrollCents: null, premiumCents: null };
    const estimated = currentSalaryBreakdown(gross, 0, typed(none));
    expect(estimated.afterTaxAnnualCents - currentSalaryBreakdown(gross, 0, typed({ ...none, otherTaxesCents: 10_000 })).afterTaxAnnualCents).toBe(240_000);
  });
});
