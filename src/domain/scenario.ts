// src/domain/scenario.ts
//
// Scenario overlay composition: named, comparable income-ramp scenarios and
// an expense-delta worksheet on top of the real budget, without ever editing
// budget_lines. A scenario materializes synthetic YYYY-MM override
// BudgetLines (income ramp, then expense deltas) in memory and feeds the
// resulting overlay through the unchanged pipeline
// (buildForecast / projectFutureNet / computeRunway).
//
// Pure. No I/O, no DB access. Integer cents in/out.

import type { BudgetLine } from "./plan-types";
import { resolveMonthlyPlan } from "./budget";
import { INCOME_CATEGORY } from "./runway-projection";
import { isIncomeCategory } from "./dedup";

// ---------------------------------------------------------------------------
// Month-stepping helpers. A month range is period.ts's monthsBetween, the one
// the Forecast and the runway use too.
// ---------------------------------------------------------------------------

function splitPeriod(period: string): [number, number] {
  const [y, m] = period.split("-").map(Number);
  return [y, m];
}

function formatPeriod(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Adds `n` (possibly negative) whole months to a YYYY-MM period. */
export function addMonths(period: string, n: number): string {
  let [y, m] = splitPeriod(period);
  m += n;
  while (m > 12) {
    m -= 12;
    y++;
  }
  while (m < 1) {
    m += 12;
    y--;
  }
  return formatPeriod(y, m);
}

// ---------------------------------------------------------------------------
// Types (Design §2)
// ---------------------------------------------------------------------------

export type IncomeRampModel =
  | { kind: "plan" }
  | { kind: "custom"; netMonthlyCents: number; startPeriod: string }
  | { kind: "schedule"; steps: { fromPeriod: string; netMonthlyCents: number }[] };

export interface ExpenseDelta {
  planningCategory: string;
  period: string | null; // null = every horizon period; 'YYYY-MM' = that month only
  deltaCents: number; // signed; negative = cut, positive = add
  /**
   * With period null: apply from this 'YYYY-MM' onward, open-ended. An
   * obligation that starts with income (a charity pot) must keep applying after the
   * projection window slides past the months that existed when it was saved,
   * which a list of dated deltas cannot do. Absent = every horizon period.
   */
  fromPeriod?: string;
}

/**
 * A lifestyle view's change to one budget line. Applied
 * after the expense deltas: `cut` makes the line $0, else a non-null
 * `amountCents` replaces the resolved amount in every projected month. A
 * category the base budget lacks becomes a new expense line in the view.
 * `baseAmountCents` is the base default when the row was saved, shown as
 * "base moved" in the editor; it never feeds a total.
 */
export interface LineOverride {
  planningCategory: string;
  amountCents: number | null;
  cut: boolean;
  note: string;
  baseAmountCents: number | null;
  updatedAt: string;
}

/** True when a row carries nothing worth storing. */
export function isEmptyOverride(o: LineOverride): boolean {
  return o.amountCents === null && !o.cut && o.note.trim() === "";
}

export interface Scenario {
  id: string;
  planId: string;
  name: string;
  isDefault: boolean;
  income: IncomeRampModel;
  expenseDeltas: ExpenseDelta[];
  lineOverrides?: LineOverride[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// applyIncomeRamp
// ---------------------------------------------------------------------------

/**
 * Materializes the income model as synthetic YYYY-MM override BudgetLines on
 * the "Income" category, one per period in `horizonPeriods` for which the
 * model implies an amount. kind:"plan" returns `budgetLines` unchanged (the
 * real, already-persisted "Income" overrides keep applying — this is the
 * no-op scenario). Pure; does not touch the DB.
 */
export function applyIncomeRamp(
  budgetLines: BudgetLine[],
  income: IncomeRampModel,
  horizonPeriods: string[],
): BudgetLine[] {
  if (income.kind === "plan") return budgetLines;

  const amountForPeriod = (period: string): number | null => {
    if (income.kind === "custom") {
      return period < income.startPeriod ? null : income.netMonthlyCents;
    }
    // kind === "schedule": the latest step whose fromPeriod <= period; 0 before the first step.
    const applicable = income.steps.filter((s) => s.fromPeriod <= period);
    if (applicable.length === 0) return 0;
    return applicable.reduce((latest, s) => (s.fromPeriod > latest.fromPeriod ? s : latest)).netMonthlyCents;
  };

  const planId = budgetLines[0]?.planId ?? "";
  const overridden = new Set(horizonPeriods);
  const kept = budgetLines.filter(
    (l) => !(l.planningCategory === INCOME_CATEGORY && l.period !== null && overridden.has(l.period)),
  );
  const synthetic: BudgetLine[] = [];
  for (const period of horizonPeriods) {
    const amt = amountForPeriod(period);
    if (amt === null) continue;
    synthetic.push({ planId, planningCategory: INCOME_CATEGORY, period, amountCents: amt });
  }
  return [...kept, ...synthetic];
}

// ---------------------------------------------------------------------------
// applyExpenseDeltas
// ---------------------------------------------------------------------------

/**
 * Materializes each delta as a synthetic YYYY-MM override equal to
 * resolveMonthlyPlan(lines, delta.planningCategory, period) + delta.deltaCents,
 * for every period in `horizonPeriods` a null-period delta applies to (all of
 * them, or those >= its fromPeriod) or the single period a YYYY-MM delta
 * names. Pure.
 */
export function applyExpenseDeltas(
  budgetLines: BudgetLine[],
  deltas: ExpenseDelta[],
  horizonPeriods: string[],
): BudgetLine[] {
  if (deltas.length === 0) return budgetLines;

  const planId = budgetLines[0]?.planId ?? "";
  const periodsFor = (delta: ExpenseDelta): string[] => {
    if (delta.period !== null) return [delta.period];
    const from = delta.fromPeriod;
    return from ? horizonPeriods.filter((p) => p >= from) : horizonPeriods;
  };

  const overridden = new Set<string>();
  const synthetic: BudgetLine[] = [];
  for (const delta of deltas) {
    for (const period of periodsFor(delta)) {
      const resolved = resolveMonthlyPlan(budgetLines, delta.planningCategory, period);
      overridden.add(`${delta.planningCategory}|${period}`);
      synthetic.push({
        planId,
        planningCategory: delta.planningCategory,
        period,
        amountCents: resolved + delta.deltaCents,
      });
    }
  }
  const kept = budgetLines.filter(
    (l) => !(l.period !== null && overridden.has(`${l.planningCategory}|${l.period}`)),
  );
  return [...kept, ...synthetic];
}

// ---------------------------------------------------------------------------
// applyLineOverrides
// ---------------------------------------------------------------------------

/**
 * The fourth layer: a view's fixed amounts and cuts, as synthetic YYYY-MM
 * overrides for every horizon period, replacing whatever the base and the
 * deltas produced. Pure. Income categories are skipped (the route refuses
 * them first; this is defence in depth).
 */
/** True for a row that actually changes a number: a cut, or a non-null amount, on a non-income category. */
export function isEffectiveOverride(o: LineOverride): boolean {
  return (o.cut || o.amountCents !== null) && !isIncomeCategory(o.planningCategory);
}

/** The overrides that actually change a number. */
export function effectiveLineOverrides(overrides: LineOverride[]): LineOverride[] {
  return overrides.filter(isEffectiveOverride);
}

export function applyLineOverrides(
  budgetLines: BudgetLine[],
  overrides: LineOverride[],
  horizonPeriods: string[],
): BudgetLine[] {
  const effective = effectiveLineOverrides(overrides);
  if (effective.length === 0) return budgetLines;

  const planId = budgetLines[0]?.planId ?? "";
  const overridden = new Set<string>();
  const synthetic: BudgetLine[] = [];
  for (const o of effective) {
    const amountCents = o.cut ? 0 : (o.amountCents as number);
    for (const period of horizonPeriods) {
      overridden.add(`${o.planningCategory}|${period}`);
      synthetic.push({ planId, planningCategory: o.planningCategory, period, amountCents });
    }
  }
  const kept = budgetLines.filter((l) => !(l.period !== null && overridden.has(`${l.planningCategory}|${l.period}`)));
  return [...kept, ...synthetic];
}

// ---------------------------------------------------------------------------
// The charity pot and the budget line it lands on
// ---------------------------------------------------------------------------

/** The budget line the charity pot lands on; defined with the pot's rule, re-exported for its older callers. */
export { MAASER_CATEGORY } from "./maaser-pot";

/**
 * Whether a scenario changes anything: a "plan" income with no expense
 * adjustments and no effective line override is the recorded plan itself.
 */
export function scenarioOverlays(scenario: Scenario | null | undefined): boolean {
  if (!scenario) return false;
  return scenario.income.kind !== "plan" || scenario.expenseDeltas.length > 0 || effectiveLineOverrides(scenario.lineOverrides ?? []).length > 0;
}

/**
 * The budget lines with a scenario laid over them for the given months:
 * income model, then expense adjustments, then line overrides. The one
 * composition the top bar, the Dashboard and the Forecast screen all use, so an
 * overlay cannot mean different things on different screens. Returns the input untouched
 * when the scenario changes nothing.
 */
export function applyScenarioToLines(budgetLines: BudgetLine[], scenario: Scenario | null | undefined, periods: string[]): BudgetLine[] {
  if (!scenario || !scenarioOverlays(scenario)) return budgetLines;
  const withIncome = applyIncomeRamp(budgetLines, scenario.income, periods);
  const withDeltas = applyExpenseDeltas(withIncome, scenario.expenseDeltas, periods);
  return applyLineOverrides(withDeltas, effectiveLineOverrides(scenario.lineOverrides ?? []), periods);
}
