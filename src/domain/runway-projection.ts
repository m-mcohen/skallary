import type { BudgetLine, PlannedEvent } from "./plan-types";
import { resolveMonthlyPlan } from "./budget";
import { isIncomeCategory } from "./dedup";
import { monthIndex, periodFromIndex } from "./period";

export const INCOME_CATEGORY = "Income";
export const RUNWAY_HORIZON_MONTHS = 24;

/**
 * Net (income - expense) cents per month for `horizonMonths` months strictly
 * AFTER asOfDate's month, using budget defaults/overrides (resolveMonthlyPlan).
 * Independent of any plan's endDate, so runway can project to cash-out.
 * Categories are those present in budgetLines (future months have no actuals).
 *
 * `plannedEvents` (default []) are future one-time expenses that land in a
 * specific month and further reduce that month's net, on top of the
 * budget-line income/expense math. No screen passes any since the Wish List
 * became one-time items that never reach a projection; kept as
 * a general input.
 */
export function projectFutureNet(
  budgetLines: BudgetLine[],
  asOfDate: string,
  horizonMonths: number,
  plannedEvents: PlannedEvent[] = []
): { period: string; netCents: number }[] {
  const cats = [...new Set(budgetLines.map((l) => l.planningCategory))];
  const out: { period: string; netCents: number }[] = [];
  const asOf = monthIndex(asOfDate.slice(0, 7));
  for (let i = 0; i < horizonMonths; i++) {
    const period = periodFromIndex(asOf + i + 1);
    let income = 0, expense = 0;
    for (const cat of cats) {
      const amt = resolveMonthlyPlan(budgetLines, cat, period);
      if (isIncomeCategory(cat)) income += amt; else expense += amt;
    }
    const eventsCents = plannedEvents
      .filter((e) => e.period === period)
      .reduce((sum, e) => sum + e.amountCents, 0);
    out.push({ period, netCents: income - expense - eventsCents });
  }
  return out;
}

/**
 * Total budgeted income across the given months, over EVERY income category
 * (the same isIncomeCategory test the projection itself uses), so "is any
 * income modeled?" cannot disagree with the projection it describes. The
 * Runway screen used to check only the line named exactly "Income".
 */
export function projectedIncomeCents(budgetLines: BudgetLine[], periods: string[]): number {
  const incomeCategories = [...new Set(budgetLines.map((l) => l.planningCategory))].filter(isIncomeCategory);
  let total = 0;
  for (const period of periods) for (const c of incomeCategories) total += resolveMonthlyPlan(budgetLines, c, period);
  return total;
}
