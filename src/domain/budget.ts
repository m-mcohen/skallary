import type { BudgetLine } from "./plan-types";

/**
 * The usual month at `month`:
 * each line's amount in force that month, with the user's changes (rows of origin "change")
 * counted and a real one-month amount left out. The one place the rule lives. Salary
 * needed, Take-home needed, Monthly budget, the What if ladder and its statements, Check
 * a salary and the verdict price these, so a one-month amount and a big month never move
 * them, and "from October on, something changed" does. Returned as every-month rows
 * (period null). The Forecast, the Budget screen and the Dashboard's budget against
 * actual read real months through resolveMonthlyPlan on all the lines.
 */
export function usualMonthLines(lines: BudgetLine[], month: string): BudgetLine[] {
  // An every-month row may arrive as period "" (the database's spelling); resolveMonthlyPlan reads null.
  const kept = lines
    .filter((l) => l.period === null || l.period === "" || l.origin === "change")
    .map((l) => (l.period === "" ? { ...l, period: null } : l));
  return [...new Set(kept.map((l) => l.planningCategory))].map((cat) => {
    const dflt = kept.find((l) => l.planningCategory === cat && l.period === null);
    return {
      planId: (dflt ?? kept.find((l) => l.planningCategory === cat))!.planId,
      planningCategory: cat,
      period: null,
      amountCents: resolveMonthlyPlan(kept, cat, month),
      ...(dflt?.source ? { source: dflt.source } : {}),
    };
  });
}

export function resolveMonthlyPlan(lines: BudgetLine[], planningCategory: string, period: string): number {
  const forCat = lines.filter((l) => l.planningCategory === planningCategory);
  const override = forCat.find((l) => l.period === period);
  if (override) return override.amountCents;
  const dflt = forCat.find((l) => l.period === null);
  return dflt ? dflt.amountCents : 0;
}

export function plannedCategories(lines: BudgetLine[]): string[] {
  return [...new Set(lines.map((l) => l.planningCategory))];
}
