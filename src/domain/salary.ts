// src/domain/salary.ts
//
// The salary a lifestyle view needs: the W2 gross whose take-home, after
// Social Security and Medicare, federal tax, a pre-tax paycheck premium and
// the charity obligation, equals the view's monthly need times twelve.
//
// Two rules from the design:
// the premium is taken before tax (Section 125), and charity is a floor --
// the view's own Charity line or maaser, whichever is larger. Pure, integer
// cents at the boundary; the bisection runs on float cents inside.
//
// An additional salary makes Salary needed the first earner's salary given the other one: a
// W-2 salary is taxed with it on one return when married filing jointly (federal tax
// on the combined wages, Social Security and Medicare per earner, one premium, the pot's share
// of the combined after-tax amount); a monthly amount is added after tax with no tax math and
// no pot share (it is already what lands in the bank).
//
// Federal tax uses the table for the household's filing status (tax.ts `taxFor`). State and
// local income tax is not estimated: a figure typed from a pay stub (other taxes withheld)
// comes out of the current salary only.
//
// Firm figures: once the user
// has them, the user types the user's yearly federal income tax and Social Security and Medicare in
// Settings, Salary. They apply to the user's CURRENT salary only (currentSalaryBreakdown);
// every other salary the app tries keeps the estimate, because a firm figure belongs to
// one salary. The premium typed in Settings applies to every salary, as it always has;
// `premiumFromSettings` says whether it was typed or is the estimate.
//
// Benefits: the premium is now the total of the
// benefits the user lists, a month. A benefit the user unticks as before tax still comes out of pay,
// but stays in the taxed wages: `afterTaxBenefitsMonthlyCents` is that part. Absent, or
// zero, every figure is exactly what the single premium gave.
//
// The charity pot (src/domain/charity-pot.ts): a percent pot takes its share of what lands in
// the bank from W-2 pay, after federal income tax, Social Security and Medicare and every
// benefit (before tax or after); an additional monthly amount carries none of it. A set-amount
// pot is its amount whatever the pay. With no pot passed, `maaserRate` is the share.
import { potAnnualModelCents, type CharityPot } from "./charity-pot";
import { TAX_2026_SINGLE, childCreditCents, federalIncomeTaxCentsRaw, taxFor, type TaxConstants, type TaxProfile } from "./tax";
import type { AdditionalSalary, CurrentSalary } from "./income";
import type { PaySchedule, PaycheckFigures } from "./paycheck";
import type { Benefit } from "./benefits";

/** The user's firm yearly tax figures, each null until typed (then the estimate stands). */
export interface FirmTaxes {
  federalAnnualCents: number | null;
  payrollAnnualCents: number | null;
  /** Other taxes withheld (state and local), a year. Absent or null = none typed; never estimated. */
  otherAnnualCents?: number | null;
}

export interface SalaryAssumptions {
  /** Benefits taken from pay, a month: before tax, less any after-tax part below. */
  premiumMonthlyCents: number;
  /** The part of premiumMonthlyCents taken after tax: it does not lower the taxed wages. Absent = 0. */
  afterTaxBenefitsMonthlyCents?: number;
  /** The benefits as the user listed them under Settings, Salary. Absent or null = no list (the older premium figure, or the estimate). */
  benefits?: Benefit[] | null;
  /** False when no premium was typed in Settings and the estimate stands. Absent reads as typed. */
  premiumFromSettings?: boolean;
  /** Firm yearly taxes for the user's current salary only. Absent or null = estimated. */
  firmTaxes?: FirmTaxes | null;
  /**
   * How often the user is paid, and the three figures typed from one paycheck. The
   * read has already turned them into `premiumMonthlyCents` and `firmTaxes` (src/domain/paycheck.ts);
   * they are carried here so Settings, Salary can show what was typed.
   */
  paySchedule?: PaySchedule | null;
  paycheck?: PaycheckFigures | null;
  /** The pot's share of pay into the bank as a fraction, e.g. 0.05; 0 when the pot is off or a set amount. */
  maaserRate: number;
  /** Children for the child tax credit: the tax profile's count, 0 while it is not set up. */
  children: number;
  /** The user's current salary (Settings, Salary). The Forecast screen counts it; Salary needed never reads it. */
  currentSalary?: CurrentSalary | null;
  /** Charity pot settings. Absent = today's behaviour (maaserRate stands). */
  pot?: CharityPot | null;
  /** Filing status and children. Absent = married filing jointly and no set-this-up card; null fields = not set up. */
  tax?: TaxProfile | null;
  /** Yearly bills added to what Salary needed covers, a year. Absent = 0. */
  yearlyBillsAnnualCents?: number;
  /** An additional salary. Salary needed is the user's salary given this one. */
  additionalSalary?: AdditionalSalary | null;
}

