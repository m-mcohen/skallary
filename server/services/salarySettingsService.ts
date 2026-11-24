// server/services/salarySettingsService.ts
//
// The salary assumptions, in app_settings (migrations/0008). Missing keys read as nothing
// assumed: no benefits, no pot rate, and no tax profile (the screens then show the
// set-this-up card in place of any estimated tax).
import { annualBillsCents } from "../../src/domain/yearly-costs.js";
import { yearlyCostsRepository } from "../repositories/yearlyCostsRepository.js";
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";
import { DEFAULT_SALARY_ASSUMPTIONS, type SalaryAssumptions } from "../../src/domain/salary.js";
import { firmTaxesProblem, incomeProblem, type AdditionalSalary, type CurrentSalary, type IncomeSettings } from "../../src/domain/income.js";
import { isPaySchedule, paycheckProblem, salaryFigures, type PaySchedule, type PaycheckFigures } from "../../src/domain/paycheck.js";
import { benefitsProblem, benefitsTotals, cleanBenefits, type Benefit } from "../../src/domain/benefits.js";
import { charityPotFromSetting, composeCharityPot, effectiveMaaserRate, CHARITY_POT_KEY } from "../../src/domain/charity-pot.js";
import { getMaaserFloorCents, getTaxProfile } from "./settingsService.js";

const PREMIUM_KEY = "salary_premium_monthly_cents";
const MAASER_KEY = "salary_maaser_rate_bps";
const CHILDREN_KEY = "salary_child_count";
// The child count is also the tax profile's (settingsService getTaxProfile reads the same key).
// The user's current salary and the additional salary,
// each stored as JSON under its own key; an empty value means none.
const CURRENT_KEY = "salary_current";
const ADDITIONAL_KEY = "salary_additional";
// Firm yearly federal income tax and Social Security and
// Medicare for the current salary, as JSON; an empty value means estimated.
const FIRM_KEY = "salary_firm_taxes";
// How often the user is paid, and the
// federal income tax, Social Security and Medicare, and premium from one paycheck (JSON; each
// null until typed). The read turns them into the monthly premium and the yearly firm taxes;
// until a paycheck figure is typed, the older monthly premium (PREMIUM_KEY) and yearly taxes
// (FIRM_KEY) read exactly as before. No migration: nothing stored is rewritten until the user saves.
const SCHEDULE_KEY = "salary_pay_schedule";
const PAYCHECK_KEY = "salary_paycheck_figures";
// Benefits: the list the user types, as JSON; an empty value means no list, and the
// older premium figure above (or the estimate) reads as it always has. The older figures
// are never rewritten, so clearing the list brings them back. No migration.
const BENEFITS_KEY = "salary_benefits";

function readJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

export function getSalarySettings(): SalaryAssumptions {
  const repo = sqliteFinanceRepository();
  const n = (key: string, fallback: number): number => {
    const raw = repo.getSetting(key);
    // An empty value is a cleared field: the estimate.
    const v = raw === null || raw.trim() === "" ? NaN : Number(raw);
    return Number.isFinite(v) ? v : fallback;
  };
  const premiumRaw = repo.getSetting(PREMIUM_KEY);
  const olderPremium = premiumRaw !== null && premiumRaw.trim() !== "" && Number.isFinite(Number(premiumRaw)) ? Number(premiumRaw) : null;
  const firm = readJson<{ federalAnnualCents: number | null; payrollAnnualCents: number | null }>(repo.getSetting(FIRM_KEY));
  const olderFirm = firm && (firm.federalAnnualCents != null || firm.payrollAnnualCents != null) ? { federalAnnualCents: firm.federalAnnualCents ?? null, payrollAnnualCents: firm.payrollAnnualCents ?? null } : null;
  const { paySchedule, paycheck } = readPaycheck();
  const figures = salaryFigures({ paySchedule, paycheck, olderPremiumMonthlyCents: olderPremium, olderFirmTaxes: olderFirm });
  // A list, when the user has one, is the premium: its total a month, the after-tax part apart.
  const benefits = readBenefits();
  const listed = benefits ? benefitsTotals(benefits, paySchedule) : null;
  // The charity pot from its three keys; null (off) when none is saved. Its rate is the share of pay.
  const pot = composeCharityPot(charityPotFromSetting(repo.getSetting(CHARITY_POT_KEY)), repo.getSetting(MAASER_KEY), getMaaserFloorCents());
  // Filing status and children; either null means not set up, and the credit then counts no child.
  const tax = getTaxProfile();
  return {
    premiumMonthlyCents: listed ? listed.monthlyCents : figures.premiumMonthlyCents ?? DEFAULT_SALARY_ASSUMPTIONS.premiumMonthlyCents,
    premiumFromSettings: listed !== null || figures.premiumMonthlyCents !== null,
    afterTaxBenefitsMonthlyCents: listed ? listed.afterTaxMonthlyCents : 0,
    benefits,
    firmTaxes: figures.firmTaxes,
    paySchedule,
    paycheck,
    ...((bills) => (bills ? { yearlyBillsAnnualCents: bills } : {}))(annualBillsCents(yearlyCostsRepository().listBills())), // absent = 0, as before any bill
    maaserRate: effectiveMaaserRate(pot, n(MAASER_KEY, DEFAULT_SALARY_ASSUMPTIONS.maaserRate * 10_000) / 10_000),
    pot,
    tax,
    children: tax.children ?? 0,
    currentSalary: readJson<CurrentSalary>(repo.getSetting(CURRENT_KEY)),
    additionalSalary: readJson<AdditionalSalary>(repo.getSetting(ADDITIONAL_KEY)),
  };
}

