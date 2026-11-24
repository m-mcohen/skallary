// server/services/setupService.ts -- Set up budget and Start next year's budget. One pass computes every spending line's suggestion
// (rule D); Apply and Start next year each validate everything first, then write in one
// transaction, or not at all.
import { getAccounts } from "./readService.js";
import { yearlyCostsService } from "./yearlyCostsService.js";
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";
import { preparedInputs } from "./seedBudgetService.js";
import { detectRecurring } from "../../src/domain/recurring.js";
import { suggestLine, type LineSuggestion } from "../../src/domain/suggest.js";
import { sideOf } from "../../src/domain/budget-income.js";
import { priorMonths } from "../../src/domain/seed.js";
import { localDateIso } from "../../src/domain/period.js";
import { STANDARD_CATEGORIES } from "../../src/domain/starter-set.js";
import { getStarterFiling, markSetupFinished } from "./settingsService.js";
import { applyStarterFiling } from "./starterService.js";
import type { BudgetChange, Plan } from "../../src/domain/plan-types.js";

type Pick = { line: string; amountCents: number };
type SourcedPick = Pick & { source: "you" | "suggested" };

function readPicks(raw: unknown): SourcedPick[] {
  if (!Array.isArray(raw)) throw new Error("Pick the lines to apply.");
  return raw.map((x: { line?: unknown; amountCents?: unknown; source?: unknown }) => {
    const line = typeof x?.line === "string" ? x.line.trim() : "";
    if (!line) throw new Error("Pick a budget line.");
    // Whole cents; a refund line can be below zero, so negatives pass.
    if (!Number.isInteger(x?.amountCents)) throw new Error("Enter an amount in whole cents.");
    return { line, amountCents: x.amountCents as number, source: x?.source === "you" ? "you" : "suggested" };
  });
}

export function setupService(now: () => Date = () => new Date()) {
  const repo = sqliteFinanceRepository();
  const thisMonth = () => localDateIso(now()).slice(0, 7);
  const plan = (id: unknown): Plan => {
    const p = typeof id === "string" ? repo.getPlan(id) : null;
    if (!p) throw new Error("That budget does not exist.");
    return p;
  };

  return {
    /**
     * Every spending line with a budget or any spending in the last 12 finished months, with its
     * suggestion; plus every standard spending category the household files to,
     * so Set up budget is useful with little or no history. Before any filing choice is saved (a
     * new household part way through the interview) every one is offered; after it, a standard
     * category the household never took on (its category list has no such name) is left out.
     */
    suggestions(planId: string): LineSuggestion[] {
      plan(planId);
      const { prepared, rollups, mapping } = preparedInputs();
      const series = detectRecurring(prepared, mapping, localDateIso(now()), repo.listRecurringChoices());
      const fixed = new Set(repo.getCategorySettings().filter((s) => s.recurring === true).map((s) => s.planningCategory));
      const window = new Set(priorMonths(thisMonth(), 12));
      const names = new Set<string>();
      for (const l of repo.getBudgetLines(planId)) if (sideOf(l.planningCategory) === "spending") names.add(l.planningCategory);
      // A line set "from a month on" has no every-month row, and may have no recent spending.
      for (const c of repo.listBudgetChanges(planId)) if (sideOf(c.planningCategory) === "spending") names.add(c.planningCategory);
      for (const r of rollups) {
        if (r.kind === "expense" && window.has(r.period) && r.amountCents !== 0 && sideOf(r.planningCategory) === "spending") names.add(r.planningCategory);
      }
      const filedTo = new Set(Object.values(repo.getCategoryMappings()));
      const noChoiceYet = getStarterFiling() === null;
      for (const c of STANDARD_CATEGORIES) if (c.side === "spending" && (noChoiceYet || filedTo.has(c.name))) names.add(c.name);
      const exclusion = yearlyCostsService(now).yearlyExclusionFor(prepared, getAccounts(), mapping);
      return [...names].sort().map((line) => suggestLine(line, fixed.has(line), rollups, series, thisMonth(), exclusion));
    },

    apply(planId: string, body: { lines?: unknown }): { applied: number; cleared: BudgetChange[] } {
      // Never rewrite a budget whose year is over.
      if (plan(planId).endDate.slice(0, 7) < thisMonth()) throw new Error("That budget's year is over. Start the new year's budget instead.");
      const picks: Pick[] = readPicks(body?.lines).map(({ line, amountCents }) => ({ line, amountCents }));
      const cleared = repo.applySetup(planId, picks, now().toISOString());
      return { applied: picks.length, cleared };
    },

    /**
     * The end of the first-run interview: this calendar year's budget, made with
     * no lines when the year has none, and the finish time saved once. A budget that already
     * covers the year is never touched.
     */
    finishSetup(): { planId: string; created: boolean } {
      // The filing step may have been passed by (the step list lets a person jump ahead): a
      // finish with no filing choice saved is a skip, choice b, so the categories are there.
      if (getStarterFiling() === null) applyStarterFiling("categories-only");
      const year = thisMonth().slice(0, 4);
      const existing = repo.getPlan(`plan-${year}`) ?? repo.listPlans().find((p) => p.startDate.startsWith(year)) ?? null;
      const planId = existing?.id ?? repo.createPlan({ id: `plan-${year}`, name: year, startDate: `${year}-01-01`, endDate: `${year}-12-31` }).id;
      markSetupFinished(now().toISOString());
      return { planId, created: existing === null };
    },

    startNextYear(body: { fromPlanId?: unknown; lines?: unknown }): { plan: Plan } {
      const from = plan(body?.fromPlanId);
      const year = String(Number(from.startDate.slice(0, 4)) + 1);
      if (repo.listPlans().some((p) => p.startDate.startsWith(year))) throw new Error(`A budget for ${year} already exists.`);
      const lines = readPicks(body?.lines);
      const made = repo.startPlanWithLines({ id: `plan-${year}`, name: year, startDate: `${year}-01-01`, endDate: `${year}-12-31` }, lines, now().toISOString());
      return { plan: made };
    },
  };
}
