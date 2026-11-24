// src/ui/lib/instrument.ts
//
// The masthead's reading.
//
// The new shell keeps one figure on screen at all times: how long the money
// lasts. That figure sits directly above the Runway panel, so the two must
// agree by construction rather than by coincidence. It therefore runs the SAME
// path the panel runs -- projectFutureNet then computeRunway -- instead of a
// flat approximation of it. An earlier version did approximate, and the head
// and the panel promptly disagreed on screen: 10.1 months against 11.
//
// The one thing added here is a FRACTIONAL headline figure, which computeRunway
// does not provide because it counts whole months.
import { computeRunway, drawableLiquidCents, isHeldBackAccount } from "../../domain/runway";
import { projectFutureNet, projectedIncomeCents } from "../../domain/runway-projection";
import type { Account } from "../../domain/types";
import type { AccountBalance, BudgetLine } from "../../domain/plan-types";
import type { CategorySetting } from "../../domain/category-settings";
import { addMonths, applyScenarioToLines, scenarioOverlays, type Scenario } from "../../domain/scenario";
import { composeViewLines, viewTotals } from "../../domain/lifestyle-view";
import type { LifestyleGroup } from "../../domain/lifestyle-groups";
import { salaryForView, DEFAULT_SALARY_ASSUMPTIONS, type SalaryAssumptions } from "../../domain/salary";
import { taxSetUpNeeded } from "../../domain/tax";
import { potIsOn, potLabel } from "../../domain/charity-pot";
import { incomeStatement, takeHomeBridge, type IncomeStatement, type TakeHomeBridge } from "../../domain/income-statement";
import { resolveMonthlyPlan, usualMonthLines } from "../../domain/budget";
import { isIncomeCategory } from "../../domain/dedup";
import {
  CHARITY_LINE,
  assumptionsUnder,
  whatIfSalaryStart,
  composeWhatIf,
  datedChange,
  forecastCostStart,
  ladderGoalsFrom,
  lineAfterChanges,
  maaserShortfallCents,
  normalMonthCents,
  onChanges,
  plannedGoalCosts,
  whatIfLadder,
  whatIfPeriods,
  type WhatIf,
} from "../../domain/what-if";
import type { Goal, GoalAccountLink } from "../../domain/plan-types";
import type { NormalizedTxn } from "../../domain/types";
import { monthEquation, paySteps, payStepsEstimated, yearEquation, yearPaySteps, yearPayStepsEstimated, type MonthEquation, type YearEquation } from "../../domain/equation";
import type { StatementLine } from "../../domain/income-statement";
import type { BigMonth, BudgetChange, Plan } from "../../domain/plan-types";

export interface InstrumentInput {
  drawableCents: number;
  /** The plan's future months, from projectFutureNet. Negative net = spending. */
  futureMonthlyNet: { period: string; netCents: number }[];
  /** The month the balance is measured in, "YYYY-MM". */
  asOf: string;
  /** Budget of record per month, shown as a readout. Positive = leaving. */
  burnCents: number;
}

export interface InstrumentReading {
  drawableCents: number;
  burnCents: number;
  /**
   * Months of runway, fractional. Null means the money never runs out.
   *
   * Fractional on purpose: a scenario scrubber changes this many times a
   * second, and a whole-month figure would sit still through most of a drag.
   *
   * Counted from TODAY, so the current month is included even though
   * projectFutureNet starts at the following one. The projection skips the
   * current month because it is already partly spent, but the balance being
   * drawn down is today's, so the month you are standing in is still runway.
   */
  runwayMonths: number | null;
  /** The month whose spending exhausts the balance. */
  crossPeriod: string | null;
  /** What the gauge draws. Clamped at zero: a runway ends, it does not invert. */
  series: { period: string; cents: number }[];
}

