// src/ui/reports/ReportChart.tsx
//
// The chart above the ranked list on Reports, Spending and Income.
//
// - Its grouping fits the period: up to 31 days by day, up to 186 days by week,
//   longer by month. A small Day, Week, Month menu overrides it.
// - Clicking a month (or week) bar redraws it by day; clicking a day opens a
//   ledger of that day's transactions. "Back to the whole period" undoes the drill.
//   The drill narrows the whole page, so the panel above owns it (`drilled`, `onDrill`)
//   and keeps it in the link.
// - Stacked: one column per period split by category. Regular: the same columns side
//   by side, always; never one total column. The person can limit the categories picked
//   to avoid crowding.
//
// Drawn by the shared chart base (src/ui/charts). The registry's stacked and interactive bar
// blocks are Pro (refused without a key) and built on Recharts. Nothing animates.
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import ChartBase from "../charts/ChartBase";
import { useStable } from "../charts/useStable";
import type { ChartMark, ChartSeries } from "../charts/types";

import { formatCents } from "../../domain/money";
import { formatDateRange, formatMonthShort, formatShortDate, isPartialMonth } from "../../domain/period";
import {
  REFUNDS_LABEL,
  bucketsFor,
  chartRows,
  groupingFor,
  type Bucket,
  type DateRange,
  type Grouping,
  type ReportEntry,
  type ReportSide,
} from "../../domain/report-view";
import { ledgerHref } from "../lib/ledger-link";
import { PartialMonthNote } from "./shared";

export const TOP_N = 8;

/** A month or week the page is narrowed to: its key (YYYY-MM, or the week's first day) and its days inside the period. */
export interface Drill extends Bucket {
  kind: "month" | "week";
}
/** Chart data key for the comparison marker. Not a key a series could have. */
const BASELINE_KEY = "__baseline";

/** One series of the chart: the key its entries add to, its name, and how the look colours it (a category index, or neutral). */
interface Series {
  key: string;
  name: string;
  colorIndex?: number;
}

export interface ReportChartProps {
  kind: ReportSide;
  /** Entries of the chosen categories (or every category), any dates; the chart cuts them to what it shows. */
  entries: ReportEntry[];
  range: DateRange;
  /** Where the period ends, for the "through" mark on a month it cuts short. */
  rangeTo: string;
  today: string;
  /** The categories in ranked order, largest first. */
  ranked: string[];
  refundsApart: boolean;
  /** The categories chosen on the Spending tab; empty means every category. */
  chosen: string[];
  /** What `ranked` names: budget lines, or merchants. */
  group?: "category" | "merchant";
  /** The month or week the page is narrowed to; drawn by day. Null for the whole period. */
  drilled?: Drill | null;
  /** A month or week bar was clicked (a Drill), or Back to the whole period (null). */
  onDrill?: (next: Drill | null) => void;
  /** Where a day's ledger returns to. */
  back: string;
  /** The comparison's figure for a month, or null; only drawn when the chart is by month. */
  marker: ((month: string) => number | null) | null;
  markerLabel: string | null;
}

type Mode = "stacked" | "regular";