/** The stored benefits list; none, or anything unreadable, reads as no list. */
function readBenefits(): Benefit[] | null {
  const raw = sqliteFinanceRepository().getSetting(BENEFITS_KEY);
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    // A stored row typed a paycheck reads as a month when no schedule is in force (src/domain/benefits.ts).
    return benefitsProblem(v, "monthly") === null ? cleanBenefits(v as Benefit[]) : null;
  } catch {
    return null;
  }
}

/** The stored schedule and paycheck figures; anything unreadable reads as none. */
function readPaycheck(): { paySchedule: PaySchedule | null; paycheck: PaycheckFigures | null } {
  const repo = sqliteFinanceRepository();
  const raw = repo.getSetting(SCHEDULE_KEY);
  const paySchedule = isPaySchedule(raw) ? raw : null;
  const p = readJson<Partial<PaycheckFigures>>(repo.getSetting(PAYCHECK_KEY));
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const other = num(p?.otherTaxesCents);
  // Other taxes withheld are carried only when typed, so a stored paycheck without them reads as before.
  const paycheck = p ? { federalCents: num(p.federalCents), payrollCents: num(p.payrollCents), premiumCents: num(p.premiumCents), ...(other !== null ? { otherTaxesCents: other } : {}) } : null;
  return { paySchedule, paycheck };
}

/** Only the fields each kind carries, so nothing else in a request is stored. */
function cleanCurrent(s: CurrentSalary): CurrentSalary {
  return s.kind === "gross"
    ? { kind: "gross", grossAnnualCents: Math.round(s.grossAnnualCents), fromPeriod: s.fromPeriod }
    : { kind: "take-home", monthlyCents: Math.round(s.monthlyCents), fromPeriod: s.fromPeriod };
}
function cleanAdditional(s: AdditionalSalary): AdditionalSalary {
  return s.kind === "w2"
    ? { kind: "w2", grossAnnualCents: Math.round(s.grossAnnualCents), fromPeriod: s.fromPeriod }
    : { kind: "monthly", monthlyCents: Math.round(s.monthlyCents), fromPeriod: s.fromPeriod };
}