export function readInstrument({
  drawableCents,
  futureMonthlyNet,
  asOf,
  burnCents,
}: InstrumentInput): InstrumentReading {
  const { crossZeroPeriod, liquidByMonth } = computeRunway(drawableCents, futureMonthlyNet);

  // The series opens at today's balance, so the first point is the drawable
  // figure itself rather than the balance after a month of spending.
  const series = [
    { period: asOf, cents: Math.max(drawableCents, 0) },
    ...liquidByMonth.map((p) => ({ period: p.period, cents: Math.max(p.cents, 0) })),
  ];

  let runwayMonths: number | null = null;
  if (crossZeroPeriod !== null) {
    const k = futureMonthlyNet.findIndex((m) => m.period === crossZeroPeriod);
    const before = k === 0 ? drawableCents : liquidByMonth[k - 1].cents;
    const spent = Math.abs(futureMonthlyNet[k].netCents);
    // +1 for the current month, which the projection excludes but which the
    // money is nonetheless funding.
    runwayMonths = 1 + k + (spent > 0 ? before / spent : 0);
  }

  return { drawableCents, burnCents, runwayMonths, crossPeriod: crossZeroPeriod, series };
}

// ---------------------------------------------------------------------------
// Feeding the masthead from live data.
// ---------------------------------------------------------------------------

export interface MastheadSummaryInput {
  accounts: Account[];
  balances: AccountBalance[];
  budgetLines: BudgetLine[];
  categorySettings: CategorySetting[];
  uncategorizedCount: number;
  ruleCount: number;
  lastSyncedAt: string | null;
  /** ISO date. The projection runs from the month after this one. */
  asOfDate: string;
  horizonMonths?: number;
  /** A saved scenario to overlay. The recorded plan becomes the baseline. */
  scenario?: Scenario | null;
  /** The saved salary assumptions. Defaults when not loaded. */
  salaryAssumptions?: SalaryAssumptions;
  /** The household's saved lifestyle groups; the starter groups when absent. */
  lifestyleGroups?: LifestyleGroup[];
  /** The what-if behind `scenario`, when it is one. Monthly budget and Salary needed follow it. */
  whatIf?: WhatIf | null;
  /** The goals, so a switched-on goal cost row counts under a what-if, and a goal saving row in Salary needed. */
  goals?: Goal[];
  /**
   * What the top bar's statement reads: the prepared rows,
   * the big months and the budget year. Absent or null: no statement (the bar shows its loading state).
   */
  equationSource?: {
    prepared: NormalizedTxn[];
    mapping: Record<string, string>;
    bigMonths: BigMonth[];
    changes: BudgetChange[];
    plan: Pick<Plan, "startDate" | "endDate"> | null;
  } | null;
  /** The goals' account links, so a goal's saving a month is priced as the What if screen prices it. */
  goalLinks?: GoalAccountLink[];
  /** The transactions, for the same reason (a goal that took money this month skips it). */
  transactions?: NormalizedTxn[];
}

export interface MastheadSummary {
  reading: InstrumentReading;
  /** The recorded plan's series, present only when a scenario is overlaid. */
  baselineSeries: { period: string; cents: number }[] | null;
  scenarioLabel: string | null;
  heldBackCents: number;
  /** True when the recorded budget has income in the projected months. */
  incomeModeled: boolean;
  recurringCents: number;
  variableCents: number;
  accountCount: number;
  uncategorizedCount: number;
  ruleCount: number;
  lastSyncedAt: string | null;
  /** The top bar's statement: this month, the budget year, and the pay steps behind "into the bank". */
  equation: {
    month: MonthEquation;
    year: YearEquation | null;
    paySteps: {
      monthly: StatementLine[] | null;
      yearly: StatementLine[] | null;
      /** True when the steps use estimated taxes (no firm figures typed, or a what-if salary): the note shows. */
      estimated: { monthly: boolean; yearly: boolean };
    };
    /** The charity pot's name for its term; null while the pot is off (the term is not shown). Absent: "charity". */
    potName?: string | null;
    /** True while the tax step is not set up: estimated pay steps show the set-this-up card. Absent: false. */
    taxSetUpNeeded?: boolean;
  } | null;
  /** The salary the active view needs. Null when the composed view has no expense lines. */
  salary: {
    grossAnnualCents: number;
    charityMonthlyCents: number;
    premiumMonthlyCents: number;
    /** Take-home needed (net), a year, and the steps from gross to it. */
    takeHomeAnnualCents: number;
    federalAnnualCents: number;
    ficaAnnualCents: number;
    premiumAnnualCents: number;
    charityAnnualCents: number;
    /** An additional W-2 salary taxed with the user's, a year. Absent or 0 = none. */
    otherGrossAnnualCents?: number;
    /** An additional monthly amount, a year, added after tax. Absent or 0 = none. */
    otherNetAnnualCents?: number;
    /**
     * The salary as an income statement: the take-home panel reads it. Under a what-if it is the ladder's own
     * Salary to live and hit goals statement, so the bar and the ladder cannot disagree.
     */
    statement: IncomeStatement;
    /**
     * Take-home needed and the line that explains it: Monthly budget,
     * less the Charity line, plus any goal savings switched on, always (both price the usual
     * month). The bar's Take-home needed reads takeHomeNeededCents; it
     * equals the statement's "in all".
     */
    bridge: TakeHomeBridge;
    /** A goal saving row is switched on under the active what-if: Salary needed says "with goals". */
    withGoals: boolean;
  } | null;
}