/** Nothing assumed: no benefits, no pot share, no children. */
export const DEFAULT_SALARY_ASSUMPTIONS: SalaryAssumptions = {
  premiumMonthlyCents: 0,
  premiumFromSettings: false,
  maaserRate: 0,
  children: 0,
};

export interface SalaryBreakdown {
  grossAnnualCents: number;
  ficaAnnualCents: number;
  federalAnnualCents: number;
  afterTaxAnnualCents: number;
  /** max(charity line, maaser). */
  charityAnnualCents: number;
  premiumAnnualCents: number;
  /** Household take-home: after tax, the premium and charity, plus any additional monthly amount. */
  takeHomeAnnualCents: number;
  /** The additional W-2 salary taxed with the user's, a year (0 when none). Its tax is inside fica and federal. */
  otherGrossAnnualCents: number;
  /** The additional monthly amount, a year, added after tax with no tax math (0 when none). */
  otherNetAnnualCents: number;
  /** Other taxes withheld (state and local), a year, typed from a pay stub (current salary only). 0 when none typed. */
  otherTaxesAnnualCents: number;
  /** True when federal income tax is the user's firm figure from Settings (current salary only). Absent = estimated. */
  firmFederal?: boolean;
  /** True when Social Security and Medicare is the user's firm figure from Settings. Absent = estimated. */
  firmPayroll?: boolean;
}

/** True when either firm figure (federal, or Social Security and Medicare) has been typed. */
export function hasFirmTaxes(f: FirmTaxes | null | undefined): f is FirmTaxes {
  return !!f && (f.federalAnnualCents != null || f.payrollAnnualCents != null);
}

/** Social Security and Medicare for one earner: each has their own wage base. */
function payrollOne(wages: number, tax: TaxConstants): number {
  return 0.0765 * Math.min(wages, tax.ssWageBaseCents) + 0.0145 * Math.max(0, wages - tax.ssWageBaseCents);
}

/** One earner's own return: Social Security and Medicare, and federal tax less the child credit. */
function separateReturn(wages: number, tax: TaxConstants, children: number): { fica: number; federal: number } {
  return {
    fica: payrollOne(wages, tax) + tax.addlMedicareRate * Math.max(0, wages - tax.addlMedicareThresholdCents),
    federal: Math.max(0, federalIncomeTaxCentsRaw(wages - tax.stdDeductionCents, tax) - childCreditCents(tax, children, wages)),
  };
}

/** The additional salary as the two numbers the tax math needs. */
function otherOf(a: SalaryAssumptions): { w2: number; net: number } {
  const o = a.additionalSalary;
  if (!o) return { w2: 0, net: 0 };
  return o.kind === "w2" ? { w2: o.grossAnnualCents, net: 0 } : { w2: 0, net: o.monthlyCents * 12 };
}

/**
 * A household's year: one return when filing jointly; otherwise the additional W-2 salary
 * is its own single return. `hisGross` null means the user draws no salary
 * (no premium either); `otherW2` is a second W-2 salary taxed with the user's,
 * `otherNet` a yearly amount added after tax. With no other income this is
 * exactly the single-earner working the app has always used.
 */
