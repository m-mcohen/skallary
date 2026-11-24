// server/services/seedBudgetService.ts
//
// Seeds a plan's expense-category budget DEFAULTS (period: null) from
// trailing actuals. Applies the app-owned transaction adjustments (see
// src/domain/adjustments.ts) before rolling up, so an internal transfer the
// user has marked is neutralized in the same way it is everywhere else the
// app reads actuals. Merge rule (non-destructive,
// per Global Constraints): only period:null default lines are written;
// a category's per-month (period:"YYYY-MM") override is never touched.
import { yearlyCostsService } from "./yearlyCostsService.js";
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";
import { rollupMonthly, type MonthlyRollup } from "../../src/domain/rollups.js";
import type { MaaserMark } from "../../src/domain/maaser-marks.js";
import { seedExpenseDefaults, seedAsOfMonth } from "../../src/domain/seed.js";
import { prepareTransactions } from "../../src/domain/pipeline.js";
import { withEffectiveInclude } from "../../src/domain/account-filter.js";
import type { NormalizedTxn } from "../../src/domain/types.js";
import { getIncludePartnerAccounts, LAST_SEED_AT_KEY, LAST_SEED_WINDOW_KEY } from "./settingsService.js";

/**
 * Monthly actuals prepared the way every calc-facing reader must see them:
 * effective account include (owner slot + include-partner setting), then rules ->
 * transfer pairing -> adjustments, then the category mapping. Shared with
 * trailingService so a "trailing spend" readout and a seed can never
 * disagree about what counts as spend.
 */
export function preparedInputs(): { prepared: NormalizedTxn[]; rollups: MonthlyRollup[]; mapping: Record<string, string>; marks: MaaserMark[] } {
  const repo = sqliteFinanceRepository();
  const effectiveAccounts = withEffectiveInclude(repo.getAccounts(), getIncludePartnerAccounts());
  // Same order the UI sees (src/domain/pipeline.ts): rules assign categories to
  // rows the feed left blank, pair-matching finds internal moves, and the
  // user's own adjustments override both.
  const mapping = repo.getCategoryMappings();
  const prepared = prepareTransactions(repo.getTransactions(), {
    rules: repo.getCategorizationRules(),
    adjustments: repo.getTransactionAdjustments(),
    accounts: effectiveAccounts,
    mapping,
  });
  return { prepared, rollups: rollupMonthly(prepared, effectiveAccounts, mapping), mapping, marks: repo.listMaaserMarks() };
}
export function preparedRollups(): MonthlyRollup[] {
  return preparedInputs().rollups;
}

/** YYYY-MM in UTC -- the same clock the feed's dates are extracted in. */
export function utcMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function run(
  planId: string,
  windowMonths: number,
  now: () => Date = () => new Date()
): { window: string[]; seededCategories: number; skippedPinned: string[] } {
  const repo = sqliteFinanceRepository();
  const rollups = yearlyCostsService(now).rollupsWithoutYearly();

  const latest = rollups.reduce((mx, r) => (r.period > mx ? r.period : mx), "0000-00");
  // asOf month = the month AFTER the latest actual, so the latest actual
  // (often partial) is excluded from the averaging window.
  // Never let the window run into the CURRENT month: it is still in progress,
  // and after the SimpleFIN cutover the database contains rows dated today.
  const seededAt = now();
  const asOfMonth = seedAsOfMonth(latest, utcMonth(seededAt));

  const { window, defaults } = seedExpenseDefaults(rollups, asOfMonth, windowMonths);

  // Load once: pinned categories (user hand-set the default amount) must
  // never have their amount overwritten by the seed, and a category whose
  // recurring flag the user has explicitly set (recurringSource:'user')
  // must never be silently flipped back by the auto-derived value.
  const settings = new Map(repo.getCategorySettings().map((s) => [s.planningCategory, s]));
  // Since migration 0032 "set by the user" is the every-month row's source, not category_settings.pinned.
  // Plan 3 replaces this seed with Set up budget; until then it must
  // not overwrite the user's lines.
  const mine = new Set(repo.getBudgetLines(planId).filter((l) => l.period === null && l.source === "you").map((l) => l.planningCategory));

  const skippedPinned: string[] = [];
  for (const d of defaults) {
    const setting = settings.get(d.planningCategory);
    if (mine.has(d.planningCategory)) {
      skippedPinned.push(d.planningCategory);
    } else {
      repo.setBudgetLine({ planId, planningCategory: d.planningCategory, period: null, amountCents: d.amountCents, source: "suggested" });
    }
    if (!setting || setting.recurringSource !== "user") {
      repo.upsertCategorySetting({
        planningCategory: d.planningCategory,
        recurring: d.recurring,
        recurringSource: "auto",
        pinned: setting?.pinned ?? false,
      });
    }
  }

  // Stamped only once every line is written, so a seed that threw halfway
  // never reads as done -- and only when something WAS written: an empty
  // window would otherwise restart the 90-day re-seed clock and record a
  // basis the budget was never built from. The re-seed nudge
  // (src/domain/reseed.ts) counts from this.
  if (defaults.length > 0) {
    repo.setSetting(LAST_SEED_AT_KEY, seededAt.toISOString());
    repo.setSetting(LAST_SEED_WINDOW_KEY, String(windowMonths));
  }

  return { window, seededCategories: defaults.length, skippedPinned };
}
