// src/domain/budget-year.ts -- the Budget's Year tab as numbers. Lines down the side in the month
// screen's groups, the plan's 12 months across, then an Average column. Finished months
// show what was spent and may shade; this month shows spent so far; future months show
// the budget in force with big months. Pure: today is passed in.
//
// Shading: finished months, spending lines only. The band is the larger of the line's
// typical swing (standard deviation over its 12-month window, zeros counted), 15% of its
// average, or $15. Beyond 1.5 bands a cell shades; beyond 2.5 it shades darker.
import { averageOf, charityToneSuppressed, sumsForAverages, firstSpend, isSetByYou, keyOf, sumRollups, type BudgetInputs, type Group } from "./budget-month";
import { lineBudget, PAYCHECKS_LINE, settingsMoneyIn, sideOf } from "./budget-income";
import type { LineSide } from "./budget-colors";
import { addMonths, MAASER_CATEGORY } from "./scenario";
import { priorMonths } from "./seed";
import type { BigMonth, Plan } from "./plan-types";

export type Shade = "high" | "high-strong" | "low" | "low-strong" | null;

export function shadeBand(values: number[], averageCents: number): number {
  const count = Math.max(1, values.length);
  const mean = values.reduce((s, v) => s + v, 0) / count;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / count);
  return Math.max(Math.round(sd), Math.round(Math.abs(averageCents) * 0.15), 1500);
}

export function shadeOf(spentCents: number, averageCents: number, bandCents: number): Shade {
  const d = spentCents - averageCents;
  if (Math.abs(d) > 2.5 * bandCents) return d > 0 ? "high-strong" : "low-strong";
  if (Math.abs(d) > 1.5 * bandCents) return d > 0 ? "high" : "low";
  return null;
}

export interface YearCell {
  month: string;
  state: "finished" | "now" | "future";
  cents: number | null;
  shade: Shade;
  note: string | null;
}
export interface YearRow {
  key: string;
  line: string;
  side: LineSide;
  group: Group;
  setByYou: boolean;
  cells: YearCell[];
  averageCents: number | null;
  bigMonths: BigMonth[];
  hidden: boolean;
}
export interface YearTotals {
  label: string;
  cells: (number | null)[];
  averageCents: number | null;
}
export interface YearView {
  year: string;
  months: string[];
  thisMonth: string;
  sections: { id: "fixed" | "variable" | "income"; title: string; rows: YearRow[]; subtotal: YearTotals }[];
  leftOver: YearTotals;
  hiddenCount: number;
}

function sumCells(rows: YearRow[], i: number): number | null {
  const vals = rows.map((r) => r.cells[i].cents);
  return vals.some((v) => v !== null) ? vals.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
}

function totalsOf(label: string, rows: YearRow[], months: string[]): YearTotals {
  const avgs = rows.map((r) => r.averageCents);
  return {
    label,
    cells: months.map((_, i) => sumCells(rows, i)),
    averageCents: avgs.some((a) => a !== null) ? avgs.reduce<number>((s, a) => s + (a ?? 0), 0) : null,
  };
}

