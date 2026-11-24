// src/domain/plans-across.ts -- the Forecast across the year line: each future month reads its own year's plan when one exists, else the
// latest earlier plan's amounts in force at that plan's last month. With one plan the
// lines go through untouched, so nothing moves until a second plan exists. Pure.
import { resolveMonthlyPlan } from "./budget";
import { planForMonth } from "./plan-choice";
import type { BudgetLine, Plan } from "./plan-types";

export function linesAcrossPlans(plans: Plan[], linesByPlan: Map<string, BudgetLine[]>, months: string[]): BudgetLine[] {
  if (plans.length <= 1) return linesByPlan.get(plans[0]?.id ?? "") ?? [];
  const names = new Set<string>();
  for (const lines of linesByPlan.values()) for (const l of lines) names.add(l.planningCategory);
  const out: BudgetLine[] = [];
  for (const month of months) {
    const p = planForMonth(plans, month);
    if (!p) continue;
    const lines = linesByPlan.get(p.id) ?? [];
    const last = p.endDate.slice(0, 7);
    const at = month <= last ? month : last;
    for (const name of names) out.push({ planId: p.id, planningCategory: name, period: month, amountCents: resolveMonthlyPlan(lines, name, at) });
  }
  return out;
}
