// src/domain/what-if.ts
//
// The What if screen. A what-if is a
// base salary, its own changes to the budget, and one list, in the user's order, of
// rows that each switch on and off: its changes, each goal's saving, and each
// goal's planned ongoing cost. It is stored
// beside a scenarios row and composed into an ordinary Scenario at read time,
// so every screen that already understands a scenario understands a what-if.
// Pure; integer cents.
//
// Rules: switched-off rows
// count nowhere; goal saving rows count toward Salary needed and Take-home
// needed only, never Monthly budget or Forecast; cost rows count everywhere;
// costs carry no start month, so a stored start or end month is never read.
//
// The ladder, its statements, Check a
// salary and the verdict price a usual month (usualMonthLines, budget.ts): each budget
// line's every-month amount. A one-month budget amount never moves them.
//
// A "One-time cost"
// change kind, a label, an amount and the month it is paid. It is a row like any
// other (switched, moved), counted once in the Forecast and the runway overlay in its
// month, and kept out of the salary math (the ladder, Salary needed, Take-home needed,
// Monthly budget, Check a salary and the verdict), like a down payment: onChanges
// leaves it out, and oneTimeCosts hands it to the two places that count it.
//
import { monthlyLoanPaymentCents } from "./loan";
import { isIncomeCategory } from "./dedup";
import { resolveMonthlyPlan, usualMonthLines } from "./budget";
import { currentSalaryBreakdown, monthlyPayCents, salaryForView, spendableAtSalary, w2Breakdown, type SalaryAssumptions, type SalaryBreakdown } from "./salary";
import { potMonthCents } from "./charity-pot";
import { incomeStatement, type IncomeStatement, type StatementCost, type StatementRow } from "./income-statement";
import { composeViewLines, viewTotals } from "./lifestyle-view";
import type { LifestyleGroup } from "./lifestyle-groups";
import { addMonths, MAASER_CATEGORY, type ExpenseDelta, type Scenario } from "./scenario";
import { additionalSalaryProblem, type AdditionalSalary } from "./income";
import { goalSavingPlan, goalStatuses, type GoalSavingSource } from "./goals";
import { formatWholeDollars } from "./money";
import type { Account, NormalizedTxn } from "./types";
import type { AccountBalance, BudgetLine, Goal, GoalAccountLink } from "./plan-types";

export type ChangeKind = "add" | "change" | "cut" | "car" | "mortgage" | "one-time";
const CHANGE_KINDS: ReadonlySet<string> = new Set<ChangeKind>(["add", "change", "cut", "car", "mortgage", "one-time"]);

/** The line a one-time cost is stored under. It is never a budget line: nothing prices it a month. */
export const ONE_TIME_LINE = "One-time cost";

/** Paid once, in its month: never part of a month's costs. */
export const isOneTime = (c: Pick<WhatIfChange, "kind">) => c.kind === "one-time";

export interface LoanInputs {
  priceCents: number;
  downPaymentCents: number;
  /** 0.065 for 6.5%. */
  annualRate: number;
  years: number;
  /** Mortgage only. */
  propertyTaxYearCents?: number;
  /** Mortgage only. */
  insuranceYearCents?: number;
}

export interface WhatIfChange {
  id: string;
  /** The user's order; the ladder and Check a salary walk it. */
  position: number;
  kind: ChangeKind;
  /** "New car", "Rent", "Uber Eats + bakery". */
  label: string;
  /** An existing budget line, or a new line's name. */
  planningCategory: string;
  /** add: per month; change and cut: the new amount (0 = cut entirely); car and mortgage: filled from the loan; one-time: the whole amount, once. */
  amountCents: number;
  /**
   * YYYY-MM. Stored, never read (costs carry no start month): a new change is saved with next month here. A one-time
   * cost is the exception: this is the month it is paid.
   */
  fromPeriod: string;
  /** YYYY-MM inclusive, or open-ended. Stored, never read. */
  untilPeriod: string | null;
  /** Car and mortgage only. */
  loan: LoanInputs | null;
}

/**
 * The kinds of row on a what-if's one list. A new kind of
 * cost (say, a one-time cost) would be a new ChangeKind on a "change" row, so
 * the list and its table need nothing new.
 */
export type WhatIfRowKind = "change" | "goal-saving" | "goal-cost";
const ROW_KINDS: ReadonlySet<string> = new Set<WhatIfRowKind>(["change", "goal-saving", "goal-cost"]);

/** One stored row of the list (migrations/0029_what_if_rows.sql). */
export interface WhatIfRow {
  kind: WhatIfRowKind;
  /** The change's id ("change"), or the goal's id ("goal-saving", "goal-cost"). */
  refId: string;
  /** The user's order; the ladder and Check a salary walk it. */
  position: number;
  /** Switched on. A switched-off row counts nowhere while this what-if is on. */
  on: boolean;
}

export interface WhatIf {
  scenarioId: string;
  /**
   * Base salary, yearly. Null = the current salary from Settings, Salary stays.
   * A bonus is never counted.
   */
  salaryGrossAnnualCents: number | null;
  /** The month its salary starts. Null = the current salary's start month. */
  salaryFromPeriod: string | null;
  changes: WhatIfChange[];
  /**
   * The one list, in the user's order. A change with no row reads as on, at
   * the end; a goal with no row reads as off, at the bottom (new goals arrive
   * switched off). See whatIfList.
   */
  rows: WhatIfRow[];
  /**
   * Its own additional salary: absent or null = the one in
   * Settings, Salary; "none" = none while this what-if is on.
   */
  additionalSalary?: AdditionalSalary | "none" | null;
}

/** Settings, Salary as this what-if sees it: its own additional salary, or None, replaces the real one. */
export function assumptionsUnder(a: SalaryAssumptions, w: WhatIf | null | undefined): SalaryAssumptions {
  if (!w || w.additionalSalary === undefined || w.additionalSalary === null) return a;
  return { ...a, additionalSalary: w.additionalSalary === "none" ? null : w.additionalSalary };
}

/**
 * The month a what-if's own salary starts: its own month, else the current
 * salary's. Null when neither is set: it then counts from the
 * first month priced or projected.
 */
