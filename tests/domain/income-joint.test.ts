// tests/domain/income-joint.test.ts
//
// The charity share is a tenth of pay into the bank (after tax and benefits); figures below are worked by hand.
//
// An additional salary is either a W-2 salary taxed jointly with the current one (federal tax on the
// combined wages, Social Security and Medicare per earner, one premium, the charity share
// on the combined after-tax amount less the premium) or a plain monthly amount with no tax math.
// Salary needed then means the current salary given the other one.
//
// Every expected figure below is worked by hand from the 2026 MFJ constants in
// src/domain/tiers.ts (standard deduction $32,200; brackets 10% to $24,800,
// 12% to $100,800, 22% to $211,400; child credit $2,200; Social Security wage
// base $184,500; additional Medicare 0.9% over $250,000 combined), never read
// back from the code.
import { describe, expect, test } from "vitest";
import { salaryForView, spendableAtSalary, w2Breakdown, type SalaryAssumptions } from "../../src/domain/salary";
import { incomeProblem } from "../../src/domain/income";

// Premium $500 a month ($6,000 a year), charity share 10%, one child.
const A: SalaryAssumptions = { premiumMonthlyCents: 50_000, maaserRate: 0.1, children: 1 };
const dollars = (c: number) => c / 100;

describe("a W-2 additional salary is taxed jointly with the current one", () => {
  test("a $100,000 salary and a $50,000 additional one: federal on the combined wages, payroll per earner, one premium", () => {
    // Wages after the pre-tax premium: 100,000 - 6,000 = 94,000. The additional salary: 50,000.
    // Social Security and Medicare: 7.65% x 94,000 = 7,191; 7.65% x 50,000 = 3,825; total 11,016.
    // Federal: taxable 94,000 + 50,000 - 32,200 = 111,800.
    //   10% x 24,800 = 2,480; 12% x 76,000 = 9,120; 22% x 11,000 = 2,420; 14,020, less the child credit 2,200 = 11,820.
    // After tax: 150,000 - 11,016 - 11,820 = 127,164. Into the bank 127,164 - 6,000 = 121,164; charity share 10% = 12,116.40.
    // Take-home: 127,164 - 6,000 premium - 12,116.40 charity share = 109,047.60.
    const b = w2Breakdown(10_000_000, 0, { ...A, additionalSalary: { kind: "w2", grossAnnualCents: 5_000_000, fromPeriod: "2026-01" } });
    expect(dollars(b.ficaAnnualCents)).toBe(11_016);
    expect(dollars(b.federalAnnualCents)).toBe(11_820);
    expect(dollars(b.afterTaxAnnualCents)).toBe(127_164);
    expect(dollars(b.premiumAnnualCents)).toBe(6_000);
    expect(dollars(b.charityAnnualCents)).toBe(12_116.4);
    expect(dollars(b.takeHomeAnnualCents)).toBe(109_047.6);
    expect(dollars(b.otherGrossAnnualCents)).toBe(50_000);
  });

  test("the Social Security wage base applies to each earner on their own; additional Medicare on the combined wages", () => {
    // No premium. The 200,000 salary: 7.65% x 184,500 = 14,114.25, plus 1.45% x 15,500 = 224.75; 14,339.
    // The 120,000 salary: 7.65% x 120,000 = 9,180.
    // Additional Medicare: (320,000 - 250,000) x 0.9% = 630.
    // Total 14,339 + 9,180 + 630 = 24,149. (One wage base on the combined wages would give 16,709.)
    const b = w2Breakdown(20_000_000, 0, { ...A, premiumMonthlyCents: 0, additionalSalary: { kind: "w2", grossAnnualCents: 12_000_000, fromPeriod: "2026-01" } });
    expect(dollars(b.ficaAnnualCents)).toBe(24_149);
  });

  test("Salary needed given the $50,000 additional salary is the salary whose household take-home meets the need", () => {
    // From the first test, $100,000 with the $50,000 additional salary leaves 109,047.60 a year, so a need
    // of exactly that solves to $100,000.
    const r = salaryForView(10_904_760, 0, { ...A, additionalSalary: { kind: "w2", grossAnnualCents: 5_000_000, fromPeriod: "2026-01" } });
    expect(dollars(r.grossAnnualCents)).toBe(100_000);
  });
});

