// src/domain/tax.ts
//
// The federal tax tables and the household's tax profile. Filing
// status picks the table; the child count multiplies the per-child credit. State and local
// income tax is not estimated: a person types it from a pay stub (other taxes withheld).
//
// Internal math runs on floating-point cents; only the exported boundaries round to whole cents.
import type { SalaryAssumptions } from "./salary";

export type FilingStatus = "single" | "mfj" | "hoh";
export interface TaxProfile { filingStatus: FilingStatus | null; children: number | null } // null = not set up

export const FILING_STATUSES: readonly FilingStatus[] = ["single", "mfj", "hoh"];

export function isFilingStatus(v: unknown): v is FilingStatus {
  return typeof v === "string" && (FILING_STATUSES as readonly string[]).includes(v);
}

/** The filing status in plain words, as the screens say it. */
export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: "Single",
  mfj: "Married filing jointly",
  hoh: "Head of household",
};

export interface TaxBracket {
  uptoCents: number; // Infinity for the top bracket
  rate: number;
}

export interface TaxConstants {
  stdDeductionCents: number; // standard deduction
  ctcCents: number; // child tax credit PER CHILD
  ctcPhaseOutStartCents: number; // the credit falls $50 per $1,000 (or part) of income over this
  ssWageBaseCents: number; // Social Security wage base
  addlMedicareThresholdCents: number; // 0.9% additional Medicare above this
  addlMedicareRate: number;
  brackets: TaxBracket[]; // cumulative-threshold form
  qbiFullTaxableCents: number; // full 20% QBI below this
  qbiZeroTaxableCents: number; // 0% QBI at/above this (SSTB phase-out)
}

// Tax year 2026 federal figures. Brackets, standard deductions, the child tax credit and the
// section 199A (QBI) thresholds: IRS Revenue Procedure 2025-32, sections 4.01 (Tables 1 to 3),
// 4.05, 4.14 and 4.26. Social Security wage base: the Social Security Administration's 2026
// figure. Additional Medicare thresholds (250,000 joint, 200,000 otherwise) are fixed in the
// Internal Revenue Code (sections 3101(b)(2) and 1401(b)(2)) and are not indexed. The child tax
// credit phase-out (400,000 joint, 200,000 otherwise, less $50 per $1,000 or part over it) is
// fixed in section 24(b)(1) and (2) and is not indexed either.
const SS_WAGE_BASE_2026 = 18_450_000;
const CHILD_CREDIT_2026 = 220_000;

/** Married filing jointly (Rev. Proc. 2025-32, Table 1). */
export const TAX_2026_MFJ: TaxConstants = {
  stdDeductionCents: 3_220_000,
  ctcCents: CHILD_CREDIT_2026,
  ctcPhaseOutStartCents: 40_000_000,
  ssWageBaseCents: SS_WAGE_BASE_2026,
  addlMedicareThresholdCents: 25_000_000,
  addlMedicareRate: 0.009,
  brackets: [
    { uptoCents: 2_480_000, rate: 0.10 },
    { uptoCents: 10_080_000, rate: 0.12 },
    { uptoCents: 21_140_000, rate: 0.22 },
    { uptoCents: 40_355_000, rate: 0.24 },
    { uptoCents: 51_245_000, rate: 0.32 },
    { uptoCents: 76_870_000, rate: 0.35 },
    { uptoCents: Infinity, rate: 0.37 },
  ],
  qbiFullTaxableCents: 40_350_000,
  qbiZeroTaxableCents: 55_350_000,
};

