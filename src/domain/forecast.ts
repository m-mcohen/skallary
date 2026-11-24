import { isSavingCategory, isInvestmentIncomeCategory } from "./savings";
import type { MonthlyRollup } from "./rollups";
import type { Plan, BudgetLine, BigMonth, CellForecast, MonthForecast, ForecastResult, Kind, PlannedEvent } from "./plan-types";
import { resolveMonthlyPlan, plannedCategories } from "./budget";
import { isIncomeCategory } from "./dedup";
import { monthsBetween } from "./period";

export function buildForecast(
  plan: Plan,
  budgetLines: BudgetLine[],
  actuals: MonthlyRollup[],
  asOfDate: string,
  plannedEvents: PlannedEvent[] = [],
  bigMonths: BigMonth[] = []
): ForecastResult {
  const months = monthsBetween(plan.startDate.slice(0, 7), plan.endDate.slice(0, 7));
  const asOfMonth = asOfDate.slice(0, 7);
  const actualIdx = new Map<string, MonthlyRollup>();
  // Income and expense only. Saving and investment income are their own buckets
  // and are not budgeted, so they must not turn up here as
  // a planned line or be mistaken for spending in the projection.
  for (const a of actuals) {
    if (a.kind !== "income" && a.kind !== "expense") continue;
    actualIdx.set(`${a.period}|${a.planningCategory}`, a);
  }
  // A budget line under a saving or investment-income name is not a budget line:
  // same rule as the actuals above.
  const plannedCats = plannedCategories(budgetLines).filter(
    (c) => !isSavingCategory(c) && !isInvestmentIncomeCategory(c)
  );
  const eventsByPeriod = new Map<string, PlannedEvent[]>();
  for (const e of plannedEvents) {
    const list = eventsByPeriod.get(e.period) ?? [];
    list.push(e);
    eventsByPeriod.set(e.period, list);
  }
  // Planned big months: part of the line's plan in their own
  // month, finished or not, so a December of gifts reads on budget.
  const bigBy = new Map<string, number>();
  for (const b of bigMonths) bigBy.set(`${b.month}|${b.planningCategory}`, (bigBy.get(`${b.month}|${b.planningCategory}`) ?? 0) + b.amountCents);

  const kindOf = (cat: string, period: string): Kind => {
    const a = actualIdx.get(`${period}|${cat}`);
    if (a) return a.kind === "income" ? "income" : "expense";
    return isIncomeCategory(cat) ? "income" : "expense";
  };

  const monthForecasts: MonthForecast[] = months.map((period) => {
    const elapsed = period <= asOfMonth;
    // planned events are committed FUTURE one-time expenses; a strictly-future
    // month folds them into its cells. An elapsed/current month is left alone —
    // that spend is already reflected (or will be) in actuals, so folding it
    // here would double-count.
    const futureEvents = !elapsed ? (eventsByPeriod.get(period) ?? []) : [];
    const cats = new Set<string>(plannedCats);
    for (const a of actuals) {
      if (a.period !== period) continue;
      if (a.kind !== "income" && a.kind !== "expense") continue; // saving is not a budget line
      cats.add(a.planningCategory);
    }
    for (const e of futureEvents) cats.add(e.planningCategory);
    for (const b of bigMonths) if (b.month === period) cats.add(b.planningCategory);
    const cells: CellForecast[] = [...cats]
      .sort()
      .map((cat) => {
        const actualCents = actualIdx.get(`${period}|${cat}`)?.amountCents ?? 0;
        const basePlanCents = resolveMonthlyPlan(budgetLines, cat, period);
        const eventCents = futureEvents.filter((e) => e.planningCategory === cat).reduce((sum, e) => sum + e.amountCents, 0);
        const bigCents = bigBy.get(`${period}|${cat}`) ?? 0;
        const planCents = basePlanCents + eventCents + bigCents;
        const forecastCents = elapsed ? actualCents : planCents;
        return {
          planningCategory: cat,
          kind: eventCents > 0 || bigCents > 0 ? "expense" : kindOf(cat, period),
          actualCents,
          planCents,
          forecastCents,
          varianceCents: actualCents - planCents,
        };
      });
    let mIncome = 0,
      mExpense = 0;
    for (const c of cells) c.kind === "income" ? (mIncome += c.forecastCents) : (mExpense += c.forecastCents);
    return { period, cells, netCents: mIncome - mExpense };
  });

  // annual by category (sum forecast across months)
  const annualMap = new Map<string, CellForecast>();
  for (const mf of monthForecasts)
    for (const c of mf.cells) {
      const prev = annualMap.get(c.planningCategory) ?? {
        planningCategory: c.planningCategory,
        kind: c.kind,
        actualCents: 0,
        planCents: 0,
        forecastCents: 0,
        varianceCents: 0,
      };
      prev.actualCents += c.actualCents;
      prev.planCents += c.planCents;
      prev.forecastCents += c.forecastCents;
      prev.varianceCents += c.varianceCents;
      annualMap.set(c.planningCategory, prev);
    }
  const annualByCategory = [...annualMap.values()].sort((a, b) => a.planningCategory.localeCompare(b.planningCategory));

  // totals + cumulative
  let incomeForecastCents = 0,
    expenseForecastCents = 0;
  const cumulativeSurplus: { period: string; cents: number }[] = [];
  let running = 0;
  for (const mf of monthForecasts) {
    let mIncome = 0,
      mExpense = 0;
    for (const c of mf.cells) c.kind === "income" ? (mIncome += c.forecastCents) : (mExpense += c.forecastCents);
    incomeForecastCents += mIncome;
    expenseForecastCents += mExpense;
    running += mIncome - mExpense;
    cumulativeSurplus.push({ period: mf.period, cents: running });
  }
  const surplusForecastCents = incomeForecastCents - expenseForecastCents;
  const savingsRate = incomeForecastCents > 0 ? surplusForecastCents / incomeForecastCents : 0;

  return {
    planId: plan.id,
    asOfDate,
    months: monthForecasts,
    annualByCategory,
    totals: { incomeForecastCents, expenseForecastCents, surplusForecastCents, savingsRate, cumulativeSurplus },
  };
}
