// src/domain/equation.ts
//
// The top bar's statement: into the bank, less the charity pot's amount put away, less the budget,
// equals left over, for a month or the budget year. Every figure comes from
// the Budget screen's own functions (budgetLeftOver, lineBudget, settingsMoneyIn, sumRollups), so the
// bar and the Budget screen cannot disagree.
import { budgetLeftOver, sumRollups, type BudgetInputs, type Sums } from "./budget-month";
import { lineBudget, PAYCHECKS_LINE, salaryCovers, settingsMoneyIn, sideOf } from "./budget-income";
import { MAASER_CATEGORY } from "./maaser-pot";
import { effectiveMaaserRate, potIsOn, potLabel, potMonthCents } from "./charity-pot";
import { addMonths } from "./scenario";
import { forecastEarners, monthIncome } from "./cash-forecast";
import { currentSalaryBreakdownRaw, jointBreakdownRaw, roundAll, type SalaryAssumptions } from "./salary";
import { assumptionsUnder, whatIfSalaryStart, type WhatIf } from "./what-if";
import type { StatementLine } from "./income-statement";
import type { Plan } from "./plan-types";

export type EquationInput = Pick<BudgetInputs, "prepared" | "accounts" | "mapping" | "lines" | "changes" | "bigMonths" | "salary"> & {
  /** A what-if switched on: its salary prices this month and later (finished months stay actual). */
  whatIf?: WhatIf | null;
};

/** The month's pay as the active view sees it: Settings, Salary, or the what-if laid over it. */
function payFor(input: EquationInput, month: string, today: string): { bankCents: number | null; maaserCents: number } {
  const w = input.whatIf;
  if (!w) {
    const pay = settingsMoneyIn(input.salary, month);
    return { bankCents: pay.paycheckCents, maaserCents: pay.maaserCents };
  }
  // The same earner choice monthIncome makes: a what-if's salary from its month, the real one until then
  // .
  const e = forecastEarners(input.salary, w, addMonths(today.slice(0, 7), 1));
  const on = (x: { fromPeriod: string } | null | undefined) => !!x && x.fromPeriod <= month;
  const covered = on(e.main) || on(e.mainBefore) || on(e.other) || on(e.otherBefore);
  if (!covered) return { bankCents: null, maaserCents: 0 };
  return monthIncome(month, e, input.salary);
}

/** The budget's income lines other than Paychecks (which Settings, Salary or a what-if prices), that month. */
function otherIncomeCents(input: EquationInput, month: string): number {
  const names = new Set([...input.lines.map((l) => l.planningCategory), ...input.bigMonths.map((b) => b.planningCategory)]);
  let total = 0;
  for (const name of names) {
    if (name === PAYCHECKS_LINE || sideOf(name) !== "income") continue;
    total += lineBudget(input, name, "income", month).cents ?? 0;
  }
  return total;
}

/** Settings, Salary with no salary at all: a line's own budget, with no raise to the pot's month. */
const NO_PAY = (a: SalaryAssumptions): SalaryAssumptions => ({ ...a, currentSalary: null, additionalSalary: null });

export interface EquationTerms {
  /** Pay into the bank; null when no salary is in force. */
  bankCents: number | null;
  /** The charity pot's amount put away; null with bank. */
  maaserCents: number | null;
  /** The spending budget less the pot term (charity above the pot stays here). */
  budgetCents: number;
  /** Bank less the whole spending budget; null with bank. */
  leftOverCents: number | null;
  /** Actual spending to date, the Charity line left out. */
  spentSoFarCents: number;
  /** The spending budget with the Charity line left out, what Spent so far is measured against. */
  spentAgainstCents: number;
  bigMonths: { label: string; cents: number }[];
}

export interface MonthEquation extends EquationTerms {
  kind: "month";
  month: string;
  /** Today's day of the month while the month is in progress; null otherwise. */
  day: number | null;
  daysInMonth: number;
  /** The month, when Settings, Salary has no salary for it. */
  noSalaryMonth: string | null;
}

const daysIn = (month: string): number => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** Spending per month to `today`, Charity left out. */
function spendingExCharity(sums: Sums, month: string): number {
  let total = 0;
  for (const [k, byMonth] of sums) {
    if (!k.startsWith("spending|") || k === `spending|${MAASER_CATEGORY}`) continue;
    total += byMonth.get(month) ?? 0;
  }
  return total;
}

/** The rows to `today` rolled up by line and month: the part of a statement that is the same for every month. */
function rollupsToDate(input: EquationInput, today: string): Sums {
  return sumRollups(input.prepared.filter((t) => t.date <= today), input.accounts, input.mapping);
}

