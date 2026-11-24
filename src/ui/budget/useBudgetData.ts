// src/ui/budget/useBudgetData.ts -- everything the Budget screens read, through an
// injectable data layer (tests pass stubs, as BudgetGrid's do). Transactions are read
// once; a save re-reads only the budget, its extras and the settings.
import { useCallback, useEffect, useState } from "react";
import {
  addBigMonthUI, changeBudgetLineUI, deleteBigMonthUI, getAccountsUI, getBudgetLinesUI, getCategoryMappingsUI,
  getCategorySettingsUI, getLineSuggestionUI, getMaaserFloorUI, getMaaserMarksUI, getSalarySettingsUI, getTransactionAdjustmentsUI, getTransactionsUI, listGoalsUI,
  listPlansUI, loadDb, resetBudgetLineUI, setCategoryRecurringUI, setMonthNoteUI, updateBigMonthUI, getSetupUI, applySetupUI, startNextYearUI, type Db,
} from "../lib/db";
import { getBudgetExtrasFullUI } from "../lib/db-yearly";
import { prepareForRollup } from "../../domain/pipeline";
import type { MaaserMark } from "../../domain/maaser-marks";
import { planForMonth } from "../../domain/plan-choice";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../domain/salary";
import type { BudgetInputs } from "../../domain/budget-month";
import type { Goal, Plan } from "../../domain/plan-types";
import type { Account, NormalizedTxn } from "../../domain/types";

export interface BudgetDataLayer {
  loadDb: () => Promise<Db>;
  getTransactions: typeof getTransactionsUI;
  getAccounts: typeof getAccountsUI;
  getCategoryMappings: typeof getCategoryMappingsUI;
  getTransactionAdjustments: typeof getTransactionAdjustmentsUI;
  listPlans: typeof listPlansUI;
  getBudgetLines: typeof getBudgetLinesUI;
  getBudgetExtras: typeof getBudgetExtrasFullUI;
  getCategorySettings: typeof getCategorySettingsUI;
  getSalarySettings: typeof getSalarySettingsUI;
  listGoals: typeof listGoalsUI;
  /** The floor the user keeps in the maaser pot, for the Charity line's panel. */
  getMaaserFloor: typeof getMaaserFloorUI;
  /** The two per-row maaser marks, for the Charity line's ledger. */
  getMaaserMarks: typeof getMaaserMarksUI;
  setCategoryRecurring: typeof setCategoryRecurringUI;
  changeBudgetLine: typeof changeBudgetLineUI;
  resetBudgetLine: typeof resetBudgetLineUI;
  getLineSuggestion: typeof getLineSuggestionUI;
  addBigMonth: typeof addBigMonthUI;
  updateBigMonth: typeof updateBigMonthUI;
  deleteBigMonth: typeof deleteBigMonthUI;
  setMonthNote: typeof setMonthNoteUI;
  getSetup: typeof getSetupUI;
  applySetup: typeof applySetupUI;
  startNextYear: typeof startNextYearUI;
}

export const defaultBudgetDataLayer: BudgetDataLayer = {
  loadDb,
  getTransactions: getTransactionsUI,
  getAccounts: getAccountsUI,
  getCategoryMappings: getCategoryMappingsUI,
  getTransactionAdjustments: getTransactionAdjustmentsUI,
  listPlans: listPlansUI,
  getBudgetLines: getBudgetLinesUI,
  getBudgetExtras: getBudgetExtrasFullUI,
  getCategorySettings: getCategorySettingsUI,
  getSalarySettings: getSalarySettingsUI,
  listGoals: listGoalsUI,
  getMaaserFloor: getMaaserFloorUI,
  getMaaserMarks: getMaaserMarksUI,
  setCategoryRecurring: setCategoryRecurringUI,
  changeBudgetLine: changeBudgetLineUI,
  resetBudgetLine: resetBudgetLineUI,
  getLineSuggestion: getLineSuggestionUI,
  addBigMonth: addBigMonthUI,
  updateBigMonth: updateBigMonthUI,
  deleteBigMonth: deleteBigMonthUI,
  setMonthNote: setMonthNoteUI,
  getSetup: getSetupUI,
  applySetup: applySetupUI,
  startNextYear: startNextYearUI,
};

export interface BudgetData extends BudgetInputs {
  plans: Plan[];
  plan: Plan;
  goals: Goal[];
  maaserFloorCents: number;
  maaserMarks: MaaserMark[];
}

export type BudgetPhase = "loading" | "unavailable" | "no-plan" | "ready" | "error";
type Base = { db: Db; plans: Plan[]; prepared: NormalizedTxn[]; accounts: Account[]; mapping: Record<string, string> };

/** With a month, the plan whose year holds that month is read; otherwise `planId`. */
export function useBudgetData(planId: string | null, deps: BudgetDataLayer, month?: string) {
  const [phase, setPhase] = useState<BudgetPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<Base | null>(null);
  const [data, setData] = useState<BudgetData | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let db: Db;
      try {
        db = await deps.loadDb();
      } catch {
        // Expected when the local server is unreachable (headless build, jsdom).
        if (!cancelled) setPhase("unavailable");
        return;
      }
      try {
        const [plans, txns, accounts, mapping, adjustments] = await Promise.all([
          deps.listPlans(db),
          deps.getTransactions(db),
          deps.getAccounts(db),
          deps.getCategoryMappings(db),
          deps.getTransactionAdjustments(db),
        ]);
        if (cancelled) return;
        setBase({ db, plans, prepared: prepareForRollup(txns, adjustments, accounts, mapping), accounts, mapping });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps]);

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    void (async () => {
      try {
        // The plans are read again on every refresh, so a budget just started (Start 2027
        // budget) is there at once.
        const plans = tick === 0 ? base.plans : await deps.listPlans(base.db);
        if (cancelled) return;
        const plan = (month ? planForMonth(plans, month) : null) ?? plans.find((p) => p.id === planId) ?? null;
        if (!plan) {
          setPhase("no-plan");
          return;
        }
        const [lines, extras, settings, salary, goals, maaserFloorCents, maaserMarks] = await Promise.all([
          deps.getBudgetLines(base.db, plan.id),
          deps.getBudgetExtras(base.db, plan.id),
          deps.getCategorySettings(base.db),
          deps.getSalarySettings(base.db).catch(() => DEFAULT_SALARY_ASSUMPTIONS),
          deps.listGoals(base.db).catch(() => [] as Goal[]),
          deps.getMaaserFloor(base.db).catch(() => 0),
          // Not an extra: a missing list would count every gift the user left out, so a failed read shows as an error.
          deps.getMaaserMarks(base.db),
        ]);
        if (cancelled) return;
        setData({ ...base, plans, plan, lines, ...extras, settings, salary, goals, maaserFloorCents, maaserMarks });
        setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, planId, month, tick, deps]);

  // A month in another year's budget waits for that budget: the old year's figures never show
  // against it, even for the moment the new reads take.
  const stale = phase === "ready" && data && month ? (planForMonth(data.plans, month)?.id ?? data.plan.id) !== data.plan.id : false;
  if (stale) return { phase: "loading" as BudgetPhase, data: null, error, reload, db: base?.db ?? null };
  return { phase, data, error, reload, db: base?.db ?? null };
}
