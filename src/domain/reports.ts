// src/domain/reports.ts
//
// The aggregation engine behind the Reports screen.
//
// Every helper here takes the output of rollupMonthly() -- so a category read
// in Reports is the same category the Budget counts under, because both go
// through classify() upstream. A second aggregation path would let the two
// disagree, and month-over-month spending is exactly the number a budget must
// tell one consistent story about.
import type { MonthlyRollup } from "./rollups";

export interface CategoryMonthSeries {
  category: string;
  total: number;
  /** Cents per period. Missing periods read as zero at the call site. */
  byMonth: Record<string, number>;
}

export interface MonthTotals {
  period: string;
  incomeCents: number;
  /** Positive: the magnitude leaving, not a negative number. */
  expenseCents: number;
  /**
   * Money put away, positive; negative in a month the user drew more out than the user put
   * in. Its own bucket, neither income nor expense.
   */
  savingCents: number;
  /** What the user's money earned, kept apart from what the user earned. */
  investmentIncomeCents: number;
  /**
   * Left over: income + investment income - spending, what was earned
   * less what was spent. Left over is earned minus spent; money moved into or out of savings is its own figure, never part of it
   * (savingCents above).
   */
  netCents: number;
}

/**
 * Share of everything that came in that the user put away. Null when nothing came in,
 * because a rate off a zero base is noise, not a zero.
 */
export function savingsRate(t: MonthTotals): number | null {
  const inflow = t.incomeCents + t.investmentIncomeCents;
  if (inflow <= 0) return null;
  return t.savingCents / inflow;
}

interface CategorySeriesResult {
  periods: string[];
  series: CategoryMonthSeries[];
  totals: MonthTotals[];
}

function sortedPeriods(rollups: MonthlyRollup[]): string[] {
  const set = new Set(rollups.map((r) => r.period));
  return [...set].sort();
}

function byCategory(
  rollups: MonthlyRollup[],
  kind: "expense" | "income"
): CategorySeriesResult {
  if (rollups.length === 0) return { periods: [], series: [], totals: [] };

  const periods = sortedPeriods(rollups);
  const seriesMap = new Map<string, CategoryMonthSeries>();

  for (const r of rollups) {
    if (r.kind !== kind) continue;
    const cur = seriesMap.get(r.planningCategory) ?? {
      category: r.planningCategory,
      total: 0,
      byMonth: {},
    };
    cur.total += r.amountCents;
    cur.byMonth[r.period] = (cur.byMonth[r.period] ?? 0) + r.amountCents;
    seriesMap.set(r.planningCategory, cur);
  }

  const series = [...seriesMap.values()].sort((a, b) => b.total - a.total);
  return { periods, series, totals: cashFlowByMonth(rollups) };
}

export function spendingByCategoryOverTime(rollups: MonthlyRollup[]): CategorySeriesResult {
  return byCategory(rollups, "expense");
}

export function incomeByCategoryOverTime(rollups: MonthlyRollup[]): CategorySeriesResult {
  return byCategory(rollups, "income");
}

/**
 * Income, spending, saving, investment income and what was left, for each
 * period the rollup touches. A month with only one side reads that side and
 * zero on the others -- never missing, so the chart's x-axis has no holes.
 */
export function cashFlowByMonth(rollups: MonthlyRollup[]): MonthTotals[] {
  const map = new Map<string, MonthTotals>();
  for (const r of rollups) {
    const t = map.get(r.period) ?? {
      period: r.period,
      incomeCents: 0,
      expenseCents: 0,
      savingCents: 0,
      investmentIncomeCents: 0,
      netCents: 0,
    };
    // Each kind to its own bucket. This used to be "income, else expense",
    // which would have quietly filed every brokerage contribution as spending
    // the moment the saving bucket existed.
    if (r.kind === "income") t.incomeCents += r.amountCents;
    else if (r.kind === "saving") t.savingCents += r.amountCents;
    else if (r.kind === "investment_income") t.investmentIncomeCents += r.amountCents;
    else t.expenseCents += r.amountCents;
    map.set(r.period, t);
  }
  const out = [...map.values()].map((t) => ({
    ...t,
    netCents: t.incomeCents + t.investmentIncomeCents - t.expenseCents,
  }));
  out.sort((a, b) => a.period.localeCompare(b.period));
  return out;
}
