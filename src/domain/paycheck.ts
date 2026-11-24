// src/domain/paycheck.ts
//
// Paycheck figures: the federal
// income tax, Social Security and Medicare, and the health premium are typed PER PAYCHECK,
// as read off the pay stub, with a pay schedule chosen once. The user's words: "tax should also be
// monthly - I enter it from the amount I see come out of my paycheck"; then B, per paycheck
// with a schedule. Rejected: yearly tax boxes (as first built); one box per
// month's total.
//
// One function turns a paycheck figure into a year and a month: a year is the paycheck times
// the paychecks a year, exact to the cent; a month is that year / 12, rounded to the cent with
// Math.round, as monthlyPayCents rounds. The converted figures feed the paths the app already
// has: the taxes become the yearly firm figures (the user's current salary only), the premium the
// monthly premium (every salary). Nothing downstream changes.
//
// Older figures: before this, the premium was typed A MONTH (key salary_premium_monthly_cents)
// and the taxes A YEAR (salary_firm_taxes). Each older figure still reads as it was typed until
// the user types the paycheck figure that replaces it; a blank paycheck box with no older figure is
// the estimate. Pure; integer cents.
import type { FirmTaxes, SalaryAssumptions } from "./salary";

export type PaySchedule = "weekly" | "every-two-weeks" | "twice-a-month" | "monthly";

/** The four choices, in the order the screen shows them. */
export const PAY_SCHEDULES: ReadonlyArray<{ value: PaySchedule; label: string; paychecksAYear: number }> = [
  { value: "weekly", label: "Weekly", paychecksAYear: 52 },
  { value: "every-two-weeks", label: "Every two weeks", paychecksAYear: 26 },
  { value: "twice-a-month", label: "Twice a month", paychecksAYear: 24 },
  { value: "monthly", label: "Monthly", paychecksAYear: 12 },
];

export function isPaySchedule(v: unknown): v is PaySchedule {
  return PAY_SCHEDULES.some((s) => s.value === v);
}

/** The figures from one paycheck, each null until typed (then estimated, or an older figure). */
export interface PaycheckFigures {
  federalCents: number | null;
  payrollCents: number | null;
  premiumCents: number | null;
  /**
   * Other taxes withheld (state and local). Absent or null = none typed: these are never
   * estimated, so a blank box means none come out.
   */
  otherTaxesCents?: number | null;
}

/** A paycheck figure as a year (exact) and a month (the year / 12, rounded once). */
export function paycheckToMonthAndYear(perPaycheckCents: number, schedule: PaySchedule): { yearlyCents: number; monthlyCents: number } {
  const n = PAY_SCHEDULES.find((s) => s.value === schedule)!.paychecksAYear;
  const yearlyCents = perPaycheckCents * n;
  return { yearlyCents, monthlyCents: Math.round(yearlyCents / 12) };
}

/**
 * Why a save of the schedule and paycheck figures cannot stand, in plain words; null when it
 * can. `schedule` is the one that will be in force after the save.
 */
export function paycheckProblem(schedule: unknown, figures: unknown): string | null {
  if (schedule !== null && schedule !== undefined && !isPaySchedule(schedule)) return "That pay schedule is not recognized.";
  if (figures === null || figures === undefined) return null;
  if (typeof figures !== "object") return "Paycheck figures are not recognized.";
  const f = figures as Record<string, unknown>;
  let any = false;
  for (const v of [f.federalCents, f.payrollCents, f.premiumCents, f.otherTaxesCents]) {
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) return "Type each paycheck figure as dollars, or leave it blank to estimate.";
    if (v < 0) return "A paycheck figure cannot be below zero.";
    any = true;
  }
  if (any && !isPaySchedule(schedule)) return "Pick how often you are paid before typing paycheck figures.";
  return null;
}

/** What is stored: the schedule and paycheck figures, and the older monthly premium and yearly taxes. */
export interface StoredPayFigures {
  paySchedule: PaySchedule | null;
  paycheck: PaycheckFigures | null;
  /** The premium typed a month before paycheck figures existed; null when blank or never typed. */
  olderPremiumMonthlyCents: number | null;
  /** The taxes typed a year before paycheck figures existed; null when none. */
  olderFirmTaxes: FirmTaxes | null;
}

/**
 * The figures the salary math uses: the monthly premium (null = the estimate) and the yearly
 * firm taxes (null = both estimated). Each one: the user's paycheck figure, converted; else the older
 * figure as it was typed; else the estimate.
 */
export function salaryFigures(s: StoredPayFigures): { premiumMonthlyCents: number | null; firmTaxes: FirmTaxes | null } {
  const typed = (v: number | null | undefined) => (s.paySchedule !== null && v !== null && v !== undefined ? paycheckToMonthAndYear(v, s.paySchedule) : null);
  const premium = typed(s.paycheck?.premiumCents);
  const federal = typed(s.paycheck?.federalCents);
  const payroll = typed(s.paycheck?.payrollCents);
  const other = typed(s.paycheck?.otherTaxesCents);
  const federalAnnualCents = federal ? federal.yearlyCents : (s.olderFirmTaxes?.federalAnnualCents ?? null);
  const payrollAnnualCents = payroll ? payroll.yearlyCents : (s.olderFirmTaxes?.payrollAnnualCents ?? null);
  // Other taxes withheld are carried only when typed, so a pay stub without them reads exactly as before.
  const withOther = other ? { otherAnnualCents: other.yearlyCents } : {};
  return {
    premiumMonthlyCents: premium ? premium.monthlyCents : s.olderPremiumMonthlyCents,
    firmTaxes: federalAnnualCents === null && payrollAnnualCents === null && !other ? null : { federalAnnualCents, payrollAnnualCents, ...withOther },
  };
}

/** Which figures in force are older ones (typed a month or a year), not paycheck figures or estimates. */
export function olderFigures(a: SalaryAssumptions): { premium: boolean; federal: boolean; payroll: boolean } {
  const p = a.paySchedule ? a.paycheck ?? null : null;
  return {
    premium: a.premiumFromSettings !== false && p?.premiumCents == null,
    federal: a.firmTaxes?.federalAnnualCents != null && p?.federalCents == null,
    payroll: a.firmTaxes?.payrollAnnualCents != null && p?.payrollCents == null,
  };
}