describe("a monthly additional amount has no tax math", () => {
  test("a $100,000 salary and $2,000 a month: the amount is added after tax, the premium and the charity share", () => {
    // Wages 94,000. Social Security and Medicare 7,191.
    // Federal: taxable 94,000 - 32,200 = 61,800: 2,480 + 12% x 37,000 = 4,440; 6,920 less 2,200 = 4,720.
    // After tax 100,000 - 7,191 - 4,720 = 88,089. Charity share (88,089 - 6,000) x 10% = 8,208.90 (on the salary only).
    // Take-home 88,089 - 6,000 - 8,208.90 + 24,000 = 97,880.10.
    const b = w2Breakdown(10_000_000, 0, { ...A, additionalSalary: { kind: "monthly", monthlyCents: 200_000, fromPeriod: "2026-01" } });
    expect(dollars(b.federalAnnualCents)).toBe(4_720);
    expect(dollars(b.charityAnnualCents)).toBe(8_208.9);
    expect(dollars(b.takeHomeAnnualCents)).toBe(97_880.1);
    expect(dollars(b.otherNetAnnualCents)).toBe(24_000);
  });

  test("Salary needed is the salary for the need less the $24,000 the monthly amount brings", () => {
    // Need $10,000 a month = $120,000 a year; $2,000 a month covers $24,000 of it, so the salary is
    // the one that alone covers $96,000.
    const withOther = salaryForView(12_000_000, 0, { ...A, additionalSalary: { kind: "monthly", monthlyCents: 200_000, fromPeriod: "2026-01" } });
    const alone = salaryForView(9_600_000, 0, A);
    expect(withOther.grossAnnualCents).toBe(alone.grossAnnualCents);
    expect(withOther.grossAnnualCents).toBeLessThan(salaryForView(12_000_000, 0, A).grossAnnualCents);
  });

  test("an additional amount that covers everything needs no salary", () => {
    // $20,000 a month against a $10,000-a-month need.
    const r = salaryForView(12_000_000, 0, { ...A, additionalSalary: { kind: "monthly", monthlyCents: 2_000_000, fromPeriod: "2026-01" } });
    expect(r.grossAnnualCents).toBe(0);
  });

  test("Check a salary counts the additional amount in what the salary leaves to spend", () => {
    // Same $100,000 as above: paycheck (88,089 - 6,000) / 12 = 6,840.75; plus 2,000 = 8,840.75;
    // less the charity share 8,208.90 / 12 = 684.075, rounded once to 684.08 -> 8,156.67.
    const s = spendableAtSalary(10_000_000, 0, { ...A, additionalSalary: { kind: "monthly", monthlyCents: 200_000, fromPeriod: "2026-01" } });
    expect(dollars(s.spendableMonthlyCents)).toBe(8_156.67);
  });
});

describe("what Settings, Salary refuses", () => {
  test("a salary needs an amount above zero and a start month", () => {
    expect(incomeProblem({ kind: "gross", grossAnnualCents: 15_000_000, fromPeriod: "2026-11" }, null)).toBeNull();
    expect(incomeProblem({ kind: "take-home", monthlyCents: 900_000, fromPeriod: "2026-11" }, null)).toBeNull();
    expect(incomeProblem({ kind: "gross", grossAnnualCents: 0, fromPeriod: "2026-11" }, null)).toMatch(/salary/i);
    expect(incomeProblem({ kind: "gross", grossAnnualCents: 15_000_000, fromPeriod: "Nov" }, null)).toMatch(/month/i);
    expect(incomeProblem(null, { kind: "w2", grossAnnualCents: -1, fromPeriod: "2026-11" })).toMatch(/additional/i);
    expect(incomeProblem(null, { kind: "monthly", monthlyCents: 100_000, fromPeriod: "" })).toMatch(/month/i);
    // @ts-expect-error -- an unknown kind from a bad request
    expect(incomeProblem({ kind: "bonus", grossAnnualCents: 1, fromPeriod: "2026-11" }, null)).not.toBeNull();
    expect(incomeProblem(null, null)).toBeNull();
  });
});
