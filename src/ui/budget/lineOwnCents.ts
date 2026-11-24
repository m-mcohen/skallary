// src/ui/budget/lineOwnCents.ts -- a line's own budget in a month: the user's every-month amount and
// the user's changes, never the month's full budget. A big month, a goal's saving or Charity's maaser
// raise sit on top of it and must not be saved into it. Shared by
// Change budget and the panel's budget box, so the two always start from one figure.
import { resolveMonthlyPlan } from "../../domain/budget";
import { expandChanges } from "../../domain/budget-changes";
import type { BudgetData } from "./useBudgetData";

/** Null when the line has no budget of its own. */
export function lineOwnCents(data: BudgetData, line: string, month: string): number | null {
  const base = data.lines.filter((l) => l.origin !== "change" && l.planningCategory === line);
  if (base.length === 0) return null;
  const mine = data.changes.filter((c) => c.planningCategory === line && c.reason === "changed");
  return resolveMonthlyPlan(expandChanges(base, mine, month), line, month);
}