/** `toDateSums` lets yearEquation roll the rows up once for all its months; alone, a month rolls them up itself. */
export function monthEquation(input: EquationInput, month: string, today: string, toDateSums: Sums = rollupsToDate(input, today)): MonthEquation {
  const budget = budgetLeftOver(input, month);
  let bank = budget.incomeCents;
  let spending = budget.spendingCents;
  let maaser = bank === null ? null : settingsMoneyIn(input.salary, month).maaserCents;
  let charityBudget = lineBudget(input, MAASER_CATEGORY, "spending", month).cents ?? 0;
  if (input.whatIf) {
    // The Budget screen raises the Charity line to the pot's month from Settings; under a what-if, to the
    // what-if's. As lineBudget does: the line's own amount raised to it, then its big months on top.
    const pay = payFor(input, month, today);
    const own = lineBudget({ ...input, salary: NO_PAY(input.salary) }, MAASER_CATEGORY, "spending", month);
    const raised = Math.max((own.cents ?? 0) - own.bigMonthCents, pay.maaserCents) + own.bigMonthCents;
    spending += raised - charityBudget;
    charityBudget = raised;
    // Budgeted income besides the paycheck stays in the bank term.
    bank = pay.bankCents === null ? null : pay.bankCents + otherIncomeCents(input, month);
    maaser = bank === null ? null : pay.maaserCents;
  }
  const inProgress = today.slice(0, 7) === month;
  return {
    kind: "month",
    month,
    bankCents: bank,
    maaserCents: maaser,
    budgetCents: spending - (maaser ?? 0),
    leftOverCents: bank === null ? null : bank - spending,
    spentSoFarCents: spendingExCharity(toDateSums, month),
    spentAgainstCents: spending - charityBudget,
    bigMonths: input.bigMonths.filter((b) => b.month === month).map((b) => ({ label: b.label, cents: b.amountCents })),
    day: inProgress ? Number(today.slice(8, 10)) : null,
    daysInMonth: daysIn(month),
    noSalaryMonth: bank === null ? month : null,
  };
}

export interface YearEquation extends EquationTerms {
  kind: "year";
  year: string;
  /** Set when Settings, Salary covers only part of the year: "Jan to Nov actual, Dec budget". */
  mixedNote: string | null;
  /** This month and later months with no salary in Settings (they add no pay). */
  monthsWithoutPay: string[];
}

/** Every month of the budget year, "YYYY-MM", oldest first. */
function monthsOf(plan: Pick<Plan, "startDate" | "endDate">): string[] {
  const months: string[] = [];
  for (let m = plan.startDate.slice(0, 7); m <= plan.endDate.slice(0, 7); m = addMonths(m, 1)) months.push(m);
  return months;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];
const span = (from: string, to: string) => (from === to ? short(from) : `${short(from)} to ${short(to)}`);

/**
 * The budget year: a finished month counts what happened (as the Year tab does); this month and later
 * count the budget, because payroll lands at month end and the year must not drop this month's pay
 * before payday. A percent pot takes its share of each finished month's income; a set-amount pot its month.
 */
export function yearEquation(input: EquationInput, plan: Pick<Plan, "startDate" | "endDate">, today: string): YearEquation {
  const thisMonth = today.slice(0, 7);
  const months = monthsOf(plan);
  const sums = sumRollups(input.prepared, input.accounts, input.mapping);
  const toDateSums = rollupsToDate(input, today);
  const cell = (k: string, m: string) => sums.get(k)?.get(m) ?? 0;
  let bank = 0;
  let maaser = 0;
  let spending = 0;
  let spent = 0;
  let against = 0;
  const withoutPay: string[] = [];
  for (const m of months) {
    if (m < thisMonth) {
      let income = 0;
      let out = 0;
      for (const k of sums.keys()) {
        if (k.startsWith("income|")) income += cell(k, m);
        else if (k.startsWith("spending|")) out += cell(k, m);
      }
      const exCharity = spendingExCharity(sums, m);
      bank += income;
      const pot = input.salary.pot;
      maaser += pot && pot.on && pot.kind !== "percent" ? potMonthCents(pot, m, 0) : Math.round(effectiveMaaserRate(pot, input.salary.maaserRate) * income);
      spending += out;
      spent += exCharity;
      against += exCharity;
      continue;
    }
    const e = monthEquation(input, m, today, toDateSums);
    if (e.bankCents === null) withoutPay.push(m);
    bank += e.bankCents ?? 0;
    maaser += e.maaserCents ?? 0;
    spending += e.budgetCents + (e.maaserCents ?? 0);
    if (m === thisMonth) spent += e.spentSoFarCents;
    against += e.spentAgainstCents;
  }
  const partly = months.some((m) => salaryCovers(input.salary, m)) && months.some((m) => !salaryCovers(input.salary, m));
  const finished = months.filter((m) => m < thisMonth);
  const coming = months.filter((m) => m >= thisMonth);
  const mixedNote = !partly
    ? null
    : [finished.length ? `${span(finished[0], finished[finished.length - 1])} actual` : null, coming.length ? `${span(coming[0], coming[coming.length - 1])} budget` : null]
        .filter(Boolean)
        .join(", ");
  return {
    kind: "year",
    year: months[0].slice(0, 4),
    bankCents: bank,
    maaserCents: maaser,
    budgetCents: spending - maaser,
    leftOverCents: bank - spending,
    spentSoFarCents: spent,
    spentAgainstCents: against,
    bigMonths: input.bigMonths.filter((b) => months.includes(b.month)).map((b) => ({ label: b.label, cents: b.amountCents })),
    mixedNote,
    monthsWithoutPay: withoutPay,
  };
}