/** Single, "unmarried individuals" (Rev. Proc. 2025-32, Table 3). */
export const TAX_2026_SINGLE: TaxConstants = {
  stdDeductionCents: 1_610_000,
  ctcCents: CHILD_CREDIT_2026,
  ctcPhaseOutStartCents: 20_000_000,
  ssWageBaseCents: SS_WAGE_BASE_2026,
  addlMedicareThresholdCents: 20_000_000,
  addlMedicareRate: 0.009,
  brackets: [
    { uptoCents: 1_240_000, rate: 0.10 },
    { uptoCents: 5_040_000, rate: 0.12 },
    { uptoCents: 10_570_000, rate: 0.22 },
    { uptoCents: 20_177_500, rate: 0.24 },
    { uptoCents: 25_622_500, rate: 0.32 },
    { uptoCents: 64_060_000, rate: 0.35 },
    { uptoCents: Infinity, rate: 0.37 },
  ],
  qbiFullTaxableCents: 20_175_000,
  qbiZeroTaxableCents: 27_675_000,
};

/** Head of household (Rev. Proc. 2025-32, Table 2). */
export const TAX_2026_HOH: TaxConstants = {
  stdDeductionCents: 2_415_000,
  ctcCents: CHILD_CREDIT_2026,
  ctcPhaseOutStartCents: 20_000_000,
  ssWageBaseCents: SS_WAGE_BASE_2026,
  addlMedicareThresholdCents: 20_000_000,
  addlMedicareRate: 0.009,
  brackets: [
    { uptoCents: 1_770_000, rate: 0.10 },
    { uptoCents: 6_745_000, rate: 0.12 },
    { uptoCents: 10_570_000, rate: 0.22 },
    { uptoCents: 20_175_000, rate: 0.24 },
    { uptoCents: 25_620_000, rate: 0.32 },
    { uptoCents: 64_060_000, rate: 0.35 },
    { uptoCents: Infinity, rate: 0.37 },
  ],
  qbiFullTaxableCents: 20_175_000,
  qbiZeroTaxableCents: 27_675_000,
};

/** The table for a filing status. */
export function taxConstantsFor(status: FilingStatus): TaxConstants {
  return status === "single" ? TAX_2026_SINGLE : status === "hoh" ? TAX_2026_HOH : TAX_2026_MFJ;
}

/**
 * True when the screens must show the "set this up" card in place of an estimated tax: a tax
 * profile was read and its filing status or child count is not set. No profile at all
 * (`tax` absent) is false, so callers that never read one keep working as before.
 */
export function taxSetUpNeeded(a: Pick<SalaryAssumptions, "tax">): boolean {
  if (a.tax === undefined) return false;
  return !a.tax || a.tax.filingStatus === null || a.tax.children === null;
}

/**
 * The table the salary math uses: the profile's, else married filing jointly. The fallback is
 * never shown as an estimate: while the profile is not set, the screens show the card instead.
 */
export function taxFor(a: Pick<SalaryAssumptions, "tax">): TaxConstants {
  const status = a.tax?.filingStatus;
  return status ? taxConstantsFor(status) : TAX_2026_MFJ;
}

/**
 * The child tax credit for `children` on a return with `incomeCents` of income (wages here): the
 * per-child credit, less $50 for each $1,000 or part of $1,000 over the filing status's threshold.
 */
export function childCreditCents(tax: TaxConstants, children: number, incomeCents: number): number {
  const over = Math.max(0, incomeCents - tax.ctcPhaseOutStartCents);
  return Math.max(0, tax.ctcCents * children - 5_000 * Math.ceil(over / 100_000));
}

/**
 * Internal, unrounded progressive federal tax. The salary math keeps the unrounded figure so
 * its chained float math rounds once, at the end.
 */
export function federalIncomeTaxCentsRaw(taxableIncomeCents: number, tax: TaxConstants): number {
  const t = Math.max(0, taxableIncomeCents);
  let taxAmountCents = 0;
  let lo = 0;
  for (const { uptoCents, rate } of tax.brackets) {
    if (t > lo) {
      taxAmountCents += (Math.min(t, uptoCents) - lo) * rate;
      lo = uptoCents;
    } else {
      break;
    }
  }
  return taxAmountCents;
}

/** Progressive federal tax on taxable income, rounded to the cent. */
export function federalIncomeTaxCents(taxableIncomeCents: number, tax: TaxConstants = TAX_2026_MFJ): number {
  return Math.round(federalIncomeTaxCentsRaw(taxableIncomeCents, tax));
}