const GROUPINGS: { id: Grouping; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

export default function ReportChart({
  kind,
  entries,
  range,
  rangeTo,
  today,
  ranked,
  refundsApart,
  chosen,
  back,
  marker,
  markerLabel,
  drilled = null,
  onDrill,
}: ReportChartProps) {
  const rangeKey = `${range.from}|${range.to}`;
  // The override belongs to the period it was made under: a new period starts fitted.
  const [override, setOverride] = useState<{ rangeKey: string; grouping: Grouping } | null>(null);
  const [mode, setMode] = useState<Mode>("stacked");

  const chosenGrouping = override?.rangeKey === rangeKey ? override.grouping : groupingFor(range);
  const grouping: Grouping = drilled ? "day" : chosenGrouping;
  const shown: DateRange = drilled ?? range;
  const { from: shownFrom, to: shownTo } = shown;
  const buckets = useMemo(() => bucketsFor({ from: shownFrom, to: shownTo }, grouping), [shownFrom, shownTo, grouping]);

  const hasRefunds = refundsApart && entries.some((e) => e.cents < 0 && e.date >= shownFrom && e.date <= shownTo);

  // The series and the key each entry adds to. Keys are never category names, so
  // no name can overwrite the bucket or the marker. Stacked and Regular draw the
  // same series (the top 8, Other, refunds); Regular only puts them side by side.
  // With 8 or fewer categories chosen, that is every one of them.
  const { series, keyOf } = useMemo(() => {
    const refunds: Series[] = hasRefunds ? [{ key: "refunds", name: REFUNDS_LABEL }] : [];
    const isRefund = (e: ReportEntry) => refundsApart && e.cents < 0;
    const lines = ranked.slice(0, TOP_N);
    const index = new Map(lines.map((c, i) => [c, i]));
    const folded = ranked.slice(TOP_N);
    const own: Series[] = lines.map((c, i) => ({ key: `s${i}`, name: c, colorIndex: i }));
    const other: Series[] = folded.length > 0 ? [{ key: "other", name: "Other" }] : [];
    return {
      series: [...own, ...other, ...refunds],
      keyOf: (e: ReportEntry) => {
        if (isRefund(e)) return "refunds";
        const i = index.get(e.category);
        if (i != null) return `s${i}`;
        return folded.length > 0 ? "other" : null;
      },
    };
  }, [ranked, hasRefunds, refundsApart]);

  const showMarker = marker != null && grouping === "month" && !drilled;
  const rows = useMemo<Record<string, string | number | null>[]>(() => {
    const base: Record<string, string | number | null>[] = chartRows(entries, buckets, keyOf);
    return showMarker ? base.map((row) => ({ ...row, [BASELINE_KEY]: marker!(String(row.period)) })) : base;
  }, [entries, buckets, keyOf, showMarker, marker]);

  const bucketByKey = new Map(buckets.map((b) => [b.key, b]));
  const kindWord = kind === "expense" ? "Spending" : "Income";
  // One label for the axis and the tooltip: a month reads "Sep 2026" (starred when it is cut short), a day or week its first day.
  const formatX = useCallback(
    (key: string) => (grouping === "month" ? formatMonthShort(key) + (isPartialMonth(key, rangeTo) ? "*" : "") : formatShortDate(key, today)),
    [grouping, rangeTo, today],
  );

  // A week's tooltip names the whole week ("Oct 5 to Oct 11"), not only its first day.
  const formatTooltipX = useMemo(
    () =>
      grouping === "week"
        ? (key: string) => {
            const b = buckets.find((q) => q.key === key);
            return b ? formatDateRange(b.from, b.to) : formatX(key);
          }
        : undefined,
    [grouping, buckets, formatX],
  );

  /** A month or week opens by day; a day opens its ledger. */
  const open = (key: string) => {
    const bucket = bucketByKey.get(key);
    if (!bucket) return;
    if (grouping === "day") {
      window.location.hash = ledgerHref({
        label: chosen.length > 0 ? chosen.join(", ") : kindWord,
        back,
        kind,
        categories: chosen.length > 0 ? chosen : undefined,
        from: bucket.from,
        to: bucket.to,
      });
    } else {
      onDrill?.({ ...bucket, kind: grouping === "month" ? "month" : "week" });
    }
  };

  const stacked = mode === "stacked";
  const hasNegative = rows.some((row) => Object.entries(row).some(([k, v]) => k !== "period" && typeof v === "number" && v < 0));
  const builtSeries = ((): ChartSeries[] => {
    const bars: ChartSeries[] = series.map((s) => ({
      id: s.key,
      label: s.name,
      role: s.colorIndex === undefined ? "neutral" : "category",
      ...(s.colorIndex === undefined ? {} : { colorIndex: s.colorIndex }),
      mark: "bar",
      ...(stacked ? { stack: "c" } : {}),
      barMaxWidth: stacked ? 64 : 32,
      points: rows.map((row) => ({ x: String(row.period), cents: typeof row[s.key] === "number" ? (row[s.key] as number) : null })),
    }));
    if (!showMarker) return bars;
    // A month with no comparison figure is left out, so the line runs on through it.
    const points = rows.flatMap((row) => (typeof row[BASELINE_KEY] === "number" ? [{ x: String(row.period), cents: row[BASELINE_KEY] as number }] : []));
    return [...bars, { id: BASELINE_KEY, label: markerLabel ?? "Baseline", role: "plan", mark: "line", showPoints: true, points }];
  })();
  // `marker` and the entries are new objects on every render of the page above; the chart is given the same series while the figures are the same.
  const chartSeries = useStable(builtSeries);
  const marks = useStable<ChartMark[]>(hasNegative ? [{ kind: "hline", cents: 0, role: "actual" }] : []);
  const description = useMemo(() => {
    const total = rows.reduce((n, row) => n + series.reduce((m, s) => m + (typeof row[s.key] === "number" ? (row[s.key] as number) : 0), 0), 0);
    return `${kindWord} by ${grouping}: ${formatCents(total)} across ${buckets.length} ${buckets.length === 1 ? grouping : `${grouping}s`}.`;
  }, [rows, series, kindWord, grouping, buckets.length]);
  const focusLabel = drilled
    ? `${drilled.kind === "month" ? formatMonthShort(drilled.key) : formatDateRange(drilled.from, drilled.to)}, by day`
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {drilled ? (
          <>
            <p data-testid="chart-focus" className="text-sm font-medium">
              {focusLabel}
            </p>
            <Button variant="outline" size="sm" onClick={() => onDrill?.(null)}>
              Back to the whole period
            </Button>
          </>
        ) : (
          <ToggleGroup
            value={[grouping]}
            onValueChange={(v: unknown[]) => {
              if (v.length > 0) setOverride({ rangeKey, grouping: v[0] as Grouping });
            }}
            aria-label="Group the chart by"
            variant="outline"
            size="sm"
            spacing={0}
          >
            {GROUPINGS.map((g) => (
              <ToggleGroupItem key={g.id} value={g.id}>
                {g.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <ToggleGroup
          value={[mode]}
          onValueChange={(v: unknown[]) => {
            if (v.length > 0) setMode(v[0] as Mode);
          }}
          aria-label="Columns"
          variant="outline"
          size="sm"
          spacing={0}
        >
          <ToggleGroupItem value="stacked">
            Stacked
          </ToggleGroupItem>
          <ToggleGroupItem value="regular">
            Regular
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {grouping === "day" ? "Click a day to see its transactions." : `Click a ${grouping} to see it by day.`}
        </p>
      </div>
      <ChartBase
        title={`${kindWord} by ${grouping}`}
        description={description}
        axis="category"
        series={chartSeries}
        marks={marks}
        formatX={formatX}
        formatTooltipX={formatTooltipX}
        onMarkClick={(m) => {
          // The comparison line is not a bar: only a bar opens anything.
          if (m.seriesId !== BASELINE_KEY) open(m.x);
        }}
        height={288}
      />
      {grouping === "month" && !drilled && <PartialMonthNote periods={buckets.map((b) => b.key)} rangeTo={rangeTo} />}
    </div>
  );
}
