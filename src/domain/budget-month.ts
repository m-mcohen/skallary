// src/domain/budget-month.ts -- the Budget's month screen as numbers. Everything the screen shows for a month comes from here: each
// line's budget, spent, left, comparison and change; the colors and tags; the groups and
// their subtotals; Left over; the line panel's figures; and what a change would do to
// Left over before it is saved. Pure: today is always passed in.
//
// The average month: complete months only, never the month in progress;
// months with nothing count as zero; it starts at the line's first month with spending
// and covers at most the last 3 or 12. Mid-month every comparison uses the same days.
import { budgetBarTone, changeTone, headingFor, isHeadingOver, leftTone, type LineSide, type Tone } from "./budget-colors";
import { lineBudget, PAYCHECKS_LINE, settingsMoneyIn, sideOf, type LineBudget } from "./budget-income";
import { expandChanges } from "./budget-changes";
import { MAASER_CATEGORY } from "./scenario";
import { potAccountIds } from "./maaser-pot";
import { firstMonthOf } from "./dashboard-month";
import { formatPeriodLabel, monthBounds } from "./period";
import { rollupMonthly } from "./rollups";
import { addMonths } from "./scenario";
import { priorMonths } from "./seed";
import type { CategorySetting } from "./category-settings";
import type { BigMonth, BudgetChange, BudgetLine, MonthNote, Plan } from "./plan-types";
import type { SalaryAssumptions } from "./salary";
import type { Account, NormalizedTxn } from "./types";

export type CompareChoice = "avg-12" | "avg-3" | "last-month" | "last-year" | `month:${string}`;

export const COMPARE_CHOICES: { id: "avg-12" | "avg-3" | "last-month" | "last-year" | "month"; label: string }[] = [
  { id: "avg-12", label: "12-month average" },
  { id: "avg-3", label: "3-month average" },
  { id: "last-month", label: "Last month" },
  { id: "last-year", label: "Same month last year" },
  { id: "month", label: "A specific month" },
];

/** The comparison column's heading: it names what the month is against. */
export function comparisonLabel(choice: CompareChoice, month: string): string {
  if (choice === "avg-12") return "12-month average";
  if (choice === "avg-3") return "3-month average";
  if (choice === "last-month") return formatPeriodLabel(addMonths(month, -1));
  if (choice === "last-year") return formatPeriodLabel(addMonths(month, -12));
  return formatPeriodLabel(choice.slice("month:".length));
}

export type Group = "fixed" | "variable" | "income";

export interface MonthRow {
  key: string;
  line: string;
  side: LineSide;
  group: Group;
  fixed: boolean;
  budgetCents: number | null;
  budgetFrom: LineBudget["from"];
  bigMonths: BigMonth[];
  spentCents: number;
  leftCents: number | null;
  comparisonCents: number | null;
  changeCents: number | null;
  barTone: Tone;
  leftTone: Tone;
  changeTone: Tone;
  headingOver: boolean;
  setByYou: boolean;
  note: string | null;
  hidden: boolean;
}

export interface MonthTotals {
  label: string;
  budgetCents: number | null;
  spentCents: number;
  leftCents: number | null;
  comparisonCents: number | null;
  changeCents: number | null;
  leftTone: Tone;
  changeTone: Tone;
}

export interface MonthSection {
  id: "fixed" | "variable" | "income" | "spending";
  title: string;
  rows: MonthRow[];
  subtotal: MonthTotals;
}

export interface MonthView {
  month: string;
  inProgress: boolean;
  /** Mid-month, the last day counted in every month (same days); null for a finished month. */
  throughDay: number | null;
  comparisonLabel: string;
  sections: MonthSection[];
  leftOver: MonthTotals;
  hiddenCount: number;
  noSalaryNote: string | null;
  /**
   * The largest change on screen for each side, so the change bars on a side share one
   * scale and an income gap (a paycheck not in yet) never shrinks every spending bar.
   */
  changeScale: { spending: number; income: number };
}

export interface BudgetInputs {
  prepared: NormalizedTxn[];
  accounts: Account[];
  mapping: Record<string, string>;
  lines: BudgetLine[];
  changes: BudgetChange[];
  bigMonths: BigMonth[];
  notes: MonthNote[];
  settings: CategorySetting[];
  salary: SalaryAssumptions;
  /** Transactions matched to yearly bills, left out of averages only. Absent = none. */
  yearlyTxnIds?: string[];
}

export type Sums = Map<string, Map<string, number>>;
export const keyOf = (side: LineSide, line: string) => `${side}|${line}`;

