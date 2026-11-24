// Spending so far this month, day by day, against the comparisons ticked in Compare with
// (compare-ticks.ts): last month, the same month last year, the 3-month and the 12-month average.
// Display only. Last year is solid orange, the 3-month average dashed purple; the rest below.
//
// A past month (`ended`, its name) runs the whole month and the words name the month; the dot marks
// its last day. Both comparison lines show at once, each named in the legend. This month is the
// solid ink line, last month the grey line, the average month the dashed blue line, so the two
// comparisons differ by shape as well as colour. The legend is the card's own, so the chart draws none.
// The longer ranges use RangeChart: one point a week, this span against the span before.
import { useCallback, useMemo } from "react";

import ChartBase from "../charts/ChartBase";
import type { ChartMark, ChartSeries } from "../charts/types";
import { formatCents } from "../../domain/money";
import { comparisonDay, type SpendingCurves } from "../../domain/spending-curve";
import type { RangeCurves } from "../../domain/spending-range";
import { formatDateRange, formatShortDate, monthBounds } from "../../domain/period";
import { addMonths } from "../../domain/scenario";
import { ledgerHref } from "../lib/ledger-link";
import { useTicks, type Tick } from "./compare-ticks";

/** Opens the spending rows between two dates (inclusive), with a way back to this screen. */
function openSpending(label: string, from: string, to: string) {
  window.location.hash = ledgerHref({ label, back: window.location.hash.startsWith("#/") ? window.location.hash : "#/", kind: "expense", from, to });
}

/** The average month's name in the legend and the tooltip. */
export const AVERAGE_LABEL = "Average month (last 12 months)";
export const AVERAGE_THREE_LABEL = "Average month (last 3 months)";

/** The curves with every line not ticked taken away, so the chart, its legend and its sentence show the same lines. */
export function tickedCurves(curves: SpendingCurves, ticks: Tick[]): SpendingCurves {
  return {
    ...curves,
    lastMonth: ticks.includes("lastMonth") ? curves.lastMonth : null,
    lastYear: ticks.includes("lastYear") ? (curves.lastYear ?? null) : null,
    averageThree: ticks.includes("averageThree") ? (curves.averageThree ?? null) : null,
    averageMonth: ticks.includes("averageMonth") ? curves.averageMonth : null,
  };
}

export interface ChartRow {
  day: number;
  thisMonth?: number;
  lastMonth?: number;
  lastYear?: number;
  averageThree?: number;
  averageMonth?: number;
}

/** Cumulative: the running total, each line climbing through the month. Daily: what each day cost. */
export type SpendingView = "cumulative" | "daily";

/** The running totals turned into each day's own amount (a refund day can be below zero). */
export function dailyRows(rows: ChartRow[]): ChartRow[] {
  const keys = ["thisMonth", "lastMonth", "lastYear", "averageThree", "averageMonth"] as const;
  return rows.map((row, i) => {
    const out: ChartRow = { day: row.day };
    for (const k of keys) {
      const v = row[k];
      if (v !== undefined) out[k] = v - (i > 0 ? (rows[i - 1][k] ?? 0) : 0);
    }
    return out;
  });
}

/**
 * One row per day, 1 to 31: this month through today, each comparison line all month (when there is one).
 * On the month's last day this month's line carries its total to Day 31, as a shorter comparison month does.
 */
export function chartRows(curves: SpendingCurves): ChartRow[] {
  const through = comparisonDay(curves);
  const total = curves.thisMonth[curves.thisMonth.length - 1];
  return Array.from({ length: curves.days }, (_, i) => ({
    day: i + 1,
    ...(i < curves.thisMonth.length ? { thisMonth: curves.thisMonth[i] } : i < through && total !== undefined ? { thisMonth: total } : {}),
    ...(curves.lastMonth ? { lastMonth: curves.lastMonth[i] } : {}),
    ...(curves.lastYear ? { lastYear: curves.lastYear[i] } : {}),
    ...(curves.averageThree ? { averageThree: curves.averageThree[i] } : {}),
    ...(curves.averageMonth ? { averageMonth: curves.averageMonth[i] } : {}),
  }));
}

