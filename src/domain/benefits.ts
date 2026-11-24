// src/domain/benefits.ts
//
// Benefits: the single health premium under
// Settings, Salary became a list the user types, one row per benefit the user pays for out of the user's
// paycheck (health insurance, dental and vision, disability, an HSA or FSA contribution):
// a name, an amount, per paycheck or per month, and a before-tax tick, ticked unless the user
// unticks it. The user's words: "the benefits detail should go in settings, where I will type
// each benefit I pay for". Rejected: fixed boxes (6b), always a month (7b), everything
// before tax (8b).
//
// The total a month is what the premium was everywhere (premiumMonthlyCents), so every
// screen that read the premium reads the benefits without change. Only the before-tax part
// lowers the taxed wages: the after-tax part is carried as afterTaxBenefitsMonthlyCents and
// the salary math leaves it in the wages (src/domain/salary.ts). A row typed a paycheck is
// turned into a month by the pay schedule, the way the paycheck boxes are; with no schedule
// it cannot be saved, and a stored one reads as a month. Pure; integer cents.
import { isPaySchedule, paycheckToMonthAndYear, type PaySchedule } from "./paycheck";

export type BenefitEvery = "paycheck" | "month";

export interface Benefit {
  name: string;
  /** As typed: a paycheck's or a month's amount, by `every`. */
  amountCents: number;
  every: BenefitEvery;
  /** Taken before tax (lowers the taxed wages). */
  beforeTax: boolean;
}

/** The most rows a list holds: far more than a pay stub carries. */
const MOST = 30;

/** One row a month: itself, or a paycheck's amount turned into a month by the schedule. */
export function benefitMonthlyCents(b: Benefit, schedule: PaySchedule | null): number {
  return b.every === "paycheck" && schedule ? paycheckToMonthAndYear(b.amountCents, schedule).monthlyCents : b.amountCents;
}

/** Every row a month, and the part of it taken after tax. */
export function benefitsTotals(list: Benefit[], schedule: PaySchedule | null): { monthlyCents: number; afterTaxMonthlyCents: number } {
  let monthlyCents = 0;
  let afterTaxMonthlyCents = 0;
  for (const b of list) {
    const m = benefitMonthlyCents(b, schedule);
    monthlyCents += m;
    if (!b.beforeTax) afterTaxMonthlyCents += m;
  }
  return { monthlyCents, afterTaxMonthlyCents };
}

/** Why a list cannot be saved, in plain words; null when it can. `schedule` is the one in force after the save. */
export function benefitsProblem(list: unknown, schedule: unknown): string | null {
  if (!Array.isArray(list)) return "Benefits are not recognized.";
  if (list.length > MOST) return "Thirty benefits at most.";
  for (const raw of list) {
    if (!raw || typeof raw !== "object") return "Benefits are not recognized.";
    const b = raw as Record<string, unknown>;
    if (typeof b.name !== "string" || (b.every !== "paycheck" && b.every !== "month") || typeof b.beforeTax !== "boolean") return "Benefits are not recognized.";
    if (b.name.trim() === "") return "Give each benefit a name.";
    if (typeof b.amountCents !== "number" || !Number.isInteger(b.amountCents)) return "Type each benefit as dollars, such as 500.00.";
    if (b.amountCents < 0) return "A benefit cannot be below zero.";
    if (b.every === "paycheck" && !isPaySchedule(schedule)) return "Pick how often you are paid before typing a benefit a paycheck.";
  }
  return null;
}

/** Only the four fields, the name trimmed (and kept short), so nothing else in a request is stored. */
export function cleanBenefits(list: Benefit[]): Benefit[] {
  return list.map((b) => ({ name: b.name.trim().slice(0, 80), amountCents: Math.round(b.amountCents), every: b.every, beforeTax: b.beforeTax }));
}
