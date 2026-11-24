// tests/domain/benefits.test.ts
// Benefits: the single health premium becomes a list typed under Settings, Salary, one
// row per benefit paid for: a name, an amount, per paycheck or per month, and a
// before-tax tick (ticked unless it is unticked). The total
// is what the premium was everywhere; only the before-tax part lowers the taxed wages.
import { describe, expect, test } from "vitest";
import { benefitMonthlyCents, benefitsProblem, benefitsTotals, cleanBenefits, type Benefit } from "../../src/domain/benefits";
import { DEFAULT_SALARY_ASSUMPTIONS, w2Breakdown, currentSalaryBreakdown, type SalaryAssumptions } from "../../src/domain/salary";

const row = (over: Partial<Benefit> = {}): Benefit => ({ name: "Health insurance", amountCents: 50_000, every: "month", beforeTax: true, ...over });

// Rows as made up for the tests: the figures are illustrative.
const five: Benefit[] = [
  row({ name: "Health insurance", amountCents: 50_000 }),
  row({ name: "Dental and vision", amountCents: 4_000 }),
  row({ name: "Long-term disability", amountCents: 1_500 }),
  row({ name: "HSA", amountCents: 50_000 }),
  row({ name: "FSA", amountCents: 20_000 }),
];

describe("a benefit a month", () => {
  test("a monthly amount is itself", () => {
    expect(benefitMonthlyCents(row({ amountCents: 50_000 }), null)).toBe(50_000);
    expect(benefitMonthlyCents(row({ amountCents: 50_000 }), "every-two-weeks")).toBe(50_000);
  });
  test("a paycheck amount is turned into a month by the pay schedule, as the paycheck boxes are", () => {
    expect(benefitMonthlyCents(row({ every: "paycheck", amountCents: 10_000 }), "twice-a-month")).toBe(20_000);
    expect(benefitMonthlyCents(row({ every: "paycheck", amountCents: 10_000 }), "every-two-weeks")).toBe(21_667);
    expect(benefitMonthlyCents(row({ every: "paycheck", amountCents: 10_000 }), "weekly")).toBe(43_333);
  });
});

describe("the totals", () => {
  test("the total is every row a month; the after-tax part is the unticked rows", () => {
    expect(benefitsTotals(five, null)).toEqual({ monthlyCents: 125_500, afterTaxMonthlyCents: 0 });
    const mixed = [row({ amountCents: 30_000 }), row({ name: "Life insurance", amountCents: 2_500, beforeTax: false })];
    expect(benefitsTotals(mixed, null)).toEqual({ monthlyCents: 32_500, afterTaxMonthlyCents: 2_500 });
  });
  test("an empty list is no benefits at all", () => {
    expect(benefitsTotals([], null)).toEqual({ monthlyCents: 0, afterTaxMonthlyCents: 0 });
  });
});

describe("what can be saved", () => {
  test("a good list saves", () => {
    expect(benefitsProblem(five, null)).toBeNull();
    expect(benefitsProblem([], null)).toBeNull();
  });
  test("each row needs a name and an amount of zero or more, in plain words", () => {
    expect(benefitsProblem([row({ name: "  " })], null)).toBe("Give each benefit a name.");
    expect(benefitsProblem([row({ amountCents: -1 })], null)).toBe("A benefit cannot be below zero.");
    expect(benefitsProblem([row({ amountCents: Number.NaN })], null)).toBe("Type each benefit as dollars, such as 500.00.");
    expect(benefitsProblem([row({ amountCents: 1.5 })], null)).toBe("Type each benefit as dollars, such as 500.00.");
  });
  test("a benefit typed a paycheck waits for the pay schedule", () => {
    expect(benefitsProblem([row({ every: "paycheck" })], null)).toBe("Pick how often you are paid before typing a benefit a paycheck.");
    expect(benefitsProblem([row({ every: "paycheck" })], "monthly")).toBeNull();
  });
  test("anything else is refused", () => {
    expect(benefitsProblem("x", null)).toBe("Benefits are not recognized.");
    expect(benefitsProblem([{ ...row(), every: "year" }], null)).toBe("Benefits are not recognized.");
    expect(benefitsProblem([{ ...row(), beforeTax: "yes" }], null)).toBe("Benefits are not recognized.");
    expect(benefitsProblem(Array.from({ length: 31 }, () => row()), null)).toBe("Thirty benefits at most.");
  });
  test("cleaning keeps only the four fields, the name trimmed and the amount whole cents", () => {
    expect(cleanBenefits([{ ...row({ name: "  HSA " }), extra: 1 } as unknown as Benefit])).toEqual([{ name: "HSA", amountCents: 50_000, every: "month", beforeTax: true }]);
  });
});

describe("the salary math", () => {
  const a: SalaryAssumptions = { ...DEFAULT_SALARY_ASSUMPTIONS, premiumMonthlyCents: 125_500, premiumFromSettings: true };

  test("all before tax: every figure is exactly what the single premium gave", () => {
    const list = { ...a, benefits: five, afterTaxBenefitsMonthlyCents: 0 };
    expect(w2Breakdown(15_000_000, 0, list)).toEqual(w2Breakdown(15_000_000, 0, a));
    expect(currentSalaryBreakdown(15_000_000, 0, list)).toEqual(currentSalaryBreakdown(15_000_000, 0, a));
  });

  test("an after-tax benefit still comes out of pay, but does not lower the taxed wages", () => {
    const after = { ...a, afterTaxBenefitsMonthlyCents: 25_000 };
    const pre = w2Breakdown(15_000_000, 0, a);
    const post = w2Breakdown(15_000_000, 0, after);
    expect(post.premiumAnnualCents).toBe(pre.premiumAnnualCents);
    // More wages taxed: more federal tax and more Social Security and Medicare.
    expect(post.federalAnnualCents).toBeGreaterThan(pre.federalAnnualCents);
    expect(post.ficaAnnualCents).toBeGreaterThan(pre.ficaAnnualCents);
    expect(post.takeHomeAnnualCents).toBeLessThan(pre.takeHomeAnnualCents);
    // Exactly the taxed wages of a premium that is only the before-tax part.
    const onlyPre = w2Breakdown(15_000_000, 0, { ...a, premiumMonthlyCents: 125_500 - 25_000 });
    expect(post.federalAnnualCents).toBe(onlyPre.federalAnnualCents);
    expect(post.ficaAnnualCents).toBe(onlyPre.ficaAnnualCents);
  });
});