export function sumRollups(prepared: NormalizedTxn[], accounts: Account[], mapping: Record<string, string>): Sums {
  const out: Sums = new Map();
  for (const r of rollupMonthly(prepared, accounts, mapping)) {
    const side: LineSide | null = r.kind === "expense" ? "spending" : r.kind === "income" || r.kind === "investment_income" ? "income" : null;
    if (!side) continue;
    const k = keyOf(side, r.planningCategory);
    const byMonth = out.get(k) ?? new Map<string, number>();
    byMonth.set(r.period, (byMonth.get(r.period) ?? 0) + r.amountCents);
    out.set(k, byMonth);
  }
  return out;
}

export function firstSpend(full: Sums, k: string): string | null {
  let first: string | null = null;
  for (const [period, cents] of full.get(k) ?? []) if (cents !== 0 && (first === null || period < first)) first = period;
  return first;
}

export function averageOf(counted: Sums, full: Sums, k: string, beforeMonth: string, n: 3 | 12): number | null {
  const first = firstSpend(full, k);
  if (!first) return null;
  const months = priorMonths(beforeMonth, n).filter((m) => m >= first);
  if (months.length === 0) return null;
  const byMonth = counted.get(k);
  return Math.round(months.reduce((sum, m) => sum + (byMonth?.get(m) ?? 0), 0) / months.length);
}

const daysIn = (month: string) => Number(monthBounds(month).to.slice(8));

export function sumsForAverages(input: Pick<BudgetInputs, "prepared" | "accounts" | "mapping" | "yearlyTxnIds">, throughDay: number | null): Sums {
  const ids = new Set(input.yearlyTxnIds);
  const prepared = ids.size ? input.prepared.filter(row => !ids.has(row.sourceTransactionId)) : input.prepared;
  return sumRollups(sameDays(prepared, throughDay), input.accounts, input.mapping);
}

// The Charity line takes no over-budget tone only while the charity pot is on (giving is then set aside; plan B2, Step 6).
export function charityToneSuppressed(salary: BudgetInputs["salary"]): boolean {
  return salary.pot?.on === true;
}

function sameDays(prepared: NormalizedTxn[], throughDay: number | null): NormalizedTxn[] {
  return throughDay === null ? prepared : prepared.filter((t) => Number(t.date.slice(8, 10)) <= throughDay);
}

export function isSetByYou(lines: BudgetLine[], changes: BudgetChange[], line: string): boolean {
  return (
    lines.some((l) => l.planningCategory === line && (l.period === null || l.period === "") && l.origin !== "change" && l.source === "you") ||
    changes.some((c) => c.planningCategory === line && c.reason === "changed")
  );
}

/** Every line the Budget shows, spending or income: anything with a budget, spending, a big month or a salary. */
function lineKeys(input: BudgetInputs, full: Sums, month: string): { side: LineSide; line: string }[] {
  const seen = new Map<string, { side: LineSide; line: string }>();
  const add = (side: LineSide | null, line: string) => {
    if (side) seen.set(keyOf(side, line), { side, line });
  };
  for (const k of full.keys()) {
    const at = k.indexOf("|");
    const side = k.slice(0, at) as LineSide;
    const line = k.slice(at + 1);
    if (sideOf(line) !== null) add(side, line);
  }
  for (const l of input.lines) add(sideOf(l.planningCategory), l.planningCategory);
  for (const b of input.bigMonths) add("spending", b.planningCategory);
  if (settingsMoneyIn(input.salary, month).paycheckCents !== null) add("income", PAYCHECKS_LINE);
  if (settingsMoneyIn(input.salary, month).maaserCents > 0) add("spending", MAASER_CATEGORY);
  // With a pot, Charity is always a line: its panel is where the pot is read, even in a month
  // that cost take-home nothing.
  if (potAccountIds(input.accounts).size > 0) add("spending", MAASER_CATEGORY);
  return [...seen.values()];
}

function totals(label: string, side: LineSide, rows: MonthRow[], finished: boolean, budgetCents?: number | null): MonthTotals {
  const budget = budgetCents !== undefined
    ? budgetCents
    : rows.some((r) => r.budgetCents !== null) ? rows.reduce((s, r) => s + (r.budgetCents ?? 0), 0) : null;
  const spent = rows.reduce((s, r) => s + r.spentCents, 0);
  const comparison = rows.some((r) => r.comparisonCents !== null) ? rows.reduce((s, r) => s + (r.comparisonCents ?? 0), 0) : null;
  return {
    label,
    budgetCents: budget,
    spentCents: spent,
    leftCents: budget === null ? null : budget - spent,
    comparisonCents: comparison,
    changeCents: comparison === null ? null : spent - comparison,
    leftTone: leftTone(side, budget, spent, finished),
    changeTone: changeTone(side, spent, comparison, true),
  };
}

