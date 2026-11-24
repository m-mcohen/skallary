// src/domain/budget-income.ts -- a line's budget in one month, as the Budget screen
// shows it.
// - Paychecks reads the money in from Settings, Salary for that month: what lands in
//   the bank, the figure the Forecast uses. Before the salary starts there is none.
// - Charity is the larger of its own amount and the maaser on that month's pay, as the
//   Forecast counts it (cash-forecast.ts).
// - A planned big month adds to its line in its month only.
// - An income line other than Paychecks has a budget only when the user set one.
// Pure.
import { forecastEarners, monthIncome } from "./cash-forecast";
import { resolveMonthlyPlan } from "./budget";
import { isIncomeCategory } from "./dedup";
import { isInvestmentIncomeCategory, isSavingCategory } from "./savings";
import { MAASER_CATEGORY } from "./scenario";
import type { LineSide } from "./budget-colors";
import type { BigMonth, BudgetChange, BudgetLine } from "./plan-types";
import type { SalaryAssumptions } from "./salary";

export const PAYCHECKS_LINE = "Paychecks";

/** Spending or income; null for a saving line, which the Budget never shows. */
export function sideOf(name: string): LineSide | null {
  if (isSavingCategory(name)) return null;
  return isIncomeCategory(name) || isInvestmentIncomeCategory(name) ? "income" : "spending";
}

export function salaryCovers(a: SalaryAssumptions, period: string): boolean {
  return [a.currentSalary, a.additionalSalary].some((s) => !!s && s.fromPeriod <= period);
}

/** The month's pay from Settings, Salary (null before any salary starts) and the maaser on it. */
export function settingsMoneyIn(a: SalaryAssumptions, period: string): { paycheckCents: number | null; maaserCents: number } {
  if (!salaryCovers(a, period)) return { paycheckCents: null, maaserCents: 0 };
  const pay = monthIncome(period, forecastEarners(a, null, period), a);
  return { paycheckCents: pay.bankCents, maaserCents: pay.maaserCents };
}

export interface LineBudget {
  /** The line's budget that month, big months included; null = no budget (shown blank). */
  cents: number | null;
  from: "budget" | "settings" | "maaser" | "none";
  /** The part of `cents` that is planned big months. */
  bigMonthCents: number;
}

export function lineBudget(
  input: { lines: BudgetLine[]; changes: BudgetChange[]; bigMonths: BigMonth[]; salary: SalaryAssumptions },
  line: string,
  side: LineSide,
  month: string,
): LineBudget {
  if (side === "income" && line === PAYCHECKS_LINE) {
    const pay = settingsMoneyIn(input.salary, month).paycheckCents;
    return pay === null ? { cents: null, from: "none", bigMonthCents: 0 } : { cents: pay, from: "settings", bigMonthCents: 0 };
  }
  const rows = input.lines.filter((l) => l.planningCategory === line);
  const bigMonthCents = side === "spending"
    ? input.bigMonths.filter((b) => b.planningCategory === line && b.month === month).reduce((s, b) => s + b.amountCents, 0)
    : 0;
  const changed = input.changes.some((c) => c.planningCategory === line);
  const cleared = side === "income" && !changed
    && rows.every((l) => (l.period === null || l.period === "") && l.amountCents === 0 && l.source !== "you");
  // Charity reads the maaser even with no budget row of its own.
  const maaser = line === MAASER_CATEGORY ? settingsMoneyIn(input.salary, month).maaserCents : 0;
  if ((rows.length === 0 || cleared) && bigMonthCents === 0 && maaser <= 0) return { cents: null, from: "none", bigMonthCents: 0 };
  let cents = rows.length === 0 ? 0 : resolveMonthlyPlan(input.lines, line, month);
  let from: LineBudget["from"] = "budget";
  if (line === MAASER_CATEGORY) {
    if (maaser > cents) {
      cents = maaser;
      from = "maaser";
    }
  }
  return { cents: cents + bigMonthCents, from, bigMonthCents };
}
