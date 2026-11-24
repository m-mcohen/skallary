// src/domain/income.ts
//
// Real income: the user's
// current salary and an optional additional salary, kept in Settings, Salary.
// The Forecast screen runs them against the budget's costs; Salary needed is
// the user's salary given the additional one (src/domain/salary.ts).
//
// The user's salary is either a gross yearly base salary, turned into take-home the
// way the ladder does it (tax, the premium, maaser), or the monthly amount
// that lands in the bank, typed as it is. The additional salary is either a
// W-2 salary taxed with the user's (one return when filing jointly, else its own single return), or a monthly amount with no tax math.
// Each counts from its start month. Pure; integer cents.
import type { PaySchedule, PaycheckFigures } from "./paycheck";
import type { Benefit } from "./benefits";

export type CurrentSalary =
  | { kind: "gross"; grossAnnualCents: number; fromPeriod: string }
  | { kind: "take-home"; monthlyCents: number; fromPeriod: string };

export type AdditionalSalary =
  | { kind: "w2"; grossAnnualCents: number; fromPeriod: string }
  | { kind: "monthly"; monthlyCents: number; fromPeriod: string };

/**
 * What Settings, Salary saves for income: either may be null (none). On the server, a request
 * that leaves either salary out leaves it as saved, as for every field below; Settings, Salary always sends both.
 */
export interface IncomeSettings {
  /**
   * The benefits the user lists. Absent leaves what is saved;
   * null clears the list, and the older premium figure (or the estimate) reads again.
   */
  benefits?: Benefit[] | null;
  currentSalary: CurrentSalary | null;
  additionalSalary: AdditionalSalary | null;
  /**
   * Firm yearly tax figures for the current salary: each
   * null until typed. Null clears both; absent leaves what is saved as it is.
   */
  firmTaxes?: { federalAnnualCents: number | null; payrollAnnualCents: number | null } | null;
  /**
   * How often the user is paid. Absent leaves what is saved; null means none chosen.
   * A paycheck figure needs one.
   */
  paySchedule?: PaySchedule | null;
  /**
   * The federal income tax, Social Security and Medicare, and health premium from one paycheck,
   * each null until typed. Absent leaves what is saved. A typed figure replaces the older
   * monthly premium or yearly tax figure it stands for.
   */
  paycheck?: PaycheckFigures | null;
}

/** Why firm tax figures cannot be saved, in plain words; null when they can. */
export function firmTaxesProblem(f: unknown): string | null {
  if (f === null || f === undefined) return null;
  if (typeof f !== "object") return "Firm tax figures are not recognized.";
  for (const v of [(f as Record<string, unknown>).federalAnnualCents, (f as Record<string, unknown>).payrollAnnualCents]) {
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) return "Type each firm figure as dollars a year, or leave it blank to estimate.";
    if (v < 0) return "A firm tax figure cannot be below zero.";
  }
  return null;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const positive = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Why the user's current salary cannot be saved, in plain words; null when it can. */
export function currentSalaryProblem(s: CurrentSalary): string | null {
  if (s.kind === "gross") {
    if (!positive(s.grossAnnualCents)) return "Type your salary as dollars a year, above zero.";
  } else if (s.kind === "take-home") {
    if (!positive(s.monthlyCents)) return "Type the monthly pay into the bank as dollars, above zero.";
  } else {
    return "That kind of salary is not recognized.";
  }
  if (!PERIOD.test(s.fromPeriod ?? "")) return "Pick the month your salary starts.";
  return null;
}

/** Why an additional salary cannot be saved, in plain words; null when it can. */
export function additionalSalaryProblem(s: AdditionalSalary): string | null {
  if (s.kind === "w2") {
    if (!positive(s.grossAnnualCents)) return "Type the additional salary as dollars a year, above zero.";
  } else if (s.kind === "monthly") {
    if (!positive(s.monthlyCents)) return "Type the additional monthly amount as dollars, above zero.";
  } else {
    return "That kind of additional salary is not recognized.";
  }
  if (!PERIOD.test(s.fromPeriod ?? "")) return "Pick the month the additional salary starts.";
  return null;
}

/** Why Settings, Salary's income cannot be saved; null when it can. */
export function incomeProblem(current: CurrentSalary | null, additional: AdditionalSalary | null): string | null {
  if (current !== null && current !== undefined) {
    if (typeof current !== "object") return "That kind of salary is not recognized.";
    const p = currentSalaryProblem(current);
    if (p) return p;
  }
  if (additional !== null && additional !== undefined) {
    if (typeof additional !== "object") return "That kind of additional salary is not recognized.";
    const p = additionalSalaryProblem(additional);
    if (p) return p;
  }
  return null;
}
