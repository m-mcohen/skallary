// src/ui/lib/usePlanState.ts
//
// Plan and what-if state, lifted out of App.tsx so the shell is layout and the
// state is state.
//
// A what-if laid over the plan re-computes every figure on every screen, so it
// applies wherever you are. Only the top-bar menu turns one on; the live scrubber that could also do it left with the Scenarios
// screen.
import { useCallback, useEffect, useMemo, useState } from "react";

import { getPlanUI, listGoalAccountLinksUI, listGoalsUI, listPlansUI, listScenariosUI, listWhatIfsUI, loadDb } from "./db";
import type { Goal, GoalAccountLink } from "../../domain/plan-types";
import { applyWhatIfs, type WhatIf } from "../../domain/what-if";
import { budgetLabel } from "../../domain/budget-label";
import { useMastheadInputs, useMastheadSummary, type HeadState } from "./useMastheadSummary";
import { type Scenario } from "../../domain/scenario";
import { DEFAULT_SALARY_ASSUMPTIONS, type SalaryAssumptions } from "../../domain/salary";
import { localDateIso } from "../../domain/period";
import { currentPlan } from "../../domain/plan-choice";

export interface PlanState {
  planId: string | null;
  planName: string | null;
  setPlanId: (id: string | null) => void;
  /** Every saved scenario row (an older scenario, or a what-if's own row), as the API returned it. */
  savedScenarios: Scenario[];
  scenarioId: string | null;
  setScenarioId: (id: string | null) => void;
  /** Every saved what-if, as stored. */
  whatIfs: WhatIf[];
  /** The goals, for a what-if's goal rows. */
  goals: Goal[];
  /**
   * The goals could not be read while a what-if with ticked goals is on, so its
   * figures leave those goal costs out.
   */
  goalCostsMissing: boolean;
  /** The saved what-ifs as composed scenarios: what the top-bar menu offers. */
  whatIfScenarios: Scenario[];
  /** The what-if that is on, or null on Real numbers. */
  activeWhatIf: WhatIf | null;
  /** The what-if that is on, composed; null on Real numbers. */
  scenario: Scenario | null;
  summary: HeadState | null;
  salaryAssumptions: SalaryAssumptions;
  refresh: () => void;
  /**
   * A lighter refresh: re-reads only the what-ifs, not
   * the plan's scenarios, budget lines or transactions. An edit to a
   * what-if's income, changes or goal picks changes only the what_if_*
   * tables, never the scenarios row itself, so this is all a save of one
   * needs -- and it skips the multi-second re-read of every transaction that
   * `refresh()` triggers through useMastheadInputs.
   */
  refreshWhatIfs: () => void;
}