/** What lands in the bank for a month, split the way monthIncome splits it (same earner choice). */
interface PayParts {
  hisGross: number | null;
  otherW2: number;
  /** A what-if's own salary prices this month (so no firm tax figures). */
  ownSalary: boolean;
  /** A typed take-home salary, as it lands. */
  takeHomeTypedCents: number;
  /** An additional monthly amount, as it lands. */
  otherMonthlyCents: number;
}

function payParts(input: EquationInput, period: string): PayParts {
  const w = input.whatIf;
  const ownSalary = !!w && w.salaryGrossAnnualCents !== null && (whatIfSalaryStart(w, input.salary) ?? addMonths(period, 1)) <= period;
  const real = input.salary.currentSalary;
  const hisGross = ownSalary ? w!.salaryGrossAnnualCents : real && real.kind === "gross" && real.fromPeriod <= period ? real.grossAnnualCents : null;
  // The additional salary and the typed amounts: the same earner choice monthIncome makes (a what-if's
  // additional salary counts from its own start month; the real one until then).
  const e = forecastEarners(input.salary, w, addMonths(period, 1));
  const on = (x: { fromPeriod: string } | null | undefined) => !!x && x.fromPeriod <= period;
  const main = on(e.main) ? e.main : on(e.mainBefore) ? e.mainBefore ?? null : null;
  const added = on(e.other) ? e.other : on(e.otherBefore) ? e.otherBefore ?? null : null;
  const otherW2 = added && added.kind === "w2" ? added.grossAnnualCents : 0;
  return {
    hisGross,
    otherW2,
    ownSalary,
    takeHomeTypedCents: main && main.kind === "take-home" ? main.monthlyCents : 0,
    otherMonthlyCents: added && added.kind === "monthly" ? added.monthlyCents : 0,
  };
}

/**
 * True when the steps for these months use estimated taxes: some month has W-2 pay and its tax is not
 * both of the user's typed firm figures (a what-if's salary and an additional W-2 salary are always
 * estimated; a typed take-home has no tax in it).
 */
export function payStepsEstimated(input: EquationInput, periods: string[]): boolean {
  const f = input.salary.firmTaxes;
  const firm = !!f && f.federalAnnualCents != null && f.payrollAnnualCents != null;
  return periods.some((period) => {
    if (payFor(input, period, `${period}-01`).bankCents === null) return false;
    const p = payParts(input, period);
    if (p.hisGross === null && p.otherW2 === 0) return false;
    return !(firm && !p.ownSalary && p.hisGross !== null && p.otherW2 === 0);
  });
}

/** The Year steps' version: only this month and later are worked from gross pay. */
export function yearPayStepsEstimated(input: EquationInput, plan: Pick<Plan, "startDate" | "endDate">, today: string): boolean {
  const thisMonth = today.slice(0, 7);
  return payStepsEstimated(input, monthsOf(plan).filter((m) => m >= thisMonth));
}

/**
 * The steps from gross pay to take-home behind the "into the bank" info point, a month or a year:
 * gross, taxes, benefits, then into the bank (the month's pay, as the equation shows it), maaser and
 * take-home. Null when no salary is in force that month. The lines above "into the bank" add up to it
 * exactly: any rounding cent lands on the federal income tax line (the one line that is an estimate
 * of a cent-level figure anyway).
 */