export function jointBreakdownRaw(hisGross: number | null, otherW2: number, otherNet: number, charityLineAnnualCents: number, a: SalaryAssumptions, tax: TaxConstants = taxFor(a)): SalaryBreakdown {
  const grossAnnualCents = hisGross ?? 0;
  const premiumAnnualCents = hisGross === null ? 0 : a.premiumMonthlyCents * 12;
  // Only benefits taken before tax lower the taxed wages.
  const beforeTaxAnnualCents = premiumAnnualCents - (hisGross === null ? 0 : (a.afterTaxBenefitsMonthlyCents ?? 0) * 12);
  const wages = Math.max(0, grossAnnualCents - beforeTaxAnnualCents);
  let ficaAnnualCents: number;
  let federalAnnualCents: number;
  if ((a.tax?.filingStatus ?? "mfj") === "mfj" || otherW2 === 0) {
    // One return: federal tax on the combined wages; the 0.9% additional Medicare on the combined
    // wages over the filing status's threshold.
    ficaAnnualCents =
      payrollOne(wages, tax) +
      payrollOne(otherW2, tax) +
      tax.addlMedicareRate * Math.max(0, wages + otherW2 - tax.addlMedicareThresholdCents);
    federalAnnualCents = Math.max(0, federalIncomeTaxCentsRaw(wages + otherW2 - tax.stdDeductionCents, tax) - childCreditCents(tax, a.children, wages + otherW2));
  } else {
    // Not married filing jointly: the additional W-2 salary is its earner's own single return (its
    // own standard deduction, brackets and Medicare threshold, no children); the first earner files
    // under the household's status and claims the children.
    const own = separateReturn(wages, tax, a.children);
    const theirs = separateReturn(otherW2, TAX_2026_SINGLE, 0);
    ficaAnnualCents = own.fica + theirs.fica;
    federalAnnualCents = own.federal + theirs.federal;
  }
  const afterTaxAnnualCents = grossAnnualCents + otherW2 - ficaAnnualCents - federalAnnualCents;
  const charityAnnualCents = Math.max(charityLineAnnualCents, potAnnualModelCents(a.pot, afterTaxAnnualCents - premiumAnnualCents, a.maaserRate));
  const takeHomeAnnualCents = afterTaxAnnualCents - premiumAnnualCents - charityAnnualCents + otherNet;
  return {
    grossAnnualCents, ficaAnnualCents, federalAnnualCents, afterTaxAnnualCents, charityAnnualCents, premiumAnnualCents, takeHomeAnnualCents,
    otherGrossAnnualCents: otherW2, otherNetAnnualCents: otherNet, otherTaxesAnnualCents: 0,
  };
}

function breakdownRaw(grossAnnualCents: number, charityLineAnnualCents: number, a: SalaryAssumptions, tax: TaxConstants): SalaryBreakdown {
  const other = otherOf(a);
  return jointBreakdownRaw(grossAnnualCents, other.w2, other.net, charityLineAnnualCents, a, tax);
}

/**
 * Every figure rounded to the cent once: the breakdown the statement, Check a salary and
 *  the Forecast take a month from.
 */
export function roundAll(b: SalaryBreakdown): SalaryBreakdown {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === "number" ? Math.round(v) : v])) as unknown as SalaryBreakdown;
}

/**
 * The user's CURRENT salary's year: the estimate, with each firm figure typed in Settings in
 * its place. With an additional W-2 salary, the extra tax that salary adds to the joint
 * estimate stays estimated on top of the user's firm figure. With no firm figure, or no salary
 * of the user's own, this is exactly the estimate. Never used for any other salary. Other taxes
 * withheld (state and local), when typed, come out before the pot's share is worked.
 */
export function currentSalaryBreakdownRaw(hisGross: number | null, otherW2: number, otherNet: number, charityLineAnnualCents: number, a: SalaryAssumptions, tax: TaxConstants = taxFor(a)): SalaryBreakdown {
  const est = jointBreakdownRaw(hisGross, otherW2, otherNet, charityLineAnnualCents, a, tax);
  const f = a.firmTaxes;
  const otherTaxesAnnualCents = hisGross === null ? 0 : f?.otherAnnualCents ?? 0;
  if (hisGross === null || (!hasFirmTaxes(f) && otherTaxesAnnualCents === 0)) return est;
  const alone = otherW2 > 0 ? jointBreakdownRaw(hisGross, 0, 0, 0, a, tax) : est;
  const federalAnnualCents = f?.federalAnnualCents != null ? f.federalAnnualCents + (est.federalAnnualCents - alone.federalAnnualCents) : est.federalAnnualCents;
  const ficaAnnualCents = f?.payrollAnnualCents != null ? f.payrollAnnualCents + (est.ficaAnnualCents - alone.ficaAnnualCents) : est.ficaAnnualCents;
  const afterTaxAnnualCents = est.grossAnnualCents + otherW2 - ficaAnnualCents - federalAnnualCents - otherTaxesAnnualCents;
  const charityAnnualCents = Math.max(charityLineAnnualCents, potAnnualModelCents(a.pot, afterTaxAnnualCents - est.premiumAnnualCents, a.maaserRate));
  return {
    ...est,
    federalAnnualCents,
    ficaAnnualCents,
    afterTaxAnnualCents,
    charityAnnualCents,
    takeHomeAnnualCents: afterTaxAnnualCents - est.premiumAnnualCents - charityAnnualCents + otherNet,
    otherTaxesAnnualCents,
    firmFederal: f?.federalAnnualCents != null,
    firmPayroll: f?.payrollAnnualCents != null,
  };
}