/** The figures behind the lines, in one sentence, for a screen reader (and the tests). `ended`: a past month's name. */
export function chartSummary(curves: SpendingCurves, ended: string | null = null): string {
  const today = curves.today;
  const last = curves.days - 1;
  if (ended) {
    const parts = [`${ended}: ${formatCents(curves.thisMonth[today - 1] ?? 0)} for the whole month.`];
    if (curves.lastMonth) parts.push(`${curves.lastMonthLabel}, whole month: ${formatCents(curves.lastMonth[last])}.`);
    if (curves.lastYear) parts.push(`${curves.lastYearLabel}, whole month: ${formatCents(curves.lastYear[last])}.`);
    if (curves.averageThree) parts.push(`3-month average, whole month: ${formatCents(curves.averageThree[last])}.`);
    if (curves.averageMonth) parts.push(`Average month, whole month: ${formatCents(curves.averageMonth[last])}.`);
    return parts.join(" ");
  }
  const parts = [`This month so far: ${formatCents(curves.thisMonth[today - 1] ?? 0)} through Day ${today}.`];
  // On the month's last day each line is read whole (comparisonDay).
  const whole = comparisonDay(curves) === curves.days;
  const through = (name: string, line: number[]) =>
    whole
      ? `${name}, whole month: ${formatCents(line[last])}.`
      : `${name} by Day ${today}: ${formatCents(line[today - 1])}; by Day ${curves.days}: ${formatCents(line[last])}.`;
  if (curves.lastMonth) parts.push(through(curves.lastMonthLabel, curves.lastMonth));
  if (curves.lastYear) parts.push(through(curves.lastYearLabel ?? "Last year", curves.lastYear));
  if (curves.averageThree) parts.push(through("3-month average", curves.averageThree));
  if (curves.averageMonth) parts.push(through("Average month", curves.averageMonth));
  return parts.join(" ");
}

/** "Spending by day, this month against September and the average month". */
function chartName(curves: SpendingCurves, ended: string | null): string {
  const against = [
    curves.lastMonth ? curves.lastMonthLabel : null,
    curves.lastYear ? (curves.lastYearLabel ?? null) : null,
    curves.averageThree ? "the 3-month average" : null,
    curves.averageMonth ? "the average month" : null,
  ].filter(Boolean);
  const base = `Spending by day, ${ended ?? "this month"}`;
  return against.length ? `${base} against ${against.join(" and ")}` : base;
}

const DAY_TICKS = ["1", "5", "10", "15", "20", "25", "31"];
const formatDay = (x: string) => `Day ${x}`;

export default function SpendingChart({
  curves: all,
  ended = null,
  view = "cumulative",
}: {
  curves: SpendingCurves;
  ended?: string | null;
  view?: SpendingView;
}) {
  const ticks = useTicks();
  const curves = useMemo(() => tickedCurves(all, ticks), [all, ticks]);
  const mine = ended ?? "This month";
  const daily = view === "daily";
  const series = useMemo(() => {
    const rows = daily ? dailyRows(chartRows(curves)) : chartRows(curves);
    const points = (key: "thisMonth" | "lastMonth" | "lastYear" | "averageThree" | "averageMonth") =>
      rows.map((r) => ({ x: String(r.day), cents: r[key] ?? null }));
    const list: ChartSeries[] = [{ id: "thisMonth", label: mine, role: "actual", mark: "line", points: points("thisMonth") }];
    if (curves.lastMonth) list.push({ id: "lastMonth", label: curves.lastMonthLabel, role: "neutral", mark: "line", points: points("lastMonth") });
    if (curves.lastYear)
      list.push({ id: "lastYear", label: curves.lastYearLabel ?? "Last year", role: "category", colorIndex: 1, mark: "line", points: points("lastYear") });
    if (curves.averageThree)
      list.push({ id: "averageThree", label: AVERAGE_THREE_LABEL, role: "category", colorIndex: 6, dash: true, mark: "line", points: points("averageThree") });
    if (curves.averageMonth) list.push({ id: "averageMonth", label: AVERAGE_LABEL, role: "plan", mark: "line", points: points("averageMonth") });
    return list;
  }, [curves, daily, mine]);
  // A dot on today's point says where the month stands, and keeps a one-point line visible on the 1st.
  const marks = useMemo<ChartMark[]>(() => [{ kind: "dot", seriesId: "thisMonth", x: String(curves.today) }], [curves.today]);
  const name = chartName(curves, ended);
  const summary = chartSummary(curves, ended);

  return (
    <div className="chart-look-ink-and-signal flex flex-col gap-2">
      <span data-testid="spend-chart-summary" className="sr-only" aria-hidden>
        {summary}
      </span>
      <ChartBase
        title={name}
        description={summary}
        axis="category"
        series={series}
        marks={marks}
        onMarkClick={(m) => {
          // A day of this month, or of last month; the average month is no real month, so it opens nothing.
          const month =
            m.seriesId === "thisMonth" ? curves.month
            : m.seriesId === "lastMonth" ? addMonths(curves.month, -1)
            : m.seriesId === "lastYear" ? addMonths(curves.month, -12)
            : null;
          // A point past the month's last day (Day 29 to 31 of a short month) only carries its total: no such day to open.
          if (!month || Number(m.x) > Number(monthBounds(month).to.slice(8))) return;
          const day = `${month}-${m.x.padStart(2, "0")}`;
          openSpending(`Spending, ${formatShortDate(day)}`, day, day);
        }}
        xTicks={DAY_TICKS}
        formatX={formatDay}
        legend={false}
        height={224}
      />
      <div data-testid="spend-chart-legend" className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: "var(--chart-ink)" }} />
          {mine}
        </span>
        {curves.lastMonth && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: "var(--chart-ink-2)" }} />
            {curves.lastMonthLabel}
          </span>
        )}
        {curves.lastYear && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: "var(--chart-c2)" }} />
            {curves.lastYearLabel}
          </span>
        )}
        {curves.averageThree && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="w-4 border-t-2 border-dashed" style={{ borderColor: "var(--chart-c7)" }} />
            {AVERAGE_THREE_LABEL}
          </span>
        )}
        {curves.averageMonth && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="w-4 border-t-2 border-dashed" style={{ borderColor: "var(--chart-blue)" }} />
            {AVERAGE_LABEL}
          </span>
        )}
      </div>
    </div>
  );
}

