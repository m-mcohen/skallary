import { describe, expect, test } from "vitest";

import { buildChartOption, markFromEvent, shouldOfferZoom, tooltipRows } from "../../../src/ui/charts/buildChartOption";
import type { Palette } from "../../../src/ui/charts/looks";
import type { ChartBaseProps, ChartSeries, SeriesRole } from "../../../src/ui/charts/types";
import { formatAxisDollars } from "../../../src/domain/money";
import { colorOf, hasZoom, isDashed, isSmooth, seriesValues, showsMarks, valueAxisLabel, xAxisType } from "./option-reader";

// Six distinct names, so a role given the wrong colour is visible.
const PAL: Palette = {
  ink: "ink", ink2: "ink-2", line: "line", grid: "grid", card: "card",
  blue: "blue", red: "red", green: "green", flow: "flow",
  categorical: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"],
};

const months = (n: number) => Array.from({ length: n }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, "0")}`);
const line = (id: string, n: number, extra: Partial<ChartSeries> = {}): ChartSeries => ({
  id, label: id, role: "actual", mark: "line",
  points: months(n).map((x, i) => ({ x: n > 12 ? `${2026 + Math.floor(i / 12)}-${x.slice(5)}` : x, cents: 1000 * (i + 1) })),
  ...extra,
});
const props = (series: ChartSeries[], extra: Partial<ChartBaseProps> = {}): ChartBaseProps => ({
  title: "A chart", description: "Made-up figures.", axis: "time", series, ...extra,
});
const build = (p: ChartBaseProps) => buildChartOption(p, "ink-and-signal", false, PAL);

describe("buildChartOption", () => {
  test("gives each series' points to the chart in whole cents, a missing month stays a gap", () => {
    const s: ChartSeries = { id: "spent", label: "Spent", role: "actual", mark: "line", points: [
      { x: "2026-01", cents: 120000 }, { x: "2026-02", cents: null }, { x: "2026-03", cents: -5000 },
    ] };
    expect(seriesValues(build(props([s])), "spent")).toEqual([120000, null, -5000]);
  });

  test("look A draws actual in ink, plan in blue and dashed, good in green, bad in red, neutral in ink-2", () => {
    const roles: [SeriesRole, string][] = [["actual", "ink"], ["plan", "blue"], ["good", "green"], ["bad", "red"], ["neutral", "ink-2"]];
    const option = build(props(roles.map(([role]) => line(role, 3, { role }))));
    for (const [role, colour] of roles) expect(colorOf(option, role)).toBe(colour);
    expect(isDashed(option, "plan")).toBe(true);
    expect(isDashed(option, "actual")).toBe(false);
  });

  test("a one-point series still shows its mark", () => {
    expect(showsMarks(build(props([line("one", 1)])), "one")).toBe(true);
    expect(showsMarks(build(props([line("year", 12)])), "year")).toBe(false);
    expect(showsMarks(build(props([line("year", 12, { showPoints: true })])), "year")).toBe(true);
  });

  test("a line is straight between its points, never a curve that bulges past the figures", () => {
    expect(isSmooth(build(props([line("year", 12)])), "year")).toBe(false);
  });

  test("readings given with a time scale sit at their real dates, otherwise points are spaced evenly", () => {
    const dated = [{ x: "2026-09-01", cents: 1 }, { x: "2026-09-02", cents: 2 }, { x: "2026-10-01", cents: 3 }];
    const s: ChartSeries = { id: "r", label: "r", role: "actual", mark: "line", points: dated };
    expect(xAxisType(build(props([s], { timeScale: true })))).toBe("time");
    expect(xAxisType(build(props([s])))).toBe("category");
  });

  test("the money axis reads short and sign-first", () => {
    expect(valueAxisLabel(build(props([line("year", 12)])), -5000000)).toBe(formatAxisDollars(-5000000));
  });

  test("a tooltip names the month and the amount the same way the axis does", () => {
    const p = props([
      { id: "spent", label: "Spent", role: "actual", mark: "bar", points: [{ x: "2026-09", cents: 80000 }] },
      { id: "plan", label: "Budget", role: "plan", mark: "line", points: [{ x: "2026-09", cents: null }] },
    ], { axis: "category", formatX: () => "Sep 2026", formatValue: (c) => "$" + c / 100 });
    expect(tooltipRows(p, "2026-09")).toEqual({ title: "Sep 2026", rows: [{ label: "Spent", value: "$800" }] });
  });

  test("zoom is offered only on a time chart with zoom on and at least 13 points", () => {
    const cases: [ChartBaseProps["axis"], boolean, number, boolean][] = [
      ["time", true, 13, true], ["time", true, 12, false], ["category", true, 40, false], ["time", false, 40, false],
    ];
    for (const [axis, zoom, n, want] of cases) {
      const p = props([line("s", n)], { axis, zoom });
      expect(shouldOfferZoom(p)).toBe(want);
      expect(hasZoom(build(p))).toBe(want);
    }
  });

  test("a mark that is a line or a label is not a click", () => {
    expect(markFromEvent({ seriesId: "spent", value: ["2026-09", 80000] })).toEqual({ seriesId: "spent", x: "2026-09" });
    expect(markFromEvent({ value: 5 })).toBeNull();
  });
});