export function buildMonthView(
  input: BudgetInputs & { month: string; today: string; compare: CompareChoice; sort: "group" | "change" },
): MonthView {
  const { month, today, compare } = input;
  const thisMonth = today.slice(0, 7);
  const inProgress = month === thisMonth;
  const finished = month < thisMonth;
  const day = Number(today.slice(8, 10));
  const throughDay = inProgress ? day : null;
  const full = sumRollups(input.prepared, input.accounts, input.mapping);
  const counted = inProgress ? sumRollups(sameDays(input.prepared, throughDay), input.accounts, input.mapping) : full;
  const averageFull = input.yearlyTxnIds?.length ? sumsForAverages(input, null) : full;
  const averageCounted = inProgress && input.yearlyTxnIds?.length ? sumsForAverages(input, throughDay) : inProgress ? counted : averageFull;
  const firstData = firstMonthOf(input.prepared);
  const fixedLines = new Set(input.settings.filter((s) => s.recurring === true).map((s) => s.planningCategory));
  const one = (k: string, p: string): number | null => (firstData === null || p < firstData ? null : counted.get(k)?.get(p) ?? 0);
  const comparisonOf = (k: string): number | null => {
    if (compare === "avg-12") return averageOf(averageCounted, averageFull, k, month, 12);
    if (compare === "avg-3") return averageOf(averageCounted, averageFull, k, month, 3);
    if (compare === "last-month") return one(k, addMonths(month, -1));
    if (compare === "last-year") return one(k, addMonths(month, -12));
    return one(k, compare.slice("month:".length));
  };

  const rows: MonthRow[] = lineKeys(input, full, month).map(({ side, line }) => {
    const k = keyOf(side, line);
    const spent = counted.get(k)?.get(month) ?? 0;
    const budget = lineBudget(input, line, side, month);
    const fixed = side === "spending" && fixedLines.has(line);
    const group: Group = side === "income" ? "income" : fixed ? "fixed" : "variable";
    const comparison = comparisonOf(k);
    const bigs = input.bigMonths.filter((b) => b.planningCategory === line && b.month === month);
    const note = input.notes.find((x) => x.planningCategory === line && x.month === month)?.note ?? null;
    const usual = averageOf(averageFull, averageFull, k, month, 12);
    // Charity beyond the pot's share is allowed, so the Charity line takes no over-budget tone.
    const noTone = side === "spending" && line === MAASER_CATEGORY && charityToneSuppressed(input.salary);
    return {
      key: k,
      line,
      side,
      group,
      fixed,
      budgetCents: budget.cents,
      budgetFrom: budget.from,
      bigMonths: bigs,
      spentCents: spent,
      leftCents: budget.cents === null ? null : budget.cents - spent,
      comparisonCents: comparison,
      changeCents: comparison === null ? null : spent - comparison,
      barTone: noTone ? "grey" : budgetBarTone(side, spent, budget.cents),
      leftTone: noTone ? "grey" : leftTone(side, budget.cents, spent, finished),
      changeTone: noTone ? "grey" : changeTone(side, spent, comparison, fixed),
      headingOver: !noTone && inProgress && group === "variable" && isHeadingOver(spent, budget.cents, day, daysIn(month)),
      setByYou: line !== PAYCHECKS_LINE && isSetByYou(input.lines, input.changes, line),
      note,
      hidden: (budget.cents === null || budget.cents === 0) && spent === 0 && !usual && bigs.length === 0 && note === null,
    };
  });

  const byName = (a: MonthRow, b: MonthRow) => a.line.localeCompare(b.line);
  const of = (g: Group) => rows.filter((r) => r.group === g).sort(byName);
  const fixedRows = of("fixed");
  const variableRows = of("variable");
  const incomeRows = of("income");
  const noSalary = settingsMoneyIn(input.salary, month).paycheckCents === null;
  const fixedTotals = totals("Fixed costs", "spending", fixedRows, finished);
  const variableTotals = totals("Variable costs", "spending", variableRows, finished);
  const incomeTotals = totals("Income", "income", incomeRows, finished, noSalary ? null : undefined);
  const spending = [...fixedRows, ...variableRows];
  const spendingTotals = totals("All spending", "spending", spending, finished);

  const sections: MonthSection[] =
    input.sort === "change"
      ? [
          {
            id: "spending",
            title: "All spending, biggest change first",
            rows: [...spending].sort((a, b) => Math.abs(b.changeCents ?? -1) - Math.abs(a.changeCents ?? -1) || byName(a, b)),
            subtotal: spendingTotals,
          },
          { id: "income", title: "Income", rows: incomeRows, subtotal: incomeTotals },
        ]
      : [
          { id: "fixed", title: "Fixed costs", rows: fixedRows, subtotal: fixedTotals },
          { id: "variable", title: "Variable costs", rows: variableRows, subtotal: variableTotals },
          { id: "income", title: "Income", rows: incomeRows, subtotal: incomeTotals },
        ];

  const leftBudget = incomeTotals.budgetCents === null || spendingTotals.budgetCents === null ? null : incomeTotals.budgetCents - spendingTotals.budgetCents;
  const leftSpent = incomeTotals.spentCents - spendingTotals.spentCents;
  const leftComparison = incomeTotals.comparisonCents === null || spendingTotals.comparisonCents === null
    ? null
    : incomeTotals.comparisonCents - spendingTotals.comparisonCents;
  const leftOver: MonthTotals = {
    label: "Left over",
    budgetCents: leftBudget,
    spentCents: leftSpent,
    leftCents: null,
    comparisonCents: leftComparison,
    changeCents: leftComparison === null ? null : leftSpent - leftComparison,
    leftTone: "grey",
    changeTone: changeTone("income", leftSpent, leftComparison, true),
  };

  const visible = rows.filter((r) => !r.hidden);
  return {
    month,
    inProgress,
    throughDay,
    comparisonLabel: comparisonLabel(compare, month),
    sections,
    leftOver,
    hiddenCount: rows.length - visible.length,
    noSalaryNote: noSalary ? `No salary in Settings for ${formatPeriodLabel(month)}.` : null,
    changeScale: {
      spending: Math.max(1, ...visible.filter((r) => r.side === "spending").map((r) => Math.abs(r.changeCents ?? 0))),
      income: Math.max(1, ...visible.filter((r) => r.side === "income").map((r) => Math.abs(r.changeCents ?? 0))),
    },
  };
}