export function buildYearView(input: BudgetInputs & { plan: Plan; today: string }): YearView {
  const thisMonth = input.today.slice(0, 7);
  const start = input.plan.startDate.slice(0, 7);
  const end = input.plan.endDate.slice(0, 7);
  const months: string[] = [];
  for (let m = start; m <= end; m = addMonths(m, 1)) months.push(m);
  const full = sumRollups(input.prepared, input.accounts, input.mapping);
  const averages = input.yearlyTxnIds?.length ? sumsForAverages(input, null) : full;
  // The baseline window ends before this month, or before the year after a finished plan.
  const windowEnd = thisMonth <= end ? thisMonth : addMonths(end, 1);
  const fixedLines = new Set(input.settings.filter((s) => s.recurring === true).map((s) => s.planningCategory));

  const keys = new Map<string, { side: LineSide; line: string }>();
  const add = (side: LineSide | null, line: string) => {
    if (side) keys.set(keyOf(side, line), { side, line });
  };
  for (const k of full.keys()) {
    const at = k.indexOf("|");
    const line = k.slice(at + 1);
    if (sideOf(line) !== null) add(k.slice(0, at) as LineSide, line);
  }
  for (const l of input.lines) add(sideOf(l.planningCategory), l.planningCategory);
  for (const b of input.bigMonths) add("spending", b.planningCategory);
  if (months.some((m) => settingsMoneyIn(input.salary, m).paycheckCents !== null)) add("income", PAYCHECKS_LINE);
  if (months.some((m) => settingsMoneyIn(input.salary, m).maaserCents > 0)) add("spending", MAASER_CATEGORY);

  const rows: YearRow[] = [...keys.values()].map(({ side, line }) => {
    const k = keyOf(side, line);
    const byMonth = full.get(k);
    const average = averageOf(averages, averages, k, windowEnd, 12);
    const first = firstSpend(full, k);
    const window = first ? priorMonths(windowEnd, 12).filter((m) => m >= first) : [];
    const band = average === null ? null : shadeBand(window.map((m) => byMonth?.get(m) ?? 0), average);
    const cells: YearCell[] = months.map((m) => {
      const state: YearCell["state"] = m < thisMonth ? "finished" : m === thisMonth ? "now" : "future";
      const spent = byMonth?.get(m) ?? 0;
      const cents = state === "future" ? lineBudget(input, line, side, m).cents : spent;
      // The Charity line is never shaded: charity beyond the pot is allowed.
      const shade = state === "finished" && side === "spending" && (line !== MAASER_CATEGORY || !charityToneSuppressed(input.salary)) && average !== null && band !== null ? shadeOf(spent, average, band) : null;
      const note = input.notes.find((x) => x.planningCategory === line && x.month === m)?.note ?? null;
      return { month: m, state, cents, shade, note };
    });
    const bigs = input.bigMonths.filter((b) => b.planningCategory === line && b.month >= start && b.month <= end);
    const group: Group = side === "income" ? "income" : fixedLines.has(line) ? "fixed" : "variable";
    const hidden = cells.every((c) => !c.cents && !c.note) && !average && bigs.length === 0;
    return {
      key: k,
      line,
      side,
      group,
      setByYou: line !== PAYCHECKS_LINE && isSetByYou(input.lines, input.changes, line),
      cells,
      averageCents: average,
      bigMonths: bigs,
      hidden,
    };
  });

  const byName = (a: YearRow, b: YearRow) => a.line.localeCompare(b.line);
  const of = (g: Group) => rows.filter((r) => r.group === g).sort(byName);
  const sections = [
    { id: "fixed" as const, title: "Fixed costs", rows: of("fixed") },
    { id: "variable" as const, title: "Variable costs", rows: of("variable") },
    { id: "income" as const, title: "Income", rows: of("income") },
  ].map((s) => ({ ...s, subtotal: totalsOf(s.title, s.rows, months) }));

  const spending = [...sections[0].rows, ...sections[1].rows];
  const income = sections[2].rows;
  const leftCells = months.map((m, i) => {
    if (m > thisMonth && settingsMoneyIn(input.salary, m).paycheckCents === null) return null;
    const inc = sumCells(income, i);
    return inc === null ? null : inc - (sumCells(spending, i) ?? 0);
  });
  const incAvg = totalsOf("", income, months).averageCents;
  const outAvg = totalsOf("", spending, months).averageCents;
  return {
    year: input.plan.startDate.slice(0, 4),
    months,
    thisMonth,
    sections,
    leftOver: { label: "Left over", cells: leftCells, averageCents: incAvg === null || outAvg === null ? null : incAvg - outAvg },
    hiddenCount: rows.filter((r) => r.hidden).length,
  };
}
