// src/domain/setup.ts -- Set up budget. One row per spending line: now, suggested, the change, and
// whether it starts ticked. "Now" is the amount in force that month without goal amounts,
// since Apply writes the every-month amount and goal changes stay on top. Pure.
//
// "Now" includes the goal's amount in force, because the
// 12-month average already includes what the goal has been spending; Apply writes the
// suggestion less the goal, so the goal kept on top is not counted twice.
import { resolveMonthlyPlan } from "./budget";
import { isReal } from "./budget-colors";
import { budgetLeftOver, isSetByYou, simulateChange } from "./budget-month";
import { normalMonthCents } from "./what-if";
import { formatCents } from "./money";
import { addMonths } from "./scenario";
import type { CategorySetting } from "./category-settings";
import type { BigMonth, BudgetChange, BudgetLine } from "./plan-types";
import type { SalaryAssumptions } from "./salary";
import type { LineSuggestion } from "./suggest";

export interface SetupLine {
  line: string;
  fixed: boolean;
  nowCents: number;
  goalCents: number;
  suggestion: LineSuggestion;
  /** What Apply writes as the every-month amount: the suggestion less the goal amounts kept on top (never below zero for a goal line). */
  applyCents: number;
  changeCents: number;
  small: boolean;
  setByYou: boolean;
  clears: BudgetChange[];
  startsTicked: boolean;
}

export function setupLines(input: { lines: BudgetLine[]; changes: BudgetChange[]; settings: CategorySetting[]; suggestions: LineSuggestion[]; month: string }): SetupLine[] {
  const fixed = new Set(input.settings.filter((s) => s.recurring === true).map((s) => s.planningCategory));
  return input.suggestions
    .map((s) => {
      const line = s.planningCategory;
      const goalCents = input.changes
        .filter((c) => c.planningCategory === line && c.reason === "goal" && c.fromMonth <= input.month)
        .reduce((sum, c) => sum + c.amountCents, 0);
      const nowCents = resolveMonthlyPlan(input.lines, line, input.month);
      const applyCents = goalCents > 0 ? Math.max(0, s.amountCents - goalCents) : s.amountCents;
      const changeCents = s.amountCents - nowCents;
      const setByYou = isSetByYou(input.lines, input.changes, line);
      return {
        line,
        fixed: fixed.has(line),
        nowCents,
        goalCents,
        suggestion: s,
        applyCents,
        changeCents,
        small: changeCents !== 0 && !isReal(changeCents, nowCents),
        setByYou,
        clears: input.changes
          .filter((c) => c.planningCategory === line && c.reason === "changed")
          .sort((a, b) => a.fromMonth.localeCompare(b.fromMonth)),
        startsTicked: changeCents !== 0 && !setByYou,
      };
    })
    .sort((a, b) => a.line.localeCompare(b.line));
}

/** The budget after Apply: each picked line's every-month amount set, its own changes cleared, goal changes kept. */
export function applyTicked(
  lines: BudgetLine[],
  changes: BudgetChange[],
  picks: { line: string; amountCents: number }[],
  throughMonth: string,
): { lines: BudgetLine[]; changes: BudgetChange[] } {
  let state = { lines, changes };
  for (const p of picks) state = simulateChange(state.lines, state.changes, p.line, null, p.amountCents, throughMonth);
  return state;
}

export interface SetupFigures {
  monthlyCents: number;
  leftOverCents: number | null;
  salaryNeededCents: number | null;
}

/**
 * Before or after figures: Monthly budget (the month's amounts in force, income left
 * out), Left over a month (next month's money in from Settings minus its budget; blank
 * with no salary), and Salary needed, which the caller works out the way the top bar does.
 */
export function setupTotals(
  input: { lines: BudgetLine[]; changes: BudgetChange[]; bigMonths: BigMonth[]; salary: SalaryAssumptions; settings: CategorySetting[] },
  month: string,
  _today: string,
  salaryNeeded: (lines: BudgetLine[]) => number | null,
): SetupFigures {
  return {
    monthlyCents: normalMonthCents(input.lines, month),
    leftOverCents: budgetLeftOver({ ...input, bigMonths: [] }, addMonths(month, 1)).leftOverCents,
    salaryNeededCents: salaryNeeded(input.lines),
  };
}

const CADENCE = { weekly: "every week", biweekly: "every 2 weeks", monthly: "every month", quarterly: "every 3 months", annual: "every year" } as const;

export function basisLabel(s: LineSuggestion, fixed: boolean): string {
  if (s.basis.kind === "bill") {
    const bills = s.basis.bills.map((b) => `${b.label} ${formatCents(b.usualCents)} ${CADENCE[b.cadence]}`);
    return `${bills.length === 1 ? "Bill" : "Bills"}: ${bills.join(", ")}`;
  }
  if (s.basis.months === 0) return "No spending in the last 12 months";
  const avg = `${s.basis.months}-month average`;
  if (fixed) return `${avg}, no bill found`;
  return s.basis.emptyMonths > 0 ? `${avg}, ${s.basis.emptyMonths} ${s.basis.emptyMonths === 1 ? "month" : "months"} with none` : avg;
}

/**
 * A line with an amount the person typed in place of the suggestion: what Apply
 * writes, the change and the "small" mark follow the typed amount, goal amounts kept on top as
 * with a suggestion.
 */
export function withTypedAmount(r: SetupLine, cents: number): SetupLine {
  const applyCents = r.goalCents > 0 ? Math.max(0, cents - r.goalCents) : cents;
  const changeCents = cents - r.nowCents;
  return {
    ...r,
    suggestion: { ...r.suggestion, amountCents: cents },
    applyCents,
    changeCents,
    small: changeCents !== 0 && !isReal(changeCents, r.nowCents),
  };
}
