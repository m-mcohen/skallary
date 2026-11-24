// src/domain/lifestyle-view.ts
//
// What the Lifestyle editor shows and what the summary bar sums: one budget
// line per expense category, base amount beside the view's amount, grouped
// and numbered. Composed through the SAME scenario layers the projection
// uses (expense deltas, then line overrides) for one month, so the editor
// and the head cannot disagree. Pure.
import type { BudgetLine } from "./plan-types";
import { resolveMonthlyPlan } from "./budget";
import { isIncomeCategory } from "./dedup";
import { applyExpenseDeltas, applyLineOverrides, isEffectiveOverride, type Scenario } from "./scenario";
import { STARTER_LIFESTYLE_GROUPS, OTHER_GROUP, groupFor, type LifestyleGroup } from "./lifestyle-groups";

export const CHARITY = "Charity";

export interface ViewLine {
  planningCategory: string;
  number: string;
  baseCents: number;
  viewCents: number;
  cut: boolean;
  note: string;
  hasOverride: boolean;
  /** The base amount when the override was saved, when it differs from today's base. */
  baseMovedFromCents: number | null;
}

export interface ViewGroup {
  id: number;
  number: string;
  name: string;
  lines: ViewLine[];
  totalCents: number;
}

export interface ViewTotals {
  needExCharityCents: number;
  charityLineCents: number;
  totalCents: number;
  changedLines: number;
}

/** `lifestyleGroups` is the household's saved list; the starter groups when none is saved. */
export function composeViewLines(baseLines: BudgetLine[], scenario: Scenario | null, period: string, lifestyleGroups: LifestyleGroup[] = STARTER_LIFESTYLE_GROUPS): ViewGroup[] {
  const overrides = scenario?.lineOverrides ?? [];
  const composed = scenario
    ? applyLineOverrides(applyExpenseDeltas(baseLines, scenario.expenseDeltas, [period]), overrides, [period])
    : baseLines;
  const byCategory = new Map(overrides.map((o) => [o.planningCategory, o]));
  const categories = new Set<string>([
    ...baseLines.filter((l) => l.period === null || l.period === "").map((l) => l.planningCategory),
    ...overrides.map((o) => o.planningCategory),
  ]);

  const groups = [...lifestyleGroups, OTHER_GROUP].map((g) => ({ id: g.id, number: String(g.id === OTHER_GROUP.id ? lifestyleGroups.length + 1 : g.id), name: g.name, lines: [] as ViewLine[], totalCents: 0 }));
  const orderIn = (g: typeof OTHER_GROUP, c: string) => (g.categories.indexOf(c) === -1 ? 1_000 : g.categories.indexOf(c));
  const defaultLines = baseLines.filter((l) => l.period === null || l.period === "");

  for (const category of [...categories].filter((c) => !isIncomeCategory(c)).sort()) {
    const g = groupFor(category, lifestyleGroups);
    const target = groups.find((x) => x.id === g.id)!;
    const o = byCategory.get(category);
    const baseCents = resolveMonthlyPlan(defaultLines, category, period);
    const viewCents = resolveMonthlyPlan(composed, category, period);
    target.lines.push({
      planningCategory: category,
      number: "",
      baseCents,
      viewCents,
      cut: !!o?.cut,
      note: o?.note ?? "",
      hasOverride: !!o && isEffectiveOverride(o),
      baseMovedFromCents: o && o.baseAmountCents !== null && o.baseAmountCents !== baseCents ? o.baseAmountCents : null,
    });
  }
  for (const g of groups) {
    const def = lifestyleGroups.find((x) => x.id === g.id) ?? OTHER_GROUP;
    g.lines.sort((a, b) => orderIn(def, a.planningCategory) - orderIn(def, b.planningCategory) || a.planningCategory.localeCompare(b.planningCategory));
    g.lines.forEach((l, i) => (l.number = `${g.number}.${i + 1}`));
    g.totalCents = g.lines.reduce((s, l) => s + l.viewCents, 0);
  }
  return groups.filter((g) => g.lines.length > 0);
}

export function viewTotals(groups: ViewGroup[]): ViewTotals {
  let need = 0, charity = 0, total = 0, changed = 0;
  for (const g of groups) for (const l of g.lines) {
    total += l.viewCents;
    if (l.planningCategory === CHARITY) charity += l.viewCents; else need += l.viewCents;
    if (l.hasOverride) changed++;
  }
  return { needExCharityCents: need, charityLineCents: charity, totalCents: total, changedLines: changed };
}