export function paySteps(input: EquationInput, period: string, view: "monthly" | "yearly"): StatementLine[] | null {
  const today = `${period}-01`;
  const pay = payFor(input, period, today);
  if (pay.bankCents === null) return null;
  const k = view === "yearly" ? 12 : 1;
  const w = input.whatIf;
  const under = assumptionsUnder(input.salary, w);
  const { hisGross, otherW2, ownSalary, takeHomeTypedCents, otherMonthlyCents } = payParts(input, period);
  const per = (annual: number) => (view === "yearly" ? annual : Math.round(annual / 12));
  const lines: StatementLine[] = [];
  if (hisGross !== null || otherW2 > 0) {
    // Firm tax figures belong to the user's real salary only, as in monthIncome.
    const b = roundAll(!ownSalary ? currentSalaryBreakdownRaw(hisGross, otherW2, 0, 0, under) : jointBreakdownRaw(hisGross, otherW2, 0, 0, under));
    lines.push({ id: "gross", label: "Gross pay", cents: per(b.grossAnnualCents), total: false });
    if (b.otherGrossAnnualCents > 0) lines.push({ id: "other-gross", label: "Additional salary (gross)", cents: per(b.otherGrossAnnualCents), total: false });
    lines.push(
      { id: "federal", label: "Federal income tax", cents: -per(b.federalAnnualCents), total: false },
      { id: "payroll", label: "Social Security and Medicare", cents: -per(b.ficaAnnualCents), total: false },
      // Typed from a pay stub only; state and local taxes are never estimated.
      ...(b.otherTaxesAnnualCents > 0 ? [{ id: "other-taxes", label: "State and local taxes", cents: -per(b.otherTaxesAnnualCents), total: false }] : []),
      { id: "premium", label: "Benefits", cents: -per(b.premiumAnnualCents), total: false },
    );
  }
  if (takeHomeTypedCents > 0) lines.push({ id: "take-home-typed", label: "Take-home typed in Settings", cents: takeHomeTypedCents * k, total: false });
  if (otherMonthlyCents > 0) lines.push({ id: "other-net", label: "Additional monthly amount", cents: otherMonthlyCents * k, total: false });
  const otherIncome = otherIncomeCents(input, period) * k;
  if (otherIncome !== 0) lines.push({ id: "other-income", label: "Other budgeted income", cents: otherIncome, total: false });
  const bank = pay.bankCents * k + otherIncome;
  // Any rounding cent lands on the federal line; with none (no W-2 pay), on the first line so the sum still holds.
  const residual = bank - lines.reduce((t, l) => t + l.cents, 0);
  const landing = lines.find((l) => l.id === "federal") ?? lines[0];
  if (landing) landing.cents += residual;
  const maaser = pay.maaserCents * k;
  lines.push({ id: "bank", label: "Into the bank", cents: bank, total: true }, ...potStep(input, maaser), { id: "take-home", label: "Take-home", cents: bank - maaser, total: true });
  return lines;
}

/**
 * The Year statement's pay steps: what already landed in finished
 * months on one line, then this month and later from gross pay, summed month by month, so the bank
 * line is exactly the Year figure's "into the bank". Null when nothing lands all year.
 */
export function yearPaySteps(input: EquationInput, plan: Pick<Plan, "startDate" | "endDate">, today: string): StatementLine[] | null {
  const y = yearEquation(input, plan, today);
  if (y.bankCents === null || y.bankCents === 0) return null;
  const thisMonth = today.slice(0, 7);
  const months = monthsOf(plan);
  const finished = months.filter((m) => m < thisMonth);
  const coming = months.filter((m) => m >= thisMonth);
  const lines: StatementLine[] = [];
  if (finished.length > 0) {
    const sums = sumRollups(input.prepared, input.accounts, input.mapping);
    let landed = 0;
    for (const [k, byMonth] of sums) if (k.startsWith("income|")) for (const m of finished) landed += byMonth.get(m) ?? 0;
    lines.push({ id: "landed", label: `Already landed, ${span(finished[0], finished[finished.length - 1])}`, cents: landed, total: false });
  }
  const summed = new Map<string, StatementLine>();
  for (const m of coming) {
    for (const l of paySteps(input, m, "monthly") ?? []) {
      if (l.id === "bank" || l.id === "maaser" || l.id === "take-home") continue;
      const prev = summed.get(l.id);
      summed.set(l.id, { ...l, cents: (prev?.cents ?? 0) + l.cents });
    }
  }
  if (coming.length > 0) {
    const when = span(coming[0], coming[coming.length - 1]);
    for (const l of summed.values()) lines.push({ ...l, label: `${l.label}, ${when}` });
  }
  lines.push(
    { id: "bank", label: "Into the bank", cents: y.bankCents, total: true },
    ...potStep(input, y.maaserCents ?? 0),
    { id: "take-home", label: "Take-home", cents: y.bankCents - (y.maaserCents ?? 0), total: true },
  );
  return lines;
}

/** The pot's step under "into the bank", named as the user named the pot; none while the pot is off. */
function potStep(input: EquationInput, cents: number): StatementLine[] {
  const pot = input.salary.pot;
  if (pot !== undefined && !potIsOn(pot)) return [];
  return [{ id: "maaser", label: `${potLabel(pot)}, put away`, cents: -cents, total: false }];
}
