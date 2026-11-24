// server/services/budgetChangeService.ts -- changing a budget line, going back to the
// suggested amount, big months and notes. Months
// are the local month: the server runs on the user's laptop, and UTC would call a September
// evening October.
import { yearlyCostsRepository } from "../repositories/yearlyCostsRepository.js";
import { getAccounts } from "./readService.js";
import { yearlyCostsService } from "./yearlyCostsService.js";
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";
import { localDateIso } from "../../src/domain/period.js";
import { addMonths } from "../../src/domain/scenario.js";
import { applyYearlySharesToChanges, expandChanges, lineChangesIn } from "../../src/domain/budget-changes.js";
import { suggestLine, type LineSuggestion } from "../../src/domain/suggest.js";
import { detectRecurring } from "../../src/domain/recurring.js";
import { PAYCHECKS_LINE, sideOf } from "../../src/domain/budget-income.js";
import { preparedInputs } from "./seedBudgetService.js";
import type { BigMonth, BudgetChange, BudgetLine, MonthNote } from "../../src/domain/plan-types.js";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const LOCKED = "Months before this month are locked.";
const YEAR_OVER = "That budget's year is over. Start the new year's budget instead.";
// The note box's limit on the Month tab (LineNote.tsx).
const NOTE_MAX = 200;

/** The plan's budget lines with the user's changes as one-month rows, through 36 months past the plan's end (the Forecast runs past December). */
export function expandedBudgetLines(planId: string): BudgetLine[] {
  const repo = sqliteFinanceRepository();
  const plan = repo.getPlan(planId);
  const lines = repo.getBudgetLines(planId);
  if (!plan) return lines;
  return expandChanges(lines, applyYearlySharesToChanges(repo.listBudgetChanges(planId), yearlyCostsRepository().listShares(planId)), addMonths(plan.endDate.slice(0, 7), 36));
}

export function budgetChangeService(now: () => Date = () => new Date()) {
  const repo = sqliteFinanceRepository();
  const sharesFor = (id: string) => yearlyCostsRepository().listShares(id);
  const thisMonth = () => localDateIso(now()).slice(0, 7);
  const plan = (planId: string) => {
    const p = repo.getPlan(planId);
    if (!p) throw new Error("That budget does not exist.");
    return p;
  };
  // The screens hide Change budget and Go back to suggested on a finished year; the server agrees.
  const openPlan = (planId: string) => {
    const p = plan(planId);
    if (p.endDate.slice(0, 7) < thisMonth()) throw new Error(YEAR_OVER);
    return p;
  };
  const month =(m: unknown, planId: string): string => {
    if (typeof m !== "string" || !MONTH.test(m)) throw new Error("Pick a month.");
    const p = plan(planId);
    if (m < p.startDate.slice(0, 7) || m > p.endDate.slice(0, 7)) throw new Error("That month is not in this budget.");
    if (m < thisMonth()) throw new Error(LOCKED);
    return m;
  };
  const amount = (a: unknown): number => {
    if (typeof a !== "number" || !Number.isInteger(a) || a < 0) throw new Error("Enter an amount of zero or more.");
    return a;
  };
  const lineName = (l: unknown): string => {
    const s = typeof l === "string" ? l.trim() : "";
    if (!s) throw new Error("Pick a budget line.");
    return s;
  };
  const suggestion = (planId: string, line: string): LineSuggestion => {
    plan(planId);
    const { prepared, rollups, mapping } = preparedInputs();
    const series = detectRecurring(prepared, mapping, localDateIso(now()), repo.listRecurringChoices());
    const fixed = repo.getCategorySettings().find((s) => s.planningCategory === line)?.recurring === true;
    return suggestLine(line, fixed, rollups, series, thisMonth(), yearlyCostsService(now).yearlyExclusionFor(prepared, getAccounts(), mapping));
  };
  const bigMonthBody = (planId: string, b: Partial<BigMonth>) => {
    const label = typeof b.label === "string" ? b.label.trim() : "";
    if (!label) throw new Error("Name the big month.");
    const line = lineName(b.planningCategory);
    if (sideOf(line) !== "spending") throw new Error("A big month goes on a spending line.");
    return { planningCategory: line, month: month(b.month, planId), label, amountCents: amount(b.amountCents) };
  };
  return {
    changeLine(planId: string, line: string, body: { fromMonth: unknown; amountCents: unknown }): { replaced: BudgetChange[] } {
      openPlan(planId);
      const name = lineName(line);
      // Paychecks reads Settings, Salary; a stored change would add to it in the Forecast.
      if (name === PAYCHECKS_LINE) throw new Error("Paychecks reads its budget from Settings, Salary.");
      // A refund line is budgeted below zero, so a change takes any whole cents.
      if (typeof body.amountCents !== "number" || !Number.isInteger(body.amountCents)) throw new Error("Enter an amount in whole cents.");
      const cents = body.amountCents;
      const shares = sharesFor(planId);
      const share = shares.filter(row => row.planningCategory === name).reduce((sum, row) => sum + row.cents, 0);
      const replaced = body.fromMonth === null || body.fromMonth === undefined
        ? repo.setLineEveryMonth(planId, name, cents)
        : repo.changeLineFrom(planId, name, month(body.fromMonth, planId), cents + share);
      return { replaced: applyYearlySharesToChanges(replaced, shares) };
    },
    resetLine(planId: string, line: string): { cleared: BudgetChange[]; kept: BudgetChange[]; suggestion: LineSuggestion } {
      openPlan(planId);
      const name = lineName(line);
      const s = suggestion(planId, name);
      const kept = lineChangesIn(repo.listBudgetChanges(planId), name).goals;
      return { cleared: applyYearlySharesToChanges(repo.resetLine(planId, name, s.amountCents), sharesFor(planId)), kept, suggestion: s };
    },
    suggestion,
    addBigMonth(planId: string, b: Partial<BigMonth>): BigMonth {
      return repo.addBigMonth({ planId, ...bigMonthBody(planId, b) });
    },
    updateBigMonth(id: number, b: Partial<BigMonth>): void {
      const old = repo.getBigMonth(id);
      if (!old) throw new Error("That big month is gone.");
      if (old.month < thisMonth()) throw new Error(LOCKED);
      repo.updateBigMonth(id, bigMonthBody(old.planId, b));
    },
    deleteBigMonth(id: number): void {
      // A finished month's big month stays, as the screens show it: Delete is offered from this month on.
      const old = repo.getBigMonth(id);
      if (old && old.month < thisMonth()) throw new Error(LOCKED);
      repo.deleteBigMonth(id);
    },
    // A note may sit on a finished month (it explains a past month), so the lock does not apply.
    setNote(planId: string, body: Partial<MonthNote>): void {
      plan(planId);
      if (typeof body.month !== "string" || !MONTH.test(body.month)) throw new Error("Pick a month.");
      const note = typeof body.note === "string" ? body.note : "";
      if (note.length > NOTE_MAX) throw new Error(`A note is ${NOTE_MAX} characters at most.`);
      repo.setMonthNote(planId, lineName(body.planningCategory), body.month, note);
    },
    extras(planId: string) {
      const projected = yearlyCostsService(now).projectionFor(planId);
      return {
        changes: applyYearlySharesToChanges(repo.listBudgetChanges(planId), sharesFor(planId)),
        bigMonths: [...repo.listBigMonths(planId), ...projected.bigMonths],
        notes: repo.listMonthNotes(planId),
        yearlyTxnIds: projected.yearlyTxnIds,
      };
    },
  };
}
