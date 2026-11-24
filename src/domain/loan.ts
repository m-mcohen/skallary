// src/domain/loan.ts
//
// The fixed-rate loan payment the app still uses: the What if loan form
// (src/ui/what-if/LoanDialog.tsx, what-if.ts loanMonthlyCents) and the Goals
// payment helper. It lived in acquisition.ts until the Acquisition screen was
// removed; the formula is
// unchanged and every figure that used it still reads the same.

/**
 * Standard fixed-rate amortizing monthly payment: P * r / (1 - (1+r)^-n),
 * where r = annualRate / 12 (monthly rate) and n = termYears * 12 (months).
 */
export function monthlyLoanPaymentCents(principalCents: number, annualRate: number, termYears: number): number {
  const r = annualRate / 12;
  const n = termYears * 12;
  // No schedule to pay over: 0, never NaN or Infinity (the form also refuses a
  // term under one year). At exactly 0 percent the formula is 0/0, and the
  // payment is simply the principal spread evenly.
  if (!(n > 0)) return 0;
  if (r === 0) return Math.round(principalCents / n);
  const payment = (principalCents * r) / (1 - Math.pow(1 + r, -n));
  return Math.round(payment);
}
