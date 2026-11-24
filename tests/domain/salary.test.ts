// tests/domain/salary.test.ts
//
// The demo household's salary: benefits $340.00 a month before tax, the pot 5% of pay into the
// bank (after tax and benefits), one child, married filing jointly. Figures below worked by hand.
// The Salary needed grosses are bisection results: each was checked (by a tsx run against
// w2Breakdown) to be the whole dollar nearest the root, i.e. take-home at the gross less $1
// falls short of the need and at the gross plus $1 passes it.
import { describe, expect, test } from "vitest";
import { salaryForView, spendableAtSalary, w2Breakdown } from "../../src/domain/salary";
import { demoSalary } from "../demo";

const A = demoSalary(); // benefits $340.00/mo, pot 5%, one child
const yr = (monthlyCents: number) => monthlyCents * 12;

describe("salaryForView", () => {
  test("yearly bills raise Salary needed; absent leaves it as before", () => {
    const base = salaryForView(yr(1_000_000), 0, A);
    expect(salaryForView(yr(1_000_000), 0, { ...A, yearlyBillsAnnualCents: undefined }).grossAnnualCents).toBe(base.grossAnnualCents);
    const withBills = salaryForView(yr(1_000_000), 0, { ...A, yearlyBillsAnnualCents: 1_200_000 });
    expect(withBills.grossAnnualCents).toBeGreaterThan(base.grossAnnualCents);
    // The same as a need that is larger by the whole bill.
    expect(withBills).toEqual(salaryForView(yr(1_000_000) + 1_200_000, 0, A));
  });

  // Nothing to pay for means no salary and no take-home, never a negative take-home from a
  // premium charged on a $0 salary.
  test("zero costs need a $0 salary and a $0 take-home, with every step zero", () => {
    const r = salaryForView(0, 0, A);
    expect(r.grossAnnualCents).toBe(0);
    expect(r.takeHomeAnnualCents).toBe(0);
    expect([r.federalAnnualCents, r.ficaAnnualCents, r.premiumAnnualCents, r.charityAnnualCents]).toEqual([0, 0, 0, 0]);
  });
  // Need $132,000.00 a year -> $173,358:
  //   wages after the $4,080.00 benefits: $169,278; payroll 7.65% = $12,949.77;
  //   federal on $137,078 taxable: $11,600 + 22% of $36,278 = $19,581.16, less $2,200 credit = $17,381.16;
  //   after tax $173,358 - $12,949.77 - $17,381.16 = $143,027.07;
  //   into the bank $143,027.07 - $4,080.00 = $138,947.07; the pot 5% = $6,947.35;
  //   take-home $138,947.07 - $6,947.35 = $131,999.72, 28 cents short; at $173,359 it is 39 cents over.
  test("the planned view: need $11,000.00/mo, no Charity line -> $173,358", () => {
    const r = salaryForView(yr(1_100_000), 0, A);
    expect(r.grossAnnualCents).toBe(17_335_800);
    expect(Math.round(r.charityAnnualCents / 100)).toBe(6_947);
    expect(Math.round(r.takeHomeAnnualCents / 100)).toBe(132_000);
  });

  test("three other views", () => {
    expect(salaryForView(yr(1_090_000), 0, A).grossAnnualCents).toBe(17_156_300);
    expect(salaryForView(yr(1_130_000), 0, A).grossAnnualCents).toBe(17_874_500);
    expect(salaryForView(yr(690_000), 0, A).grossAnnualCents).toBe(10_438_900);
  });

  test("no premium: need $12,100.00/mo -> $188,662", () => {
    expect(salaryForView(yr(1_210_000), 0, { ...A, premiumMonthlyCents: 0 }).grossAnnualCents).toBe(18_866_200);
  });

  test("the floor rule: a Charity line above maaser is what gets covered", () => {
    const r = salaryForView(yr(500_000), yr(120_000), { ...A, premiumMonthlyCents: 0 });
    expect(r.grossAnnualCents).toBe(8_443_100);
    expect(r.charityAnnualCents).toBe(1_440_000);
  });

  test("take-home covers the need exactly at the solved gross", () => {
    const r = salaryForView(yr(1_000_000), 0, A);
    expect(Math.abs(r.takeHomeAnnualCents - yr(1_000_000))).toBeLessThan(100 * 100);
  });

  test("a zero need solves to zero", () => {
    expect(salaryForView(0, 0, A).grossAnnualCents).toBe(0);
  });
});

describe("w2Breakdown", () => {
  test("the premium is pre-tax: it lowers Social Security and Medicare and federal tax", () => {
    const withP = w2Breakdown(20_000_000, 0, A);
    const noP = w2Breakdown(20_000_000, 0, { ...A, premiumMonthlyCents: 0 });
    expect(withP.ficaAnnualCents).toBeLessThan(noP.ficaAnnualCents);
    expect(withP.federalAnnualCents).toBeLessThan(noP.federalAnnualCents);
    expect(withP.premiumAnnualCents).toBe(408_000);
  });
});

describe("spendableAtSalary", () => {
  test("$150,000 with no premium leaves $9,926 a month after tax and the pot", () => {
    const r = spendableAtSalary(15_000_000, 0, { ...A, premiumMonthlyCents: 0 });
    expect(Math.round(r.spendableMonthlyCents / 100)).toBe(9_926);
  });

  test("a salary below the yearly premium is simply short by the difference: no NaN, no throw", () => {
    const a = { ...A, premiumMonthlyCents: 60_000 }; // $7,200 a year
    const r = spendableAtSalary(500_000, 0, a); // $5,000 gross
    expect(r.breakdown.ficaAnnualCents).toBe(0);
    expect(r.breakdown.federalAnnualCents).toBe(0);
    // Nothing lands in the bank ($5,000 - $7,200 = -$2,200), so the pot's share of it is below the
    // $0 Charity line and nothing comes out for it: take-home is $5,000 - $7,200 = -$2,200.
    expect(r.breakdown.charityAnnualCents).toBe(0);
    expect(r.breakdown.takeHomeAnnualCents).toBe(500_000 - 720_000);
    expect(Number.isNaN(r.spendableMonthlyCents)).toBe(false);
    expect(r.spendableMonthlyCents).toBeLessThan(0);
  });
});