/** The longer ranges' chart: one point a week, this span against the span before. */
export function RangeChart({ data, view }: { data: RangeCurves; view: SpendingView }) {
  const weekly = view === "daily";
  const series = useMemo(() => {
    const list: ChartSeries[] = [
      { id: "current", label: data.label, role: "actual", mark: "line", points: data.weeks.map((w) => ({ x: w.from, cents: weekly ? w.weekly : w.cumulative })) },
    ];
    if (data.priorAvailable) {
      list.push({
        id: "prior", label: data.priorLabel, role: "neutral", dash: true, mark: "line",
        points: data.weeks.map((w) => ({ x: w.from, cents: (weekly ? w.priorWeekly : w.priorCumulative) ?? null })),
      });
    }
    return list;
  }, [data, weekly]);
  const weekHeading = useCallback(
    (x: string) => {
      const w = data.weeks.find((k) => k.from === x);
      return w ? formatDateRange(w.from, w.to) : formatShortDate(x);
    },
    [data],
  );
  const last = data.weeks[data.weeks.length - 1];
  const summary =
    `${data.label}, ${formatShortDate(data.from)} to ${formatShortDate(data.to)}: ${formatCents(last.cumulative)}.` +
    (data.priorAvailable ? ` ${data.priorLabel}: ${formatCents(last.priorCumulative ?? 0)}.` : "");
  return (
    <div className="chart-look-ink-and-signal flex flex-col gap-2">
      <span data-testid="spend-range-summary" className="sr-only" aria-hidden>
        {summary}
      </span>
      <ChartBase
        title={`Spending by week, ${data.label.toLowerCase()} against ${data.priorLabel.toLowerCase()}`}
        description={summary}
        axis="time"
        series={series}
        zoom
        onMarkClick={(m) => {
          // A week of this span opens its transactions; the earlier span's points have no dates of their own to open.
          const w = m.seriesId === "current" ? data.weeks.find((k) => k.from === m.x) : undefined;
          if (w) openSpending(`Spending, ${formatDateRange(w.from, w.to)}`, w.from, w.to);
        }}
        formatX={formatShortDate}
        formatTooltipX={weekHeading}
        legend={false}
        height={224}
      />
      <div data-testid="spend-range-legend" className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: "var(--chart-ink)" }} />
          {data.label}
        </span>
        {data.priorAvailable ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="w-4 border-t-2 border-dashed" style={{ borderColor: "var(--chart-ink-2)" }} />
            {data.priorLabel}
          </span>
        ) : (
          <span>No comparison: the history does not reach back that far.</span>
        )}
      </div>
    </div>
  );
}