export function usePlanState(): PlanState {
  const [planId, setPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [savedScenarios, setSavedScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioIdRaw] = useState<string | null>(null);
  const [whatIfs, setWhatIfs] = useState<WhatIf[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalLinks, setGoalLinks] = useState<GoalAccountLink[]>([]);
  const [goalsFailed, setGoalsFailed] = useState(false);
  const [tick, setTick] = useState(0);
  // A separate tick so a what-if save can re-read just
  // the what-ifs without also bumping `tick`, which useMastheadInputs (and
  // the scenarios effect below) treat as "re-read everything".
  const [whatIfsTick, setWhatIfsTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const refreshWhatIfs = useCallback(() => setWhatIfsTick((t) => t + 1), []);

  // First plan in listPlansUI order, or null when none exist. Wrapped because
  // the local server is unreachable in headless builds and under jsdom.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await loadDb();
        const plans = await listPlansUI(db);
        // The plan whose year holds today, not the lowest id.
        if (!cancelled) setPlanId(currentPlan(plans, localDateIso())?.id ?? null);
      } catch {
        if (!cancelled) setPlanId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // A refresh re-picks the plan, so a budget just started for this
    // year becomes the app-wide budget without a reload.
  }, [tick]);

  useEffect(() => {
    if (!planId) {
      setPlanName(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const p = await getPlanUI(await loadDb(), planId);
        if (!cancelled) setPlanName(p ? budgetLabel(p) : null);
      } catch {
        if (!cancelled) setPlanName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!planId) return;
        const db = await loadDb();
        const list = await listScenariosUI(db, planId);
        if (!cancelled) setSavedScenarios(list);
      } catch {
        if (!cancelled) {
          setSavedScenarios([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, tick, whatIfsTick]);

  // What-ifs are read on their own (their own effect, their own tick), so a
  // what-if save can refresh just this without disturbing the scenarios list
  // above or the budget/transactions read in useMastheadInputs below. A failure here leaves Real numbers and the older lists
  // intact rather than blanking the menu.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!planId) {
        if (!cancelled) setWhatIfs([]);
        return;
      }
      try {
        const db = await loadDb();
        // Goals ride along: a switched-on goal cost counts in the overlay too,
        // and a switched-on goal saving in
        // Salary needed, priced from its linked accounts. A failure
        // reads as no goals, and is remembered so the banner can say so.
        let failed = false;
        const [ifs, gs, links] = await Promise.all([
          listWhatIfsUI(db, planId).catch(() => [] as WhatIf[]),
          listGoalsUI(db).catch(() => {
            failed = true;
            return [] as Goal[];
          }),
          // Never fatal: without links a goal saving is priced as if nothing were linked yet.
          Promise.resolve()
            .then(() => listGoalAccountLinksUI(db))
            .catch(() => [] as GoalAccountLink[]),
        ]);
        if (!cancelled) {
          setWhatIfs(ifs);
          setGoals(gs);
          setGoalLinks(links);
          setGoalsFailed(failed);
        }
      } catch {
        if (!cancelled) setWhatIfs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, tick, whatIfsTick]);

  const inputs = useMastheadInputs(planId, tick);
  const asOfMonth = localDateIso().slice(0, 7);

  // Every saved what-if, composed over today's budget and Settings, Salary, so
  // the top bar, Forecast and anything else that reads `scenario` sees what it
  // changes (a what-if's own scenarios row holds nothing). The top-bar menu
  // offers these and only these.
  const budgetLines = inputs?.budgetLines;
  const assumptions = inputs?.salaryAssumptions ?? DEFAULT_SALARY_ASSUMPTIONS;
  const whatIfScenarios = useMemo(() => {
    const ids = new Set(whatIfs.map((w) => w.scenarioId));
    const rows = savedScenarios.filter((s) => ids.has(s.id));
    return applyWhatIfs(rows, whatIfs, budgetLines ?? [], assumptions, asOfMonth, goals);
  }, [savedScenarios, whatIfs, budgetLines, assumptions, asOfMonth, goals]);

  // Only a what-if can be on: the app opens on Real numbers (scenarioId starts
  // null and nothing reads isDefault), and an older scenario's id turns nothing on.
  const saved = whatIfScenarios.find((s) => s.id === scenarioId) ?? null;
  const activeWhatIf = (saved && whatIfs.find((w) => w.scenarioId === saved.id)) ?? null;
  const scenario = saved;
  // Any goal row switched on needs the goals to be read.
  const goalCostsMissing = goalsFailed && !!activeWhatIf && activeWhatIf.rows.some((r) => r.on && r.kind !== "change");
  const summary = useMastheadSummary(inputs, scenario, activeWhatIf, goals, goalLinks);
  const setScenarioId = useCallback((id: string | null) => setScenarioIdRaw(id), []);

  return {
    planId,
    planName,
    setPlanId,
    savedScenarios,
    scenarioId,
    setScenarioId,
    whatIfs,
    goals,
    goalCostsMissing,
    whatIfScenarios,
    activeWhatIf,
    scenario,
    summary,
    salaryAssumptions: inputs?.salaryAssumptions ?? DEFAULT_SALARY_ASSUMPTIONS,
    refresh,
    refreshWhatIfs,
  };
}