/** The user's current salary's figures, rounded: the estimate with the user's firm figures in place. */
export function currentSalaryBreakdown(grossAnnualCents: number, charityLineAnnualCents: number, a: SalaryAssumptions, tax: TaxConstants = taxFor(a)): SalaryBreakdown {
  const other = otherOf(a);
  return roundAll(currentSalaryBreakdownRaw(grossAnnualCents, other.w2, other.net, charityLineAnnualCents, a, tax));
}

/** Every figure for a given gross. */
export function w2Breakdown(grossAnnualCents: number, charityLineAnnualCents: number, a: SalaryAssumptions, tax: TaxConstants = taxFor(a)): SalaryBreakdown {
  return roundAll(breakdownRaw(grossAnnualCents, charityLineAnnualCents, a, tax));
}

/**
 * The gross that makes take-home equal the annual need. Bisection on
 * [need, max(need x 4, $100,000)]; 80 iterations is far past cent precision.
 * Gross is rounded to whole dollars (the figure is a salary, not a ledger
 * entry); the breakdown is recomputed at that rounded gross.
 */
export function salaryForView(needExCharityBaseAnnualCents: number, charityLineAnnualCents: number, a: SalaryAssumptions, tax: TaxConstants = taxFor(a)): SalaryBreakdown {
  // Salary needed also covers yearly bills (0 until they are set up).
  const needExCharityAnnualCents = needExCharityBaseAnnualCents + (a.yearlyBillsAnnualCents ?? 0);
  // Nothing to pay for: no salary, so no premium either;
  // a $0 salary less the premium would read as a negative take-home needed.
  if (needExCharityAnnualCents <= 0 && charityLineAnnualCents <= 0)
    return { grossAnnualCents: 0, ficaAnnualCents: 0, federalAnnualCents: 0, afterTaxAnnualCents: 0, charityAnnualCents: 0, premiumAnnualCents: 0, takeHomeAnnualCents: 0, otherGrossAnnualCents: 0, otherNetAnnualCents: 0, otherTaxesAnnualCents: 0 };
  // With an additional salary the user's own may need to be far less than the need,
  // or nothing at all when the other salary covers it.
  const hasOther = !!a.additionalSalary;
  if (hasOther && breakdownRaw(0, charityLineAnnualCents, a, tax).takeHomeAnnualCents >= needExCharityAnnualCents)
    return w2Breakdown(0, charityLineAnnualCents, a, tax);
  let lo = hasOther ? 0 : needExCharityAnnualCents;
  let hi = Math.max(needExCharityAnnualCents * 4, 10_000_000);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (breakdownRaw(mid, charityLineAnnualCents, a, tax).takeHomeAnnualCents < needExCharityAnnualCents) lo = mid;
    else hi = mid;
  }
  const gross = Math.round((lo + hi) / 2 / 100) * 100;
  return w2Breakdown(gross, charityLineAnnualCents, a, tax);
}

/**
 * A month of a salary, each part rounded once: the paycheck (after tax and the
 * premium) and the maaser on it. Runway and Check a salary both take the month
 * from these two figures; until then Check a salary
 * divided the rounded yearly take-home by 12 and read a cent off Runway.
 */
export function monthlyPayCents(b: SalaryBreakdown, a: SalaryAssumptions): { paycheckCents: number; maaserCents: number } {
  return {
    // Any additional monthly amount lands in the bank beside the paycheck.
    paycheckCents: Math.round((b.afterTaxAnnualCents - b.premiumAnnualCents + (b.otherNetAnnualCents ?? 0)) / 12),
    // The pot's month: its share of what lands in the bank from the paycheck (after tax and
    // benefits), or a twelfth of a set amount's year.
    maaserCents: Math.round(potAnnualModelCents(a.pot, b.afterTaxAnnualCents - b.premiumAnnualCents, a.maaserRate) / 12),
  };
}

/**
 * "Try a salary": what a gross leaves to spend each month, after charity (the larger of
 * the line and maaser). `current` says the gross is the user's current salary, so the user's firm tax
 * figures apply; any other salary is estimated.
 */
export function spendableAtSalary(grossAnnualCents: number, charityLineAnnualCents: number, a: SalaryAssumptions, tax: TaxConstants = taxFor(a), opts: { current?: boolean } = {}): { spendableMonthlyCents: number; breakdown: SalaryBreakdown } {
  const breakdown = opts.current ? currentSalaryBreakdown(grossAnnualCents, charityLineAnnualCents, a, tax) : w2Breakdown(grossAnnualCents, charityLineAnnualCents, a, tax);
  const { paycheckCents, maaserCents } = monthlyPayCents(breakdown, a);
  return { spendableMonthlyCents: paycheckCents - Math.max(Math.round(charityLineAnnualCents / 12), maaserCents), breakdown };
}