export function whatIfSalaryStart(w: WhatIf, a: SalaryAssumptions): string | null {
  return w.salaryFromPeriod ?? a.currentSalary?.fromPeriod ?? null;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

const isNumber = (v: unknown): v is number => typeof v === "number";

/**
 * Why a loan cannot be priced, in plain words; null when it can. Checked
 * before the SQLite-bound arithmetic below so a missing or non-number field
 * (for example `null`, which `>=` silently reads as zero) is refused in
 * words rather than quietly treated as a free loan.
 */
export function loanProblem(loan: LoanInputs): string | null {
  for (const extra of [loan.propertyTaxYearCents, loan.insuranceYearCents]) {
    if (extra !== undefined && extra !== null && !(Number.isFinite(extra) && extra >= 0)) return "Property tax and insurance cannot be below zero.";
  }
  if (!isNumber(loan.priceCents)) return "A loan needs a price.";
  if (!isNumber(loan.downPaymentCents)) return "A loan needs a down payment (0 if none).";
  if (!isNumber(loan.annualRate)) return "A loan needs a rate.";
  if (!isNumber(loan.years)) return "A loan needs its years.";
  if (!(loan.years >= 1)) return "A loan needs at least one year.";
  if (!(loan.annualRate >= 0)) return "The rate cannot be below zero.";
  if (!(loan.priceCents >= 0) || !(loan.downPaymentCents >= 0)) return "A price cannot be below zero.";
  if (loan.downPaymentCents > loan.priceCents) return "The down payment is more than the price.";
  return null;
}

/**
 * A car or mortgage payment a month: principal and interest on the price less
 * the down payment (the Acquisition screen's formula), plus a twelfth of the
 * yearly property tax and insurance (a mortgage).
 */
export function loanMonthlyCents(loan: LoanInputs): number {
  const principal = Math.max(0, loan.priceCents - loan.downPaymentCents);
  const payment = monthlyLoanPaymentCents(principal, loan.annualRate, loan.years);
  const extras = Math.round(((loan.propertyTaxYearCents ?? 0) + (loan.insuranceYearCents ?? 0)) / 12);
  return payment + extras;
}

/** A twelfth of a mortgage's yearly property tax and insurance -- the part that keeps going after payoff. */
function taxAndInsuranceMonthlyCents(loan: LoanInputs): number {
  return Math.round(((loan.propertyTaxYearCents ?? 0) + (loan.insuranceYearCents ?? 0)) / 12);
}

/**
 * The month a loan's principal and interest are paid off: its last payment
 * month, inclusive.
 */
export function loanPayoffMonth(fromPeriod: string, years: number): string {
  return addMonths(fromPeriod, years * 12 - 1);
}

// ---------------------------------------------------------------------------
// Composing a what-if into an ordinary scenario
// ---------------------------------------------------------------------------

/** The budget line the charity pot lands on. */
export const CHARITY_LINE = MAASER_CATEGORY;

/** True when the change is in effect in `period` (YYYY-MM). */
export function activeIn(c: WhatIfChange, period: string): boolean {
  return period >= c.fromPeriod && (c.untilPeriod === null || period <= c.untilPeriod || isLegacyMortgageEnd(c));
}

/**
 * The loan dialog used to store a mortgage's payoff month as its end
 * month, which also stopped its property tax and insurance. Such an end month is
 * read as open; the payment itself still stops at
 * payoff (changeAmountCents).
 */
function isLegacyMortgageEnd(c: WhatIfChange): boolean {
  return c.kind === "mortgage" && !!c.loan && c.untilPeriod !== null && c.untilPeriod === loanPayoffMonth(c.fromPeriod, c.loan.years);
}

/**
 * What the change costs in `period`: the loan payment for a car or mortgage,
 * else the typed amount. A mortgage's principal and interest stop the month
 * after payoff; its property tax and insurance keep going.
 */
export function changeAmountCents(c: WhatIfChange, period: string): number {
  if (!c.loan || (c.kind !== "car" && c.kind !== "mortgage")) return c.amountCents;
  if (c.kind === "car") return loanMonthlyCents(c.loan);
  const payoff = loanPayoffMonth(c.fromPeriod, c.loan.years);
  return period <= payoff ? loanMonthlyCents(c.loan) : taxAndInsuranceMonthlyCents(c.loan);
}

const sets = (c: WhatIfChange) => c.kind === "change" || c.kind === "cut";

/** One change's effect on its line in `period`, against the budget alone. */
export function changeMonthlyCents(c: WhatIfChange, baseLines: BudgetLine[], period: string): number {
  if (sets(c)) return c.amountCents - resolveMonthlyPlan(baseLines, c.planningCategory, period);
  return changeAmountCents(c, period);
}

/** The user's order: position, then id so equal positions still read the same way every time. */
export function inOrder<T extends { position: number }>(items: T[], key: (t: T) => string): T[] {
  return [...items].sort((x, y) => x.position - y.position || key(x).localeCompare(key(y)));
}

/**
 * A line's amount in `period` once `changes` apply. The result no longer depends on the order an add and
 * a Change/Cut on the same line were entered in. Every active Change or Cut
 * on the line is considered first -- the one furthest along in the user's order
 * wins the line's base amount -- and then every active add (a plain add, a
 * car or a mortgage) stacks on top of that base, regardless of where it sits
 * relative to the Change/Cut. Among several Changes/Cuts on one line, the user's
 * order still decides (the later one wins). The overlay engine keeps only
 * the FIRST adjustment per line and month, so this walk happens here and the
 * engine is handed one sum per line and month.
 */
/**
 * The budget before any what-if: every-month lines, income left out. The What
 * if card and the top bar's Monthly budget both start here, so the two cannot drift apart if an income line lands on the
 * budget; until then the bar summed income lines and the card did not.
 */
export function normalMonthCents(lines: BudgetLine[], month: string): number {
  return usualMonthLines(lines, month)
    .filter((l) => !isIncomeCategory(l.planningCategory))
    .reduce((sum, l) => sum + l.amountCents, 0);
}

export function lineAfterChanges(changes: WhatIfChange[], baseLines: BudgetLine[], line: string, period: string): number {
  const active = inOrder(changes, (x) => x.id).filter((c) => c.planningCategory === line && activeIn(c, period));
  const setters = active.filter(sets);
  const adders = active.filter((c) => !sets(c));
  const base = setters.length > 0 ? setters[setters.length - 1].amountCents : resolveMonthlyPlan(baseLines, line, period);
  return adders.reduce((sum, c) => sum + changeAmountCents(c, period), base);
}

/**
 * The paycheck a base salary brings home a month (after tax and the pre-tax
 * health premium), and the charity pot's month on it. Worked out from the
 * stored gross and today's Settings, Salary, so an edit there follows through.
 */
export function takeHomeMonthlyCents(grossAnnualCents: number, a: SalaryAssumptions): { paycheckCents: number; maaserCents: number } {
  return monthlyPayCents(w2Breakdown(grossAnnualCents, 0, a), a);
}

/**
 * The Charity line's raise to the pot's month in `period` (0 before the salary starts, or
 * when the line already covers it), with every switched-on change in effect: the
 * price month's view (no start months).
 */
export function maaserShortfallCents(w: WhatIf, baseLines: BudgetLine[], period: string, a: SalaryAssumptions): number {
  return maaserRaiseCents(w, onChanges(w).map((c) => datedChange(c, period)), baseLines, period, a);
}

/** The same raise, with `changes` (already dated) as the changes in effect. */
function maaserRaiseCents(w: WhatIf, changes: WhatIfChange[], baseLines: BudgetLine[], period: string, a: SalaryAssumptions): number {
  if (w.salaryGrossAnnualCents === null) return 0;
  const start = whatIfSalaryStart(w, a);
  if (start && period < start) return 0;
  const line = lineAfterChanges(changes, baseLines, CHARITY_LINE, period);
  // A set-amount pot's month does not depend on pay: its own month (start month, exact yearly shares).
  const pot = a.pot;
  const month = pot && pot.on && pot.kind !== "percent" ? potMonthCents(pot, period, 0) : takeHomeMonthlyCents(w.salaryGrossAnnualCents, assumptionsUnder(a, w)).maaserCents;
  return Math.max(0, month - line);
}

// ---------------------------------------------------------------------------
// The one list
// ---------------------------------------------------------------------------

/** One row as the What if screen lists it. */
export interface ListRow {
  kind: WhatIfRowKind;
  refId: string;
  /** 1, 2, 3 ... in the user's order. */
  position: number;
  on: boolean;
  /** "New car"; "Saving for House"; "House, ongoing cost". */
  label: string;
  /** A change's amount a month (a Change or Cut: the new amount); a goal's saving or ongoing cost a month; null when a goal has no saving amount. */
  monthlyCents: number | null;
  change?: WhatIfChange;
  goal?: LadderGoal;
}

const rowKey = (r: { kind: string; refId: string }) => `${r.kind}:${r.refId}`;

/** The label a goal's rows carry, on the list, the ladder and the verdict. */
export const goalSavingLabel = (name: string) => `Saving for ${name}`;
export const goalCostLabel = (name: string) => `${name}, ongoing cost`;

/** The ladder rung a row becomes: a change's id, "cost:" and a goal's id, or a goal's id. */
export function rungIdOf(r: { kind: WhatIfRowKind; refId: string }): string {
  return r.kind === "goal-cost" ? `cost:${r.refId}` : r.refId;
}

/**
 * The what-if's one list, in the user's order. `goals` are the goals that can be on it
 * (active, cost not started; see ladderGoalsFrom). Stored rows keep their order;
 * a change with no stored row is added on, at the end (it was just added); a goal
 * with no stored row is added off, at the bottom, its saving row and then its
 * cost row, so a new goal arrives switched off in every what-if. A row whose change or goal is gone is dropped, and a goal with no
 * planned ongoing cost has no cost row.
 */
export function whatIfList(w: WhatIf, goals: LadderGoal[]): ListRow[] {
  const changeById = new Map(w.changes.map((c) => [c.id, c]));
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const seen = new Set<string>();
  const out: Omit<ListRow, "position">[] = [];
  const changeRow = (c: WhatIfChange, on: boolean): Omit<ListRow, "position"> => ({ kind: "change", refId: c.id, on, label: c.label, monthlyCents: changeAmountCents(c, c.fromPeriod), change: c });
  const goalRow = (kind: "goal-saving" | "goal-cost", g: LadderGoal, on: boolean): Omit<ListRow, "position"> =>
    kind === "goal-saving"
      ? { kind, refId: g.id, on, label: goalSavingLabel(g.name), monthlyCents: g.complete ? 0 : g.recommendedMonthlyCents, goal: g }
      : { kind, refId: g.id, on, label: goalCostLabel(g.name), monthlyCents: g.plannedCostCents, goal: g };

  for (const r of inOrder(w.rows ?? [], rowKey)) {
    const key = rowKey(r);
    if (seen.has(key) || !ROW_KINDS.has(r.kind)) continue;
    if (r.kind === "change") {
      const c = changeById.get(r.refId);
      if (!c) continue;
      out.push(changeRow(c, r.on !== false));
    } else {
      const g = goalById.get(r.refId);
      if (!g || (r.kind === "goal-cost" && !(g.plannedCostCents > 0))) continue;
      out.push(goalRow(r.kind, g, r.on === true));
    }
    seen.add(key);
  }
  for (const c of inOrder(w.changes, (x) => x.id)) {
    if (!seen.has(rowKey({ kind: "change", refId: c.id }))) out.push(changeRow(c, true));
  }
  for (const g of goals) {
    if (!seen.has(rowKey({ kind: "goal-saving", refId: g.id }))) out.push(goalRow("goal-saving", g, false));
    if (g.plannedCostCents > 0 && !seen.has(rowKey({ kind: "goal-cost", refId: g.id }))) out.push(goalRow("goal-cost", g, false));
  }
  return out.map((r, i) => ({ ...r, position: i + 1 }));
}

/** The rows to store for a list, numbered in its order. */
export function rowsOf(list: Pick<ListRow, "kind" | "refId" | "on">[]): WhatIfRow[] {
  return list.map((r, i) => ({ kind: r.kind, refId: r.refId, position: i + 1, on: r.on }));
}

/**
 * The switched-on changes, in list order (their positions renumbered to it, so
 * among two Changes on one line the later one in the user's list wins).
 */
export function onChanges(w: WhatIf): WhatIfChange[] {
  return whatIfList(w, [])
    .filter((r) => r.kind === "change" && r.on && r.change && !isOneTime(r.change))
    .map((r, i) => ({ ...r.change!, position: i + 1 }));
}

/** The switched-on one-time costs, in list order: each paid once, in its own month. */
export function oneTimeCosts(w: WhatIf): WhatIfChange[] {
  return whatIfList(w, [])
    .filter((r) => r.kind === "change" && r.on && r.change && isOneTime(r.change))
    .map((r) => r.change!);
}

/**
 * A change as it counts from `start`: costs carry no start month, so its stored months are replaced. A car's payments run the loan's
 * years from `start` (open point 2, A); everything else stays open, and a
 * mortgage's property tax and insurance keep going after payoff.
 */
export function datedChange(c: WhatIfChange, start: string): WhatIfChange {
  const carEnd = c.kind === "car" && c.loan ? loanPayoffMonth(start, c.loan.years) : null;
  return { ...c, fromPeriod: start, untilPeriod: carEnd };
}

/** Open point 1 (B): the what-if salary's start month, or next month when it has none; never before next month. */
export function forecastCostStart(whatIf: WhatIf, a: SalaryAssumptions, nextMonth: string): string {
  if (whatIf.salaryGrossAnnualCents === null) return nextMonth;
  const start = whatIfSalaryStart(whatIf, a);
  return start && start > nextMonth ? start : nextMonth;
}

/** What goalStatuses needs to price a goal's saving: the accounts, their balances, the links, the transactions. */
export interface GoalSide {
  accounts: Account[];
  balances: AccountBalance[];
  links: GoalAccountLink[];
  txns: NormalizedTxn[];
}

/**
 * The goals a what-if can list, as the list and the ladder see them: active
 * goals whose cost has not started (a started cost is in the budget already),
 * each with its saving a month (goalSavingPlan: the planned amount the user typed, else
 * what the target date needs) and its planned ongoing cost. Without `side` the
 * saving is unknown (null) and only the costs are right.
 */
export function ladderGoalsFrom(goals: Goal[], side: GoalSide | null, asOfDate: string): LadderGoal[] {
  const active = goals.filter((g) => !g.archivedAt && !g.ongoingStartedPeriod);
  if (!side) return active.map((g) => ({ id: g.id, name: g.name, recommendedMonthlyCents: null, complete: false, plannedCostCents: g.ongoingMonthlyCents ?? 0 }));
  return goalStatuses(active, side, asOfDate).map(({ status }) => {
    const plan = goalSavingPlan(status);
    return {
      id: status.goal.id,
      name: status.goal.name,
      recommendedMonthlyCents: plan.monthlyCents,
      complete: plan.source === "done",
      plannedCostCents: status.goal.ongoingMonthlyCents ?? 0,
      savingSource: plan.source,
      finishPeriod: plan.finishPeriod,
    };
  });
}

/**
 * A what-if as an ordinary Scenario: the salary as income from its month, and
 * one adjustment per line and month for every change, plus the pot's raise of
 * the Charity line, plus each loan's down payment once, in its start month, on
 * a line of its own (so the runway sees it and the ladder does not).
 */
export function composeWhatIf(
  scenario: Scenario,
  w: WhatIf,
  baseLines: BudgetLine[],
  periods: string[],
  a: SalaryAssumptions,
  goalCosts: GoalCost[] = [],
  costsFrom?: string
): Scenario {
  const deltas: ExpenseDelta[] = [];
  // Only switched-on changes, each counting from the cost start (no start months).
  const start = costsFrom ?? periods[0];
  const changes = start ? onChanges(w).map((c) => datedChange(c, start)) : [];
  const touched = [...new Set([...changes.map((c) => c.planningCategory), ...(w.salaryGrossAnnualCents !== null ? [CHARITY_LINE] : [])])];
  const inWindow = new Set(periods);
  for (const period of periods) {
    for (const line of touched) {
      const after = lineAfterChanges(changes, baseLines, line, period) + (line === CHARITY_LINE ? maaserRaiseCents(w, changes, baseLines, period, a) : 0);
      const cents = after - resolveMonthlyPlan(baseLines, line, period);
      if (cents !== 0) deltas.push({ planningCategory: line, period, deltaCents: cents });
    }
  }
  // Down payments are summed per line and month too: the engine keeps only the
  // first adjustment per line and month, so two loans with the same name
  // starting together would otherwise lose one.
  const downs = new Map<string, ExpenseDelta>();
  for (const c of changes) {
    if (c.loan && c.loan.downPaymentCents > 0 && inWindow.has(c.fromPeriod)) {
      const key = `Down payment: ${c.label}|${c.fromPeriod}`;
      const prior = downs.get(key);
      if (prior) prior.deltaCents += c.loan.downPaymentCents;
      else downs.set(key, { planningCategory: `Down payment: ${c.label}`, period: c.fromPeriod, deltaCents: c.loan.downPaymentCents });
    }
  }
  deltas.push(...downs.values());
  // One-time costs: once, in their own month, each on a line of its
  // own, summed per name and month for the same reason as down payments.
  const once = new Map<string, ExpenseDelta>();
  for (const c of oneTimeCosts(w)) {
    if (!inWindow.has(c.fromPeriod) || !(c.amountCents > 0)) continue;
    const key = `${c.label}|${c.fromPeriod}`;
    const prior = once.get(key);
    if (prior) prior.deltaCents += c.amountCents;
    else once.set(key, { planningCategory: `One-time cost: ${c.label}`, period: c.fromPeriod, deltaCents: c.amountCents });
  }
  deltas.push(...once.values());
  // A switched-on goal cost row, on its own line from the cost start
  // .
  // Each on its own numbered line: a goal's name could read as income
  // ("Rental income property") or match another goal's, and either would
  // miscount.
  goalCosts.forEach((cost, i) => {
    for (const period of periods) {
      if (costsFrom && period < costsFrom) continue;
      deltas.push({ planningCategory: `Goal cost ${i + 1}`, period, deltaCents: cost.monthlyCents });
    }
  });
  let income: Scenario["income"] = { kind: "plan" };
  const salaryStart = w.salaryGrossAnnualCents !== null ? whatIfSalaryStart(w, a) ?? costsFrom ?? periods[0] : null;
  if (w.salaryGrossAnnualCents !== null && salaryStart) {
    income = { kind: "custom", netMonthlyCents: takeHomeMonthlyCents(w.salaryGrossAnnualCents, assumptionsUnder(a, w)).paycheckCents, startPeriod: salaryStart };
  }
  return { ...scenario, income, expenseDeltas: deltas, lineOverrides: [] };
}

/** The months a what-if is composed over: January of this year through ten years out. */
export function whatIfPeriods(asOfMonth: string): string[] {
  const start = `${asOfMonth.slice(0, 4)}-01`;
  const end = addMonths(asOfMonth, 120);
  const out: string[] = [];
  for (let p = start; p <= end; p = addMonths(p, 1)) out.push(p);
  return out;
}

/**
 * The scenario list with every what-if composed, so each screen that reads a
 * scenario (the top bar, Forecast) sees what the what-if changes.
 * A row with no what-if (an older scenario) comes back as it was.
 */
export function applyWhatIfs(
  scenarios: Scenario[],
  whatIfs: WhatIf[],
  baseLines: BudgetLine[],
  a: SalaryAssumptions,
  asOfMonth: string,
  goals: Goal[] = []
): Scenario[] {
  if (whatIfs.length === 0) return scenarios;
  const byId = new Map(whatIfs.map((w) => [w.scenarioId, w]));
  const periods = whatIfPeriods(asOfMonth);
  const nextMonth = addMonths(asOfMonth, 1);
  return scenarios.map((s) => {
    const w = byId.get(s.id);
    // Goals ride along so a switched-on goal cost reaches the top bar too. Costs count from the month the Forecast
    // starts them (open point 1, B), so the overlay and Forecast agree.
    return w ? composeWhatIf(s, w, baseLines, periods, a, plannedGoalCosts(w, goals), forecastCostStart(w, a, nextMonth)) : s;
  });
}

export interface GoalCost {
  goalId: string;
  label: string;
  monthlyCents: number;
}

/**
 * The switched-on goal cost rows' PLANNED ongoing costs, in list order: a row whose goal is archived or deleted adds
 * nothing, and one whose cost has started adds nothing because it is already in
 * the budget (choice 4).
 */
export function plannedGoalCosts(w: WhatIf, goals: Goal[]): GoalCost[] {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const out: GoalCost[] = [];
  for (const r of inOrder(w.rows ?? [], rowKey)) {
    if (r.kind !== "goal-cost" || r.on !== true) continue;
    const g = byId.get(r.refId);
    if (!g || g.archivedAt || g.ongoingStartedPeriod || !(g.ongoingMonthlyCents ?? 0)) continue;
    out.push({ goalId: g.id, label: g.name, monthlyCents: g.ongoingMonthlyCents as number });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The salary ladder
// ---------------------------------------------------------------------------

export interface LadderRung {
  /**
   * goal-cost: a switched-on goal's planned ongoing cost, inside Salary to live;
   * goal: a switched-on goal saving row, inside Salary to live and hit goals.
   */
  kind: "start" | "change" | "goal-cost" | "goal";
  /** The change id, the goal id, or "start". */
  id: string;
  label: string;
  /** This rung's effect a month (negative for a cut). For the start: the normal month's need, charity aside. */
  monthlyCents: number;
  /** The yearly base salary needed once this rung is added. */
  salaryAfterCents: number;
  /** salaryAfterCents minus the rung above. */
  salaryAddedCents: number;
  /** The yearly take-home that salary leaves after tax, the premium and the pot: what this rung needs, net. */
  takeHomeAfterCents: number;
  note: string | null;
  /** The part of monthlyCents that moves the need (everything but the Charity line). Absent = all of it. */
  needDeltaCents?: number;
  /** The part of monthlyCents that moves the Charity line, which charity (a floor) prices on its own. */
  charityDeltaCents?: number;
}

export interface WhatIfLadder {
  /**
   * Next month: the month every change counts from (costs carry no start month),
   * which dates a car's or a mortgage's loan. Budget lines are priced at the usual month,
   * never this month's one-month amounts.
   */
  priceMonth: string;
  rungs: LadderRung[];
  salaryToLiveCents: number;
  salaryToLiveAndHitGoalsCents: number;
  /** The yearly take-home Salary to live leaves after tax, the premium and the pot. */
  takeHomeToLiveCents: number;
  /** The yearly take-home Salary to live and hit goals leaves. */
  takeHomeToLiveAndHitGoalsCents: number;
  /** The month's need with every switched-on cost row, charity aside. */
  needToLiveMonthlyCents: number;
  /** The same, plus every switched-on goal saving row. Absent = needToLiveMonthlyCents. */
  needToLiveAndHitGoalsMonthlyCents?: number;
  /** The Charity line with every switched-on change. */
  charityLineMonthlyCents: number;
  /** The Charity line in a normal month, before any change. Absent = charityLineMonthlyCents. */
  startCharityLineMonthlyCents?: number;
  /** The rung ids in the one list's order, top to bottom: the walk Check a salary takes. Absent = the rungs' order. */
  walkOrder?: string[];
  /**
   * Each total as an income statement, Yearly and Monthly. The top bar
   * shows the second one while the what-if is on, so the two cannot disagree.
   */
  statements?: { toLive: IncomeStatement; toLiveAndHitGoals: IncomeStatement; yourIncome?: YourIncome | null };
}

/**
 * The ladder's first statement: the user's real salary, the one the verdict
 * prices (the what-if's own, else the user's current yearly salary), so Left over is a true
 * number, not the near-zero of a salary solved to break even. Every row switched on counts.
 */
export interface YourIncome {
  grossAnnualCents: number;
  /** "current": the user's current salary from Settings, Salary (firm taxes apply); "own": the what-if's. */
  whose: "current" | "own";
  statement: IncomeStatement;
}

/** The salary the verdict and Your income price: the what-if's own, else the user's current yearly salary. Null when neither. */
export function realSalaryOf(w: WhatIf, a: SalaryAssumptions): { grossAnnualCents: number; whose: "current" | "own" } | null {
  if (w.salaryGrossAnnualCents !== null) return w.salaryGrossAnnualCents > 0 ? { grossAnnualCents: w.salaryGrossAnnualCents, whose: "own" } : null;
  const c = a.currentSalary;
  return c?.kind === "gross" && c.grossAnnualCents > 0 ? { grossAnnualCents: c.grossAnnualCents, whose: "current" } : null;
}

/**
 * What the list and the ladder need from a goal. `recommendedMonthlyCents` is
 * what its saving row saves a month on What if: the Planned
 * per month the user typed, else the Needed per month worked out from the target date
 * (goalSavingPlan); null when it has neither.
 */
export interface LadderGoal {
  id: string;
  name: string;
  recommendedMonthlyCents: number | null;
  complete: boolean;
  /** Its planned ongoing cost a month: 0 when none, or when it has started (then it is in the budget). */
  plannedCostCents: number;
  /** Where the saving a month comes from, for the list's wording. Absent = not known. */
  savingSource?: GoalSavingSource;
  /** The month the goal is fully saved at that pace, when known. */
  finishPeriod?: string | null;
}

/**
 * The month's need (charity aside) and Charity line once `applied` changes are
 * in effect in `pm`: the normal month plus each touched line's move from its
 * budget amount. The ladder and Check a salary both price through this.
 */
export function needAndCharityWith(applied: WhatIfChange[], baseLines: BudgetLine[], pm: string, normalNeed: number, normalCharity: number): { need: number; charity: number } {
  let need = normalNeed;
  let charity = normalCharity;
  for (const line of new Set(applied.map((c) => c.planningCategory))) {
    const moved = lineAfterChanges(applied, baseLines, line, pm) - resolveMonthlyPlan(baseLines, line, pm);
    if (line === CHARITY_LINE) charity += moved;
    else need += moved;
  }
  return { need, charity };
}

/**
 * From today's costs, through every switched-on cost row in the user's list order (the user's
 * changes and goals' ongoing costs, mixed) to Salary to live, then through every
 * switched-on goal saving row, in list order, to Salary to live and hit goals.
 * Every rung prices a usual month: each budget line's
 * every-month amount, every change in full from
 * next month (no start months), using the Settings, Salary assumptions exactly as the top bar does
 * (salaryForView). A switched-off row is not on it. Down payments are one-time
 * and never enter a salary. A bonus is never counted.
 */
export function whatIfLadder(w: WhatIf, baseLines: BudgetLine[], goals: LadderGoal[], nextMonth: string, settings: SalaryAssumptions, lifestyleGroups?: LifestyleGroup[]): WhatIfLadder {
  // Salary needed is the user's salary given the additional one this what-if counts.
  const a = assumptionsUnder(settings, w);
  const pm = nextMonth;
  // A usual month: a one-month budget amount never moves Salary needed.
  const lines = usualMonthLines(baseLines, pm);
  const normal = viewTotals(composeViewLines(lines, null, pm, lifestyleGroups));
  // A one-time cost is paid once and never enters a salary.
  const on = whatIfList(w, goals).filter((r) => r.on && !(r.change && isOneTime(r.change)));
  // Gross and net together: salary needed is before tax,
  // the premium and maaser; take-home needed is after them.
  const priced = (need: number, charity: number) => {
    const b = salaryForView(need * 12, charity * 12, a);
    return { gross: b.grossAnnualCents, net: b.takeHomeAnnualCents, breakdown: b };
  };

  const start = priced(normal.needExCharityCents, normal.charityLineCents);
  const rungs: LadderRung[] = [
    { kind: "start", id: "start", label: "Today's costs, charity aside", monthlyCents: normal.needExCharityCents, salaryAfterCents: start.gross, salaryAddedCents: 0, takeHomeAfterCents: start.net, note: null },
  ];
  let prev = { need: normal.needExCharityCents, charity: normal.charityLineCents };
  let prevSalary = start.gross;
  let prevTakeHome = start.net;
  let prevBreakdown: SalaryBreakdown = start.breakdown;

  // Cost rows: changes priced through their lines (a Change or Cut sets a line,
  // an add stacks on it), goal costs added in full, like any cost.
  let applied: WhatIfChange[] = [];
  let goalCostCents = 0;
  for (const r of on) {
    if (r.kind === "goal-saving") continue;
    if (r.kind === "change") applied = [...applied, { ...datedChange(r.change!, pm), position: applied.length + 1 }];
    else goalCostCents += r.monthlyCents ?? 0;
    const t = needAndCharityWith(applied, lines, pm, normal.needExCharityCents, normal.charityLineCents);
    const next = { need: t.need + goalCostCents, charity: t.charity };
    const p = priced(next.need, next.charity);
    rungs.push({
      kind: r.kind === "change" ? "change" : "goal-cost",
      id: rungIdOf(r),
      label: r.label,
      monthlyCents: next.need + next.charity - prev.need - prev.charity,
      needDeltaCents: next.need - prev.need,
      charityDeltaCents: next.charity - prev.charity,
      salaryAfterCents: p.gross,
      salaryAddedCents: p.gross - prevSalary,
      takeHomeAfterCents: p.net,
      note: null,
    });
    prev = next;
    prevSalary = p.gross;
    prevTakeHome = p.net;
    prevBreakdown = p.breakdown;
  }
  const toLive = { ...prev, salary: prevSalary, takeHome: prevTakeHome, breakdown: prevBreakdown };

  // Saving rows: each goal's saving a month, in list order.
  let need = prev.need;
  for (const r of on) {
    if (r.kind !== "goal-saving") continue;
    const g = r.goal!;
    const monthly = g.complete ? 0 : g.recommendedMonthlyCents ?? 0;
    need += monthly;
    const p = priced(need, prev.charity);
    rungs.push({
      kind: "goal",
      id: g.id,
      label: r.label,
      monthlyCents: monthly,
      needDeltaCents: monthly,
      charityDeltaCents: 0,
      salaryAfterCents: p.gross,
      salaryAddedCents: p.gross - prevSalary,
      takeHomeAfterCents: p.net,
      note: g.complete ? "Fully saved, nothing more needed" : g.recommendedMonthlyCents === null ? "No target date or planned amount" : null,
    });
    prevSalary = p.gross;
    prevTakeHome = p.net;
    prevBreakdown = p.breakdown;
  }

  // Each total as an income statement, from the very figures it priced, in the user's
  // order: the budget's lines under Expenses (the Charity line left
  // out), then each row switched on, by what it moves the costs. A change to the Charity
  // line moves nothing there (it moves the Charity line), so it reads $0.00 and a note
  // says why. The lines add up to each total's need exactly.
  const expenses: StatementCost[] = [];
  for (const g of composeViewLines(lines, null, pm, lifestyleGroups)) for (const l of g.lines) if (l.planningCategory !== CHARITY_LINE) expenses.push({ label: l.planningCategory, cents: l.viewCents });
  const costRows: StatementRow[] = rungs.filter((r) => r.kind === "change" || r.kind === "goal-cost").map((r) => ({ id: r.id, label: r.label, cents: r.needDeltaCents ?? r.monthlyCents }));
  const goalRows: StatementRow[] = rungs.filter((r) => r.kind === "goal").map((r) => ({ id: r.id, label: r.label, cents: r.monthlyCents }));
  const touchesCharity = rungs.some((r) => (r.charityDeltaCents ?? 0) !== 0);
  const statementAt = (breakdown: SalaryBreakdown, rows: StatementRow[]) => {
    const s = incomeStatement({ breakdown, assumptions: a, charityLineMonthlyCents: toLive.charity, expenses, rows });
    return touchesCharity ? { ...s, notes: [...s.notes, "A row that changes the Charity line moves the line above Take-home, not Expenses, so it reads $0.00 here."] } : s;
  };

  // Your income: the same lines, priced at the user's real salary.
  const real = realSalaryOf(w, a);
  const yourIncome: YourIncome | null = real
    ? {
        ...real,
        statement: statementAt(
          real.whose === "current" ? currentSalaryBreakdown(real.grossAnnualCents, toLive.charity * 12, a) : w2Breakdown(real.grossAnnualCents, toLive.charity * 12, a),
          [...costRows, ...goalRows]
        ),
      }
    : null;

  return {
    priceMonth: pm,
    rungs,
    salaryToLiveCents: toLive.salary,
    salaryToLiveAndHitGoalsCents: prevSalary,
    takeHomeToLiveCents: toLive.takeHome,
    takeHomeToLiveAndHitGoalsCents: prevTakeHome,
    needToLiveMonthlyCents: toLive.need,
    needToLiveAndHitGoalsMonthlyCents: need,
    charityLineMonthlyCents: toLive.charity,
    startCharityLineMonthlyCents: normal.charityLineCents,
    walkOrder: on.map(rungIdOf),
    statements: { toLive: statementAt(toLive.breakdown, costRows), toLiveAndHitGoals: statementAt(prevBreakdown, [...costRows, ...goalRows]), yourIncome },
  };
}

export interface SalaryCheck {
  /** What the salary leaves to spend a month, after tax, the premium and charity. */
  spendableMonthlyCents: number;
  /** Whether it covers today's costs at all. */
  startCovered: boolean;
  items: { id: string; kind: "change" | "goal-cost" | "goal"; label: string; monthlyCents: number; covered: boolean }[];
  /** Spendable, less today's costs and every covered item. Negative when today's costs are not covered. */
  leftOverMonthlyCents: number;
}

/** A rung that lowers cost or charity -- a cut, or a Change to a smaller amount. */
function isCutRung(r: LadderRung): boolean {
  return (r.needDeltaCents ?? r.monthlyCents) < 0 || (r.charityDeltaCents ?? 0) < 0;
}

/**
 * Check a salary. Start
 * from today's costs, fold in every cut first -- a cut always fits and can
 * bring today's costs back into what the salary covers even when they would
 * not have fit on their own -- then walk the rest of the ladder in the user's order.
 * An item is covered when it fits on top of everything covered above it; one
 * that does not fit is marked not covered and the walk moves on, the same
 * rule the Wish List uses.
 */
/** What Check a salary needs to price each step afresh: the what-if and today's budget. */
export interface SalaryCheckContext {
  whatIf: WhatIf;
  baseLines: BudgetLine[];
  /** The salary checked is the user's current salary (the what-if keeps it), so the user's firm tax figures apply. */
  currentSalary?: boolean;
}

/**
 * Check a salary with the what-if at hand: each
 * step is priced afresh against the changes accepted so far, never against a
 * step the salary could not cover. A cut is a change that lowers its line
 * against the budget; every cut is applied first.
 */
function checkSalaryAfresh(ladder: WhatIfLadder, grossAnnualCents: number, settings: SalaryAssumptions, ctx: SalaryCheckContext): SalaryCheck {
  const a = assumptionsUnder(settings, ctx.whatIf);
  const room = (charityLine: number) => spendableAtSalary(grossAnnualCents, charityLine * 12, a, undefined, { current: ctx.currentSalary === true }).spendableMonthlyCents;
  const pm = ladder.priceMonth;
  // The usual month, as the ladder prices it.
  const lines = usualMonthLines(ctx.baseLines, pm);
  const normalNeed = (ladder.rungs.find((r) => r.kind === "start")?.monthlyCents ?? 0) + yearlyBillsMonthCents(settings);
  const normalCharity = ladder.startCharityLineMonthlyCents ?? ladder.charityLineMonthlyCents;
  // Switched-on changes only, each counting in the price month (no start months).
  const changeById = new Map(onChanges(ctx.whatIf).map((c) => [c.id, datedChange(c, pm)]));
  const totals = (applied: WhatIfChange[]) => needAndCharityWith(inOrder(applied, (x) => x.id), lines, pm, normalNeed, normalCharity);
  const isCut = (c: WhatIfChange) => changeMonthlyCents(c, lines, pm) < 0;

  let accepted = [...changeById.values()].filter(isCut);
  const startCovered = (() => {
    const t = totals(accepted);
    return t.need <= room(t.charity);
  })();
  let goalNeed = 0;
  const items: SalaryCheck["items"] = [];
  // The one list, top to bottom.
  const rungById = new Map(ladder.rungs.map((r) => [r.id, r]));
  const order = ladder.walkOrder ?? ladder.rungs.filter((r) => r.kind !== "start").map((r) => r.id);
  for (const id of order) {
    const r = rungById.get(id);
    if (!r || r.kind === "start") continue;
    if (r.kind === "change") {
      const c = changeById.get(r.id);
      if (!c || isCut(c)) {
        items.push({ id: r.id, kind: r.kind, label: r.label, monthlyCents: r.monthlyCents, covered: startCovered || !!c });
        continue;
      }
      const t = totals([...accepted, c]);
      const covered = startCovered && t.need + goalNeed <= room(t.charity);
      if (covered) accepted = [...accepted, c];
      items.push({ id: r.id, kind: r.kind, label: r.label, monthlyCents: r.monthlyCents, covered });
    } else {
      const t = totals(accepted);
      const covered = startCovered && t.need + goalNeed + r.monthlyCents <= room(t.charity);
      if (covered) goalNeed += r.monthlyCents;
      items.push({ id: r.id, kind: r.kind, label: r.label, monthlyCents: r.monthlyCents, covered });
    }
  }
  const t = totals(accepted);
  const spendable = room(t.charity);
  return { spendableMonthlyCents: spendable, startCovered, items, leftOverMonthlyCents: spendable - t.need - goalNeed };
}

/**
 * A twelfth of the yearly bills: Check a salary's monthly need counts them, as Salary needed
 * does, so the left-over does not rise when bills leave the every-month amounts. 0 when none.
 */
function yearlyBillsMonthCents(a: SalaryAssumptions): number {
  return Math.round((a.yearlyBillsAnnualCents ?? 0) / 12);
}

export function checkSalary(ladder: WhatIfLadder, grossAnnualCents: number, a: SalaryAssumptions, ctx?: SalaryCheckContext): SalaryCheck {
  if (ctx) return checkSalaryAfresh(ladder, grossAnnualCents, a, ctx);
  // Need and the Charity line are walked apart: charity is a floor (the larger
  // of the line and maaser) that spendableAtSalary prices on its own, so a
  // Charity step moves what the salary leaves, never the need.
  const room = (charityLine: number) => spendableAtSalary(grossAnnualCents, charityLine * 12, a).spendableMonthlyCents;
  const rest = ladder.rungs.filter((r): r is LadderRung & { kind: "change" | "goal-cost" | "goal" } => r.kind !== "start");

  let need = (ladder.rungs.find((r) => r.kind === "start")?.monthlyCents ?? 0) + yearlyBillsMonthCents(a);
  let charity = ladder.startCharityLineMonthlyCents ?? ladder.charityLineMonthlyCents;
  for (const r of rest) {
    if (!isCutRung(r)) continue;
    need += r.needDeltaCents ?? r.monthlyCents;
    charity += r.charityDeltaCents ?? 0;
  }
  const startCovered = need <= room(charity);

  const items: SalaryCheck["items"] = [];
  for (const r of rest) {
    if (isCutRung(r)) {
      // Already folded into today's costs above; a cut always fits.
      items.push({ id: r.id, kind: r.kind, label: r.label, monthlyCents: r.monthlyCents, covered: true });
      continue;
    }
    const nextNeed = need + (r.needDeltaCents ?? r.monthlyCents);
    const nextCharity = charity + (r.charityDeltaCents ?? 0);
    const covered = startCovered && nextNeed <= room(nextCharity);
    if (covered) {
      need = nextNeed;
      charity = nextCharity;
    }
    items.push({ id: r.id, kind: r.kind, label: r.label, monthlyCents: r.monthlyCents, covered });
  }
  const spendable = room(charity);
  return { spendableMonthlyCents: spendable, startCovered, items, leftOverMonthlyCents: spendable - need };
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

export interface SalaryVerdict {
  grossAnnualCents: number;
  /** True when the salary covers today's costs and every switched-on row. */
  covered: boolean;
  /** What is left a month once everything it covers is paid (Check a salary's Left over). */
  leftOverMonthlyCents: number;
  /** When not covered: everything switched on, less what the salary leaves, a month. 0 when covered. */
  shortMonthlyCents: number;
  /** What it does not cover, in list order; "Today's costs" first when even those do not fit. */
  notCovered: string[];
}

/**
 * Does `grossAnnualCents` cover everything switched on? Check a salary's walk
 * decides what it covers; the shortfall is the whole switched-on month (to live
 * and hit goals) less what the salary leaves to spend.
 */
export function salaryVerdict(ladder: WhatIfLadder, grossAnnualCents: number, settings: SalaryAssumptions, ctx: SalaryCheckContext): SalaryVerdict {
  const check = checkSalary(ladder, grossAnnualCents, settings, ctx);
  const covered = check.startCovered && check.items.every((i) => i.covered);
  const room = spendableAtSalary(grossAnnualCents, ladder.charityLineMonthlyCents * 12, assumptionsUnder(settings, ctx.whatIf), undefined, { current: ctx.currentSalary === true }).spendableMonthlyCents;
  const needAll = (ladder.needToLiveAndHitGoalsMonthlyCents ?? ladder.needToLiveMonthlyCents) + yearlyBillsMonthCents(settings);
  return {
    grossAnnualCents,
    covered,
    leftOverMonthlyCents: check.leftOverMonthlyCents,
    shortMonthlyCents: covered ? 0 : Math.max(0, needAll - room),
    notCovered: [...(check.startCovered ? [] : ["Today's costs"]), ...check.items.filter((i) => !i.covered).map((i) => i.label)],
  };
}

/**
 * The verdict in the user's words: "$150,000 covers everything switched
 * on, with $1,500 a month left over." or "$150,000 is $600 a month short; it does
 * not cover: New car, Saving for House." Names that carry a comma are kept apart
 * with semicolons, so "Panama trip, 8 days" still reads as one name.
 */
export function verdictText(v: SalaryVerdict, whose: "own" | "current" = "own"): string {
  // With no salary of its own, a what-if keeps the current salary, so the verdict names it.
  const salary = whose === "current" ? `Your current salary, ${formatWholeDollars(v.grossAnnualCents)},` : formatWholeDollars(v.grossAnnualCents);
  if (v.covered) return `${salary} covers everything switched on, with ${formatWholeDollars(v.leftOverMonthlyCents)} a month left over.`;
  const names = v.notCovered.join(v.notCovered.some((n) => n.includes(",")) ? "; " : ", ");
  return `${salary} is ${formatWholeDollars(v.shortMonthlyCents)} a month short; it does not cover: ${names}.`;
}

/** Why a change cannot be saved, in plain words; null when it can. */
export function changeProblem(c: WhatIfChange): string | null {
  if (!CHANGE_KINDS.has(c.kind)) return "That kind of change is not recognized.";
  if (!c.label || !c.label.trim()) return "Give the change a name.";
  if (isOneTime(c)) {
    // A label, an amount and the month it is paid; no budget line.
    if (!PERIOD.test(c.fromPeriod ?? "")) return "Pick the month it is paid.";
    if (!Number.isFinite(c.amountCents) || c.amountCents < 0) return "A cost cannot be below zero.";
    return null;
  }
  if (!c.planningCategory || !c.planningCategory.trim()) return "Pick a budget line.";
  if (isIncomeCategory(c.planningCategory)) return "Income is not a cost. A what-if's salary goes in Income while this is on.";
  if (!PERIOD.test(c.fromPeriod ?? "")) return "Pick a start month.";
  if (c.untilPeriod !== null && !PERIOD.test(c.untilPeriod)) return "Pick an end month, or leave it open.";
  if (c.untilPeriod !== null && c.untilPeriod < c.fromPeriod) return "The end month is before the start month.";
  if (!Number.isFinite(c.amountCents) || c.amountCents < 0) return "A cost cannot be below zero.";
  if (c.kind === "car" || c.kind === "mortgage") {
    if (!c.loan) return "A car or a mortgage needs its loan details.";
    return loanProblem(c.loan);
  }
  return null;
}

/** Why a what-if cannot be saved, in plain words; null when it can. */
export function whatIfProblem(w: WhatIf): string | null {
  if (w.salaryGrossAnnualCents !== null) {
    if (!Number.isFinite(w.salaryGrossAnnualCents) || w.salaryGrossAnnualCents < 0) return "A salary cannot be below zero.";
    // An open month starts with the current salary.
    if (w.salaryFromPeriod !== null && w.salaryFromPeriod !== undefined && !PERIOD.test(w.salaryFromPeriod)) return "Pick the month the salary starts, or leave it empty.";
  }
  if (w.additionalSalary !== undefined && w.additionalSalary !== null && w.additionalSalary !== "none") {
    if (typeof w.additionalSalary !== "object") return "That kind of additional salary is not recognized.";
    const p = additionalSalaryProblem(w.additionalSalary);
    if (p) return p;
  }
  // A repeated change id would otherwise reach the database's own primary key
  // (what_if_changes.id) and surface as SQLite's own text.
  const seenIds = new Set<string>();
  for (const c of w.changes) {
    if (seenIds.has(c.id)) return "Two changes share the same id.";
    seenIds.add(c.id);
    const p = changeProblem(c);
    if (p) return p;
  }
  if (!Array.isArray(w.rows)) return "A what-if needs its list of rows.";
  const seenRows = new Set<string>();
  for (const r of w.rows) {
    if (!r || !ROW_KINDS.has(r.kind)) return "That kind of row is not recognized.";
    if (!r.refId || typeof r.refId !== "string") return "A row needs the change or goal it points to.";
    if (!Number.isInteger(r.position)) return "A row's order must be a whole number.";
    if (typeof r.on !== "boolean") return "A row must be switched on or off.";
    if (seenRows.has(rowKey(r))) return "The same row is listed twice.";
    seenRows.add(rowKey(r));
  }
  return null;
}
