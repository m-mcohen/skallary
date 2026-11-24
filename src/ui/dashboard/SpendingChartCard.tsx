// The day-by-day spending chart on a card of its own, second on the Dashboard after the month bar.
// Cumulative (the running total) or Daily (what each day cost); and a range, This month (the month
// the bar above shows, by day) or a longer span ending on that month's last day read, plotted by week
// against the same length before, where Daily reads Weekly. Both choices are remembered in this browser.
import { useMemo, useState } from "react";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { MonthSource } from "../../domain/dashboard-month";
import type { SpendingCurves } from "../../domain/spending-curve";
import { spendingRange, type LongRange } from "../../domain/spending-range";
import CompareMenu from "./CompareMenu";
import SpendingChart, { RangeChart, type SpendingView } from "./SpendingChart";

type RangeId = "month" | LongRange;

const RANGES: { id: RangeId; label: string }[] = [
  { id: "month", label: "This month" },
  { id: "3m", label: "3 months" },
  { id: "6m", label: "6 months" },
  { id: "ytd", label: "Year to date" },
  { id: "12m", label: "12 months" },
];

const VIEW_KEY = "ff.spending-chart.view";
const RANGE_KEY = "ff.spending-chart.range";

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const saved = window.localStorage.getItem(key);
    return allowed.includes(saved as T) ? (saved as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage refused: the choice holds for this visit.
  }
}

export interface SpendingChartCardProps {
  curves: SpendingCurves;
  endedLabel: string | null;
  /** The Dashboard's rows; without them only This month can be drawn. */
  source?: MonthSource | null;
  /** The last day the longer ranges read: today, or the shown month's last day. */
  asOf?: string;
}

export default function SpendingChartCard({ curves, endedLabel, source = null, asOf }: SpendingChartCardProps) {
  const [view, setView] = useState<SpendingView>(() => read(VIEW_KEY, ["cumulative", "daily"], "cumulative"));
  const [chosen, setChosen] = useState<RangeId>(() => read(RANGE_KEY, RANGES.map((r) => r.id), "month"));
  const range: RangeId = source && asOf ? chosen : "month";
  const long = useMemo(
    () => (range !== "month" && source && asOf ? spendingRange(source.prepared, source.accounts, source.mapping, asOf, range) : null),
    [range, source, asOf]
  );

  const monthLabel = endedLabel ?? "This month";
  const description = long
    ? `${long.label} against ${long.priorLabel.toLowerCase()}, ${view === "daily" ? "what each week cost" : "added up week by week"}.`
    : `${endedLabel ?? "This month"} against what you tick in Compare with${
        view === "daily" ? ": what each day cost" : ", added up day by day"
      }.`;

  return (
    <Card aria-label="Spending by day" foldId="dash-spending-chart">
      <CardHeader className="max-sm:has-data-[slot=card-action]:grid-cols-1">
        <CardTitle className="text-base">{long ? "Spending by week" : "Spending by day"}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction
          // On a phone the controls take their own line under the words, so the title is not squeezed.
          className="flex flex-wrap items-center justify-end gap-2 max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:justify-start max-sm:justify-self-start"
        >
          {source && asOf && (
            <select
              aria-label="Date range"
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={range}
              onChange={(e) => {
                const next = e.target.value as RangeId;
                setChosen(next);
                save(RANGE_KEY, next);
              }}
            >
              {RANGES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id === "month" ? monthLabel : r.label}
                </option>
              ))}
            </select>
          )}
          {!long && <CompareMenu />}
          <ToggleGroup
            value={[view]}
            onValueChange={(v: string[]) => {
              if (!v[0]) return;
              setView(v[0] as SpendingView);
              save(VIEW_KEY, v[0]);
            }}
            aria-label="Chart view"
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="cumulative">Cumulative</ToggleGroupItem>
            <ToggleGroupItem value="daily">{long ? "Weekly" : "Daily"}</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>{long ? <RangeChart data={long} view={view} /> : <SpendingChart curves={curves} ended={endedLabel} view={view} />}</CardContent>
    </Card>
  );
}