export interface LineFigures {
  months: { month: string; label: string; spentCents: number; budgetCents: number | null; tone: Tone }[];
  monthCents: number;
  headingForCents: number | null;
  lastMonthCents: number | null;
  highest: { month: string; cents: number } | null;
  avg3: number | null;
  avg12: number | null;
}

/** The line panel's figures for the open month: 12 months of bars, the figures beside them, the averages. */
export function lineFigures(input: BudgetInputs, line: string, side: LineSide, month: string, today: string): LineFigures {
  const thisMonth = today.slice(0, 7);
  const full = sumRollups(input.prepared, input.accounts, input.mapping);
  const k = keyOf(side, line);
  const at = (m: string) => full.get(k)?.get(m) ?? 0;
  const firstData = firstMonthOf(input.prepared);
  // The Charity line takes no over-budget tone, so its 12 bars are grey (charity beyond the pot's share is allowed).
  const charityLine = side === "spending" && line === MAASER_CATEGORY && charityToneSuppressed(input.salary);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)).map((m) => {
    const budget = lineBudget(input, line, side, m).cents;
    const tone: Tone = charityLine ? "grey" : budgetBarTone(side, at(m), budget);
    return { month: m, label: formatPeriodLabel(m).slice(0, 3), spentCents: at(m), budgetCents: budget, tone };
  });
  const complete = months.filter((m) => m.month < thisMonth && (firstData === null || m.month >= firstData));
  const highest = complete.reduce<{ month: string; cents: number } | null>(
    (best, m) => (best === null || m.spentCents > best.cents ? { month: m.month, cents: m.spentCents } : best),
    null,
  );
  const last = addMonths(month, -1);
  const avgBefore = month < thisMonth ? addMonths(month, 1) : thisMonth;
  const averages = input.yearlyTxnIds?.length ? sumsForAverages(input, null) : full;
  return {
    months,
    monthCents: at(month),
    headingForCents: month === thisMonth ? headingFor(at(month), Number(today.slice(8, 10)), daysIn(month)) : null,
    lastMonthCents: firstData === null || last < firstData ? null : at(last),
    highest,
    avg3: averageOf(averages, averages, k, avgBefore, 3),
    avg12: averageOf(averages, averages, k, avgBefore, 12),
  };
}

