// tests/domain/loan.test.ts
// The loan payment formula.
import { describe, expect, test } from "vitest";
import { monthlyLoanPaymentCents } from "../../src/domain/loan";

describe("monthlyLoanPaymentCents", () => {
  test("standard amortization formula P*r/(1-(1+r)^-n)", () => {
    // $100,000 principal, 10.5%/yr, 10yr term.
    const principal = 100_000 * 100;
    const r = 0.105 / 12;
    const n = 10 * 12;
    const expected = Math.round((principal * r) / (1 - Math.pow(1 + r, -n)));
    expect(monthlyLoanPaymentCents(principal, 0.105, 10)).toBe(expected);
  });
  test("at 0 percent the payment is the principal spread evenly", () => {
    expect(monthlyLoanPaymentCents(120_000_00, 0, 10)).toBe(100_000); // 12,000,000 cents / 120 months
  });
  test("a term of zero or less has no payment schedule, so the payment is 0, never NaN or Infinity", () => {
    expect(monthlyLoanPaymentCents(120_000_00, 0.105, 0)).toBe(0);
    expect(monthlyLoanPaymentCents(120_000_00, 0, 0)).toBe(0);
    expect(monthlyLoanPaymentCents(120_000_00, 0.065, -3)).toBe(0);
  });
  test("the normal case: 500,000 at 8 percent over 10 years is 6,066.38 a month", () => {
    expect(monthlyLoanPaymentCents(50_000_000, 0.08, 10)).toBe(606_638);
  });
  test("a typical 30-year mortgage: $400,000 at 6.5 percent", () => {
    expect(monthlyLoanPaymentCents(40_000_000, 0.065, 30)).toBe(252_827);
  });
});