/** Validates, then writes the user's current salary and the additional salary together. Throws in plain words. */
export function setIncomeSettings(body: IncomeSettings): void {
  // Each salary follows the route's rule for every other
  // field. Absent from the body: left as saved; present (null included): written. The check
  // runs on the salaries in force after this save.
  const hasCurrent = !!body && "currentSalary" in body;
  const hasAdditional = !!body && "additionalSalary" in body;
  const current = hasCurrent ? body.currentSalary ?? null : readJson<CurrentSalary>(sqliteFinanceRepository().getSetting(CURRENT_KEY));
  const additional = hasAdditional ? body.additionalSalary ?? null : readJson<AdditionalSalary>(sqliteFinanceRepository().getSetting(ADDITIONAL_KEY));
  // The schedule and paycheck figures in force after this save: what the body says, else what is stored.
  const stored = readPaycheck();
  const hasSchedule = !!body && "paySchedule" in body;
  const hasPaycheck = !!body && "paycheck" in body;
  const schedule = hasSchedule ? body.paySchedule ?? null : stored.paySchedule;
  const hasBenefits = !!body && "benefits" in body && body.benefits !== null && body.benefits !== undefined;
  const problem =
    incomeProblem(current, additional) ??
    firmTaxesProblem(body?.firmTaxes) ??
    paycheckProblem(schedule, hasPaycheck ? body.paycheck : stored.paycheck) ??
    (hasBenefits ? benefitsProblem(body.benefits, schedule) : null);
  if (problem) throw new Error(problem);
  const repo = sqliteFinanceRepository();
  if (hasCurrent) repo.setSetting(CURRENT_KEY, current ? JSON.stringify(cleanCurrent(current)) : "");
  if (hasAdditional) repo.setSetting(ADDITIONAL_KEY, additional ? JSON.stringify(cleanAdditional(additional)) : "");
  // Absent: a save from an older screen leaves the firm figures as they were.
  if (body && "firmTaxes" in body) {
    const f = body.firmTaxes;
    const round = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v));
    const clean = f ? { federalAnnualCents: round(f.federalAnnualCents), payrollAnnualCents: round(f.payrollAnnualCents) } : null;
    repo.setSetting(FIRM_KEY, clean && (clean.federalAnnualCents !== null || clean.payrollAnnualCents !== null) ? JSON.stringify(clean) : "");
  }
  // Absent: left as saved; null: cleared, so the older premium reads again.
  if (body && "benefits" in body) repo.setSetting(BENEFITS_KEY, hasBenefits ? JSON.stringify(cleanBenefits(body.benefits as Benefit[])) : "");
  // Absent: left as saved.
  if (hasSchedule) repo.setSetting(SCHEDULE_KEY, schedule ?? "");
  if (hasPaycheck) {
    const p = body.paycheck;
    const round = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v));
    const otherTaxes = round(p?.otherTaxesCents);
    const clean: PaycheckFigures = { federalCents: round(p?.federalCents), payrollCents: round(p?.payrollCents), premiumCents: round(p?.premiumCents), ...(otherTaxes !== null ? { otherTaxesCents: otherTaxes } : {}) };
    repo.setSetting(PAYCHECK_KEY, clean.federalCents === null && clean.payrollCents === null && clean.premiumCents === null && otherTaxes === null ? "" : JSON.stringify(clean));
    // A typed paycheck figure replaces the older figure it stands for, so a later blank means
    // the estimate. A blank one leaves the older figure in force.
    if (clean.premiumCents !== null) repo.setSetting(PREMIUM_KEY, "");
    if (clean.federalCents !== null || clean.payrollCents !== null) {
      const older = readJson<{ federalAnnualCents: number | null; payrollAnnualCents: number | null }>(repo.getSetting(FIRM_KEY));
      if (older) {
        const left = {
          federalAnnualCents: clean.federalCents !== null ? null : older.federalAnnualCents ?? null,
          payrollAnnualCents: clean.payrollCents !== null ? null : older.payrollAnnualCents ?? null,
        };
        repo.setSetting(FIRM_KEY, left.federalAnnualCents !== null || left.payrollAnnualCents !== null ? JSON.stringify(left) : "");
      }
    }
  }
}

/**
 * Validates, then writes the premium and children together. Throws on a bad value. A premium of
 * null is a cleared field: the estimate stands, and the screens say "estimated". The pot's rate is
 * not written here: the charity settings save it (PUT /api/settings/charity-pot).
 */
export function setSalarySettings(a: { premiumMonthlyCents?: number | null; children: number }): void {
  // Absent: the premium is left as saved (it is typed a paycheck with Save salary).
  const absent = !a || a.premiumMonthlyCents === undefined;
  const cleared = a?.premiumMonthlyCents === null;
  const ok =
    (absent || cleared || (Number.isFinite(a.premiumMonthlyCents) && (a.premiumMonthlyCents as number) >= 0)) &&
    Number.isInteger(a.children) && a.children >= 0 && a.children <= 10;
  if (!ok) throw new Error("Salary assumptions must be a non-negative premium and a whole number of children (0 to 10).");
  const repo = sqliteFinanceRepository();
  if (!absent) repo.setSetting(PREMIUM_KEY, cleared ? "" : String(Math.round(a.premiumMonthlyCents as number)));
  repo.setSetting(CHILDREN_KEY, String(a.children));
}