/** Left over in one month from the budget alone: income budget minus spending budget, big months in. */
export function budgetLeftOver(
  input: Pick<BudgetInputs, "lines" | "changes" | "bigMonths" | "salary">,
  month: string,
): { leftOverCents: number | null; spendingCents: number; incomeCents: number | null } {
  const names = new Set<string>([...input.lines.map((l) => l.planningCategory), ...input.bigMonths.map((b) => b.planningCategory), PAYCHECKS_LINE, MAASER_CATEGORY]);
  let spending = 0;
  let income = 0;
  for (const name of names) {
    const side = sideOf(name);
    if (!side) continue;
    const cents = lineBudget(input, name, side, month).cents ?? 0;
    if (side === "spending") spending += cents;
    else income += cents;
  }
  const incomeCents = settingsMoneyIn(input.salary, month).paycheckCents === null ? null : income;
  return { leftOverCents: incomeCents === null ? null : incomeCents - spending, spendingCents: spending, incomeCents };
}

/** The "changed" changes a save would replace: from a month on, the later ones (that month's own is an edit); every month, all. */
export function replacedBy(changes: BudgetChange[], line: string, fromMonth: string | null): BudgetChange[] {
  return changes
    .filter((c) => c.planningCategory === line && c.reason === "changed" && (fromMonth === null || c.fromMonth > fromMonth))
    .sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
}

/** The budget as it would read after a save, worked the way the server stores it (plan 1, repo.node.ts). */
export function simulateChange(
  lines: BudgetLine[], changes: BudgetChange[], line: string, fromMonth: string | null, amountCents: number, throughMonth: string,
): { lines: BudgetLine[]; changes: BudgetChange[] } {
  let base = lines.filter((l) => l.origin !== "change");
  const planId = base.find((l) => l.planningCategory === line)?.planId ?? base[0]?.planId ?? changes[0]?.planId ?? "";
  let next: BudgetChange[];
  if (fromMonth === null) {
    next = changes.filter((c) => !(c.planningCategory === line && c.reason === "changed"));
    base = [
      ...base.filter((l) => !(l.planningCategory === line && (l.period === null || l.period === ""))),
      { planId, planningCategory: line, period: null, amountCents, source: "you" },
    ];
  } else {
    next = changes.filter((c) => !(c.planningCategory === line && c.reason === "changed" && c.fromMonth >= fromMonth));
    next = [...next, { id: -1, planId, planningCategory: line, fromMonth, amountCents, reason: "changed", goalId: null, createdAt: "" }];
  }
  return { lines: expandChanges(base, next, throughMonth), changes: next };
}

export interface ChangeEffect {
  month: string;
  monthBefore: number | null;
  monthAfter: number | null;
  spendBefore: number;
  spendAfter: number;
  yearBefore: number;
  yearAfter: number;
}

/**
 * What a change does to Left over before it is saved. The month line is the
 * "from" month (this month for "every month"). The year: finished months use what was
 * actually left over, so changing their budget never moves it; this month on uses the
 * budget, a month with no salary in Settings counting its income budget as zero.
 */
export function leftOverEffect(
  input: BudgetInputs, plan: Plan, today: string, line: string, fromMonth: string | null, amountCents: number,
): ChangeEffect {
  const thisMonth = today.slice(0, 7);
  const through = addMonths(plan.endDate.slice(0, 7), 36);
  const after = { ...input, ...simulateChange(input.lines, input.changes, line, fromMonth, amountCents, through) };
  const month = fromMonth ?? thisMonth;
  const b = budgetLeftOver(input, month);
  const a = budgetLeftOver(after, month);
  const full = sumRollups(input.prepared, input.accounts, input.mapping);
  const actualLeft = (m: string) => {
    let net = 0;
    for (const [k, byMonth] of full) net += (k.startsWith("income|") ? 1 : -1) * (byMonth.get(m) ?? 0);
    return net;
  };
  const yearOf = (x: Pick<BudgetInputs, "lines" | "changes" | "bigMonths" | "salary">) => {
    let total = 0;
    for (let m = plan.startDate.slice(0, 7); m <= plan.endDate.slice(0, 7); m = addMonths(m, 1)) {
      if (m < thisMonth) total += actualLeft(m);
      else {
        const r = budgetLeftOver(x, m);
        total += (r.incomeCents ?? 0) - r.spendingCents;
      }
    }
    return total;
  };
  return {
    month,
    monthBefore: b.leftOverCents,
    monthAfter: a.leftOverCents,
    spendBefore: b.spendingCents,
    spendAfter: a.spendingCents,
    yearBefore: yearOf(input),
    yearAfter: yearOf(after),
  };
}
