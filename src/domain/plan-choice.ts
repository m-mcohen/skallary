// src/domain/plan-choice.ts -- which budget a month belongs to. The app-wide budget is the plan whose year holds today, else the latest earlier
// one, never simply the lowest id. From December 1 the Budget offers next year's plan.
import type { Plan } from "./plan-types";

const byStart = (a: Plan, b: Plan) => a.startDate.localeCompare(b.startDate);

export function planForMonth(plans: Plan[], month: string): Plan | null {
  const holds = plans.find((p) => p.startDate.slice(0, 7) <= month && month <= p.endDate.slice(0, 7));
  if (holds) return holds;
  const earlier = plans.filter((p) => p.endDate.slice(0, 7) < month).sort(byStart);
  return earlier[earlier.length - 1] ?? null;
}

export function currentPlan(plans: Plan[], today: string): Plan | null {
  return planForMonth(plans, today.slice(0, 7)) ?? [...plans].sort(byStart)[0] ?? null;
}

/**
 * The year whose budget the Budget offers to start: next year from December 1, or this
 * year at once when today's year has no budget and the latest one is from an earlier year
 * (a missed December must not strand the Budget).
 */
export function nextYearOf(plans: Plan[], today: string): string | null {
  if (plans.length === 0) return null;
  const has = (y: string) => plans.some((p) => p.startDate.startsWith(y));
  const year = today.slice(0, 4);
  if (!has(year)) {
    const latest = [...plans].sort(byStart)[plans.length - 1].startDate.slice(0, 4);
    return latest < year ? year : null;
  }
  if (today.slice(5) < "12-01") return null;
  const next = String(Number(year) + 1);
  return has(next) ? null : next;
}
