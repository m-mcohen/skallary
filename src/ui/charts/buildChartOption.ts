// Turns what a screen gives the chart base into the chart library's option. Pure: no DOM, no
// library import, so tests read its output directly. Ported from look A of the approved chart
// mockup: horizontal grid lines only, straight lines, no fills, nothing draws itself in.
import { formatAxisDollars, formatCents } from "../../domain/money";
import { LOOKS, colorOfRole, type Palette } from "./looks";
import type { ChartBaseProps, ChartLook, ChartMark, ChartSeries } from "./types";

/** Time charts with at least this many points offer zoom (fewer fit on screen as they are). */
const ZOOM_MIN_POINTS = 13;

/** Every x value the chart's series cover, in drawing order. Time values sort; categories keep first-seen order. */
function xValues(p: ChartBaseProps): string[] {
  const seen = new Set<string>();
  for (const s of p.series) for (const pt of s.points) seen.add(pt.x);
  const xs = [...seen];
  return p.axis === "time" ? xs.sort() : xs;
}

const DAY_MS = 86_400_000;

export function shouldOfferZoom(p: ChartBaseProps): boolean {
  return p.axis === "time" && p.zoom === true && xValues(p).length >= ZOOM_MIN_POINTS;
}

export function tooltipRows(p: ChartBaseProps, x: string): { title: string; rows: { label: string; value: string }[] } {
  const fmtX = p.formatTooltipX ?? p.formatX ?? ((v: string) => v);
  const fmtV = p.formatValue ?? formatCents;
  const rows: { label: string; value: string }[] = [];
  for (const s of p.series) {
    const pt = s.points.find((q) => q.x === x);
    if (pt && pt.cents !== null) rows.push({ label: s.label, value: fmtV(pt.cents) });
  }
  return { title: fmtX(x), rows };
}

/** A click on a drawn point or bar names its series and x; a click on a line, label or anything else is null. */
export function markFromEvent(e: { seriesId?: string; value?: unknown }): { seriesId: string; x: string } | null {
  if (typeof e.seriesId !== "string" || !Array.isArray(e.value) || typeof e.value[0] !== "string") return null;
  return { seriesId: e.seriesId, x: e.value[0] };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function dotSeriesId(seriesId: string) {
  return `${seriesId}::dot`;
}

export function buildChartOption(p: ChartBaseProps, look: ChartLook, dark: boolean, palette: Palette): unknown {
  // `dark` is carried by the palette's colours (read from looks.css under the dark class); kept in
  // the signature so a look can differ in more than colour between light and dark.
  void dark;
  const L = LOOKS[look];
  const pal = palette;
  const xs = xValues(p);
  const zoom = shouldOfferZoom(p);
  const showLegend = p.legend !== false && p.series.length > 0;
  const anyBar = p.series.some((s) => s.mark === "bar");
  const fmtX = p.formatX ?? ((v: string) => v);
  const marks = p.marks ?? [];
  // On a time scale an x is a point in time (noon UTC, so no zone moves its day); otherwise it is the label itself.
  const xOf = (x: string): string | number => (p.timeScale ? Date.parse(`${x}T00:00:00Z`) : x);
  const text = { color: pal.ink2, fontFamily: pal.font, fontSize: L.fontSize };

  const series: Record<string, unknown>[] = p.series.map((s) => seriesOption(s, L, pal, xOf));

  // Lines across and down the chart ride on the first series (the library hangs them on one).
  const lines = marks.filter((m): m is Exclude<ChartMark, { kind: "dot" }> => m.kind !== "dot");
  if (lines.length > 0 && series.length > 0) {
    series[0].markLine = {
      silent: true,
      symbol: "none",
      animation: false,
      data: lines.map((m) => m.kind === "hline"
        ? {
            yAxis: m.cents,
            lineStyle: { color: colorOfRole(m.role, undefined, pal), width: 1, type: m.dash ? "dashed" : "solid" },
            label: { show: !!m.label, formatter: m.label ?? "", position: "insideEndTop", ...text },
          }
        : {
            xAxis: xOf(m.x),
            lineStyle: { color: pal.ink2, width: 1, type: "dashed" },
            label: { show: !!m.label, formatter: m.label ?? "", position: "insideEndTop", ...text },
          }),
    };
  }

  // A dot mark is one emphasised point: its own one-point series, drawn above, not clickable.
  for (const m of marks) {
    if (m.kind !== "dot") continue;
    const owner = p.series.find((s) => s.id === m.seriesId);
    const pt = owner?.points.find((q) => q.x === m.x);
    if (!owner || !pt || pt.cents === null) continue;
    const color = colorOfRole(owner.role, owner.colorIndex, pal);
    series.push({
      id: dotSeriesId(owner.id), name: owner.label, type: "scatter", silent: true, z: 5,
      symbol: "circle", symbolSize: 8, itemStyle: { color, borderColor: pal.card, borderWidth: 2 },
      tooltip: { show: false }, data: [[xOf(pt.x), pt.cents]],
    });
  }

  const xTicks = p.xTicks ? new Set(p.xTicks) : null;

  return {
    animation: false,
    ...(p.timeScale ? { useUTC: true } : {}),
    stateAnimation: { duration: 0 },
    backgroundColor: "transparent",
    textStyle: { fontFamily: pal.font, fontSize: L.fontSize, color: pal.ink2 },
    aria: { enabled: true },
    grid: { left: 8, right: 24, top: showLegend ? 34 : 16, bottom: zoom ? 56 : 8, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    legend: {
      show: showLegend, top: 0, left: 0,
      data: p.series.map((s) => ({ name: s.label, icon: s.mark === "bar" ? "rect" : "roundRect" })),
      itemWidth: anyBar ? 12 : 14, itemHeight: anyBar ? 8 : 3,
      textStyle: text,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: pal.card, borderColor: pal.line, borderWidth: 1, padding: L.tooltip.padding,
      extraCssText: `box-shadow: ${L.tooltip.shadow}; border-radius: ${L.tooltip.radius}px;`,
      textStyle: { color: pal.ink, fontFamily: pal.font, fontSize: L.tooltip.fontSize },
      axisPointer: {
        type: L.crosshair, lineStyle: { color: pal.ink2, width: 1 },
        label: { backgroundColor: pal.ink, color: pal.card, fontFamily: pal.font },
      },
      formatter: (params: unknown) => {
        const first = Array.isArray(params) ? params[0] : params;
        const axisValue = (first as { axisValue?: unknown } | undefined)?.axisValue;
        const x = typeof axisValue === "number" && p.timeScale ? new Date(axisValue).toISOString().slice(0, 10) : String(axisValue ?? "");
        const t = tooltipRows(p, x);
        return escapeHtml(t.title) + t.rows.map((r) => `<br>${escapeHtml(r.label)}: <b>${escapeHtml(r.value)}</b>`).join("");
      },
    },
    xAxis: {
      // Readings sit at midnight UTC; ticks are placed in UTC and never closer than a day, so each tick is one calendar date, whatever the time zone.
      ...(p.timeScale ? { type: "time", minInterval: DAY_MS } : { type: "category", data: xs }),
      // Bars need a half-step at each end or the first and last are cut in half; lines run edge to edge.
      boundaryGap: p.timeScale ? false : p.axis === "category" || anyBar,
      axisLine: { lineStyle: { color: pal.line } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        ...text,
        formatter: (v: string | number) => fmtX(typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : v),
        ...(xTicks && !p.timeScale ? { interval: (_: number, v: string) => xTicks.has(v) } : {}),
      },
    },
    yAxis: {
      type: "value",
      scale: p.yFit === true,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: pal.grid, type: "solid" } },
      axisLabel: { ...text, formatter: (v: number) => formatAxisDollars(v) },
    },
    dataZoom: zoom
      ? [
          { type: "inside", throttle: 16 },
          {
            type: "slider", height: 26, bottom: 10, borderColor: pal.line, backgroundColor: "transparent",
            fillerColor: pal.grid, handleStyle: { color: pal.card, borderColor: pal.ink2 }, moveHandleStyle: { color: pal.line },
            dataBackground: { lineStyle: { color: pal.ink2, opacity: 0.5 }, areaStyle: { color: pal.grid } },
            selectedDataBackground: { lineStyle: { color: pal.ink }, areaStyle: { color: pal.grid } },
            textStyle: { color: pal.ink2, fontFamily: pal.font, fontSize: 11 },
          },
        ]
      : [],
    series,
  };
}

