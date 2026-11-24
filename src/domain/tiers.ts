// src/domain/tiers.ts
//
// Tax + tier engine, pure: federal tax, take-home from gross for W-2 pay and
// for self-employment pay.
//
// All dollar constants below are the real 2026 figures (IRS Rev. Proc. 2025-32;
// SSA). Internal math runs on floating-point cents
// (mirroring Python's float math exactly, just at 100x scale); only the
// EXPORTED function boundaries round to integer cents via Math.round.
//
// Additional Medicare Tax (0.9% over the MFJ threshold) IS now modeled, in
// both netFromGrossW2Cents and netFromGrossSECents.
//
// The tax tables and the federal tax moved to tax.ts; only this helper is left here.
import { TAX_2026_MFJ, federalIncomeTaxCentsRaw, type TaxConstants } from "./tax";

/**
 * W2 take-home: gross - FICA (7.65% to the wage base, 1.45% above, plus 0.9%
 * additional Medicare above the MFJ threshold) - (fed tax - child credit x
 * children). `children` multiplies the per-child credit.
 */
export function netFromGrossW2Cents(
  grossCents: number,
  tax: TaxConstants = TAX_2026_MFJ,
  children: number = 1,
): number {
  const fica =
    0.0765 * Math.min(grossCents, tax.ssWageBaseCents) +
    0.0145 * Math.max(0, grossCents - tax.ssWageBaseCents) +
    tax.addlMedicareRate * Math.max(0, grossCents - tax.addlMedicareThresholdCents);
  const fedTaxCents = federalIncomeTaxCentsRaw(grossCents - tax.stdDeductionCents, tax);
  const netCents = grossCents - fica - Math.max(0, fedTaxCents - tax.ctcCents * children);
  return Math.round(netCents);
}