/** Mirrors the app's own retirement check, so both stay in step. */

/**
 * Everything the head needs, from the raw reads.
 *
 * Three traps live here. Only DEFAULT budget lines (period null) make up the
 * displayed monthly burn -- a per-month override replaces its default rather
 * than adding to it, so summing every row double counts. Retirement balances
 * are held back from drawable but still surfaced, so they read as deliberately
 * excluded rather than silently missing. And archived accounts are superseded
 * records, so they are not counted in the account tally even though the
 * transactions they own still count everywhere else.
 */
export function summariseForMasthead(input: MastheadSummaryInput): MastheadSummary {
  // The usual month: Monthly budget, Salary needed and
  // Take-home needed all price each line's every-month amount, so a one-month amount
  // never moves them. The runway below reads every line, month by month. Monthly budget
  // and the Fixed and Variable cards read the amounts in force THIS month; Salary needed
  // reads NEXT month's.
  const a = input.salaryAssumptions ?? DEFAULT_SALARY_ASSUMPTIONS;
  const asOfMonth = input.asOfDate.slice(0, 7);
  const nextMonth = addMonths(asOfMonth, 1);
  const defaults = usualMonthLines(input.budgetLines, asOfMonth);
  const realBurnCents = normalMonthCents(input.budgetLines, asOfMonth);

  // A what-if is composed here too, so the bar is right
  // even if the row reached it uncomposed. Its Monthly budget is priced like its
  // ladder: today's budget plus every change at the price month, plus the charity
  // pot's raise of Charity once the salary is on. Down payments are one-time, so
  // they stay out of it.
  const whatIf = input.scenario && input.whatIf && input.whatIf.scenarioId === input.scenario.id ? input.whatIf : null;
  // A switched-on goal cost row rides along:
  // in the composed lines, inside Salary to live on the ladder, and in Monthly
  // budget below. A switched-on goal saving row counts in Salary needed and
  // Take-home needed only, never Monthly
  // budget. A switched-off row counts nowhere.
  const goalCosts = whatIf ? plannedGoalCosts(whatIf, input.goals ?? []) : [];
  const scenario = whatIf
    ? composeWhatIf(input.scenario!, whatIf, input.budgetLines, whatIfPeriods(asOfMonth), a, goalCosts, forecastCostStart(whatIf, a, nextMonth))
    : input.scenario ?? null;
  const ladderGoals = whatIf
    ? ladderGoalsFrom(input.goals ?? [], { accounts: input.accounts, balances: input.balances, links: input.goalLinks ?? [], txns: input.transactions ?? [] }, input.asOfDate)
    : [];
  const ladder = whatIf ? whatIfLadder(whatIf, input.budgetLines, ladderGoals, nextMonth, a, input.lifestyleGroups) : null;
  let burnCents = realBurnCents;
  // The Charity line as Monthly budget counts it, for the bridge line:
  // the every-month line, moved by any change to it, raised to a what-if salary's pot month.
  let charityInBurnCents = defaults.filter((l) => l.planningCategory === CHARITY_LINE).reduce((sum, l) => sum + l.amountCents, 0);
  if (whatIf && ladder) {
    const pm = ladder.priceMonth;
    // Every switched-on change at its full amount (no start months).
    const changes = onChanges(whatIf).map((c) => datedChange(c, pm));
    // Each change moves its line from the usual amount, as the ladder prices it.
    for (const line of new Set(changes.map((c) => c.planningCategory))) {
      const moved = lineAfterChanges(changes, defaults, line, pm) - resolveMonthlyPlan(defaults, line, pm);
      burnCents += moved;
      if (line === CHARITY_LINE) charityInBurnCents += moved;
    }
    const start = whatIfSalaryStart(whatIf, a);
    const salaryMonth = start && start > pm ? start : pm;
    const raise = maaserShortfallCents(whatIf, defaults, salaryMonth, a);
    burnCents += raise;
    charityInBurnCents += raise;
    burnCents += goalCosts.reduce((sum, c) => sum + c.monthlyCents, 0);
  }

  const recurringBy = new Map(input.categorySettings.map((s) => [s.planningCategory, s.recurring]));
  let recurringCents = 0;
  let variableCents = 0;
  // Fixed and Variable add up to Monthly budget, so income lines stay out here too.
  for (const line of defaults) {
    if (isIncomeCategory(line.planningCategory)) continue;
    if (recurringBy.get(line.planningCategory)) recurringCents += line.amountCents;
    else variableCents += line.amountCents;
  }

  const live = input.accounts.filter((a) => !a.archived);
  // The same rule the Position card's "Held back" rows use (runway.ts).
  const heldBackCents = live
    .filter(isHeldBackAccount)
    .reduce((sum, a) => {
      const b = input.balances.find((x) => x.accountId === a.id);
      return sum + (b?.balanceCents ?? 0);
    }, 0);

  const horizon = input.horizonMonths ?? 24;
  const asOf = input.asOfDate.slice(0, 7);
  const drawableCents = drawableLiquidCents(input.accounts, input.balances);
  const read = (lines: BudgetLine[]) =>
    readInstrument({
      drawableCents,
      futureMonthlyNet: projectFutureNet(lines, input.asOfDate, horizon),
      asOf,
      burnCents,
    });

  // A scenario is an overlay on the recorded plan, never an edit of it: the
  // same income ramp and expense deltas the Scenarios panel composes, laid
  // onto the same lines. The recorded plan stays as the baseline the gauge
  // draws dashed underneath.
  const baseline = read(input.budgetLines);
  let reading = baseline;
  const periods = Array.from({ length: horizon }, (_, i) => addMonths(asOf, i + 1));
  if (scenarioOverlays(scenario)) reading = read(applyScenarioToLines(input.budgetLines, scenario, periods));
  // Does the RECORDED budget carry any income in the window? The Dashboard's
  // sentence said "assuming no income at all" regardless.
  const incomeModeled = projectedIncomeCents(input.budgetLines, periods) > 0;

  // The salary the active view needs. Under a what-if it is the ladder's Salary
  // to live and hit goals: every switched-on cost and goal saving row;
  // otherwise the same composed lines the Lifestyle editor showed (the usual month,
  // deltas then overrides; a one-month amount never moves it).
  const groups = composeViewLines(usualMonthLines(input.budgetLines, nextMonth), scenario, nextMonth, input.lifestyleGroups);
  const totals = ladder
    ? { needExCharityCents: ladder.needToLiveAndHitGoalsMonthlyCents ?? ladder.needToLiveMonthlyCents, charityLineCents: ladder.charityLineMonthlyCents }
    : viewTotals(groups);
  const salary =
    groups.length === 0 && !ladder
      ? null
      : (() => {
          // The user's salary given the additional one: a what-if's own, or None, decides it.
          const under = assumptionsUnder(a, whatIf);
          const b = salaryForView(totals.needExCharityCents * 12, totals.charityLineCents * 12, under);
          // One statement for the bar and the ladder: under a what-if, the ladder's own.
          // Otherwise the same function on the bar's lines, the Charity line left out of Expenses.
          const statement =
            ladder?.statements?.toLiveAndHitGoals ??
            incomeStatement({
              breakdown: b,
              assumptions: under,
              charityLineMonthlyCents: totals.charityLineCents,
              expenses: groups.flatMap((g) => g.lines).map((l) => ({ label: l.planningCategory, cents: l.viewCents })),
            });
          // Goal savings switched on: never in Monthly budget, always in Take-home needed.
          const goalSavingCents = ladder ? (ladder.needToLiveAndHitGoalsMonthlyCents ?? ladder.needToLiveMonthlyCents) - ladder.needToLiveMonthlyCents : 0;
          return {
            grossAnnualCents: b.grossAnnualCents,
            charityMonthlyCents: Math.round(b.charityAnnualCents / 12),
            premiumMonthlyCents: a.premiumMonthlyCents,
            takeHomeAnnualCents: b.takeHomeAnnualCents,
            federalAnnualCents: b.federalAnnualCents,
            ficaAnnualCents: b.ficaAnnualCents,
            premiumAnnualCents: b.premiumAnnualCents,
            charityAnnualCents: b.charityAnnualCents,
            otherGrossAnnualCents: b.otherGrossAnnualCents,
            otherNetAnnualCents: b.otherNetAnnualCents,
            statement,
            bridge: takeHomeBridge(burnCents, charityInBurnCents, goalSavingCents),
            withGoals: !!ladder && ladder.rungs.some((r) => r.kind === "goal"),
          };
        })();

  // The top bar's statement. Under a what-if, its budget and salary price this month and later.
  const src = input.equationSource ?? null;
  let equation: MastheadSummary["equation"] = null;
  if (src) {
    const yearEnd = src.plan ? src.plan.endDate.slice(0, 7) : asOfMonth;
    const ahead: string[] = [];
    for (let m = asOfMonth; m <= yearEnd; m = addMonths(m, 1)) ahead.push(m);
    const eqInput = {
      prepared: src.prepared,
      accounts: input.accounts,
      mapping: src.mapping,
      // A what-if's switched-on changes count from this month in the bar, unlike the Forecast, which starts costs next month.
      lines: whatIf && input.scenario
        ? applyScenarioToLines(input.budgetLines, composeWhatIf(input.scenario, whatIf, input.budgetLines, whatIfPeriods(asOfMonth), a, goalCosts, asOfMonth), ahead)
        : input.budgetLines,
      changes: src.changes,
      bigMonths: src.bigMonths,
      salary: a,
      whatIf,
    };
    equation = {
      month: monthEquation(eqInput, asOfMonth, input.asOfDate),
      year: src.plan ? yearEquation(eqInput, src.plan, input.asOfDate) : null,
      paySteps: {
        monthly: paySteps(eqInput, asOfMonth, "monthly"),
        yearly: src.plan ? yearPaySteps(eqInput, src.plan, input.asOfDate) : null,
        estimated: { monthly: payStepsEstimated(eqInput, [asOfMonth]), yearly: src.plan ? yearPayStepsEstimated(eqInput, src.plan, input.asOfDate) : false },
      },
      potName: a.pot === undefined || potIsOn(a.pot) ? potLabel(a.pot) : null,
      taxSetUpNeeded: taxSetUpNeeded(a),
    };
  }

  return {
    reading,
    equation,
    baselineSeries: reading === baseline ? null : baseline.series,
    // A what-if is named whenever it is on, even one that changes nothing yet;
    // an older scenario only when it changes something (as before).
    scenarioLabel: whatIf ? scenario!.name : reading === baseline ? null : scenario!.name,
    heldBackCents,
    incomeModeled,
    recurringCents,
    variableCents,
    accountCount: live.length,
    uncategorizedCount: input.uncategorizedCount,
    ruleCount: input.ruleCount,
    lastSyncedAt: input.lastSyncedAt,
    salary,
  };
}