function seriesOption(s: ChartSeries, L: (typeof LOOKS)[ChartLook], pal: Palette, xOf: (x: string) => string | number): Record<string, unknown> {
  const color = colorOfRole(s.role, s.colorIndex, pal);
  const toneColor = (tone: "good" | "bad" | undefined) => (tone ? colorOfRole(tone, undefined, pal) : undefined);

  if (s.mark === "bar") {
    const r = L.barRadius;
    return {
      id: s.id, name: s.label, type: "bar",
      ...(s.stack ? { stack: s.stack } : {}),
      ...(s.barMaxWidth !== undefined ? { barMaxWidth: s.barMaxWidth } : { barWidth: L.barWidth }),
      itemStyle: { color },
      data: s.points.map((pt) => {
        const tc = toneColor(pt.tone);
        // A bar rounds the end away from zero; bars in a stack stay square so they meet cleanly.
        const radius = s.stack ? 0 : pt.cents !== null && pt.cents < 0 ? [0, 0, r, r] : [r, r, 0, 0];
        return { value: [xOf(pt.x), pt.cents], itemStyle: { borderRadius: radius, ...(tc ? { color: tc } : {}) } };
      }),
    };
  }

  const dashed = s.role === "plan" || s.dash === true;
  const drawn = s.points.filter((pt) => pt.cents !== null).length;
  return {
    id: s.id, name: s.label, type: "line",
    ...(s.mark === "step" ? { step: "middle" } : {}),
    smooth: false,
    connectNulls: false,
    // A single point is invisible as a line, so it shows its dot.
    showSymbol: s.showPoints ?? drawn <= 1,
    symbol: "circle", symbolSize: 8,
    lineStyle: { color, width: dashed ? Math.max(1.5, L.lineWidth - 0.5) : L.lineWidth, type: dashed ? "dashed" : "solid" },
    itemStyle: { color, borderColor: pal.card, borderWidth: 2 },
    data: s.points.map((pt) => {
      const tc = toneColor(pt.tone);
      return tc ? { value: [xOf(pt.x), pt.cents], itemStyle: { color: tc } } : [xOf(pt.x), pt.cents];
    }),
  };
}
