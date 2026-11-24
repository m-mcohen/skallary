// The one component that owns a chart instance. Screens give it data (ChartBaseProps); it builds
// the library's option, makes the instance only once its box has a size, resizes with the box,
// redraws in the other palette when light and dark switch, and disposes on unmount.
import { useEffect, useId, useRef, useState } from "react";

import "./looks.css";
import { buildChartOption, markFromEvent } from "./buildChartOption";
import { joinLinkGroup } from "./link";
import { readPalette, type Palette } from "./looks";
import { prefersReducedMotion, switchMotion } from "./motion";
import { connectCharts, initChart, type ChartInstance } from "./register";
import type { ChartBaseProps } from "./types";

const DEFAULT_HEIGHT = 240;

const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

type Reason = "first" | "theme" | "props";

/** A passed-through option is either the option itself or a function of the palette and light/dark (the Sankey's, which must redraw in the other palette when the theme switches). */
export type PassedOption = unknown | ((palette: Palette, dark: boolean) => unknown);

export default function ChartBase(p: ChartBaseProps & { option?: PassedOption; onNodeClick?: (id: string) => void }) {
  const look = p.look ?? "ink-and-signal";
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartInstance | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const drawnOptionRef = useRef<unknown>(undefined);
  const propsRef = useRef(p);
  propsRef.current = p;
  const [dark, setDark] = useState(isDark);
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const descId = useId();

  // Draws the current props. Only a passed-through option (the Sankey's) moves, and only when that
  // option changes after the first draw: a view switch. Everything else is drawn without motion.
  const drawRef = useRef((reason: Reason) => {
    const chart = chartRef.current;
    const box = boxRef.current;
    if (!chart || !box) return;
    const props = propsRef.current;
    const palette = paletteRef.current ?? readPalette(box);
    let option: unknown;
    if (props.option !== undefined) {
      const isSwitch = reason === "props" && drawnOptionRef.current !== undefined && drawnOptionRef.current !== props.option;
      const motion = isSwitch ? switchMotion(prefersReducedMotion()) : { animation: false };
      const built = typeof props.option === "function" ? (props.option as (pal: Palette, dark: boolean) => unknown)(palette, darkRef.current) : props.option;
      option = { ...(built as object), ...motion };
      drawnOptionRef.current = props.option;
    } else {
      option = buildChartOption(props, props.look ?? "ink-and-signal", darkRef.current, palette);
    }
    chart.setOption(option as Parameters<ChartInstance["setOption"]>[0], { notMerge: true });
  });

  // Light and dark: the app switches by the `dark` class on <html>.
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // The palette is read on mount and again on every switch, then the chart redraws in it.
  useEffect(() => {
    if (!boxRef.current) return;
    const first = paletteRef.current === null;
    paletteRef.current = readPalette(boxRef.current);
    if (!first) drawRef.current("theme");
  }, [dark]);

  // Instance lifecycle: made only when the box has a width and a height (a hidden tab or a
  // collapsed panel has neither), resized with the box, disposed on unmount.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      const w = box.clientWidth, h = box.clientHeight;
      if (chartRef.current) {
        if (w > 0 && h > 0) chartRef.current.resize({ width: w, height: h });
        return;
      }
      if (!(w > 0 && h > 0)) return;
      const chart = initChart(box, w, h);
      chartRef.current = chart;
      chart.on("click", (e: unknown) => {
        const ev = e as { seriesId?: string; value?: unknown; dataType?: string; name?: unknown };
        if (ev.dataType === "node" && typeof ev.name === "string") {
          propsRef.current.onNodeClick?.(ev.name);
          return;
        }
        const mark = markFromEvent(ev);
        if (mark) propsRef.current.onMarkClick?.(mark);
      });
      joinLinkGroup(chart as unknown as { group?: string }, propsRef.current.linkGroup, connectCharts);
      drawRef.current("first");
    };
    fit();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(box);
    return () => {
      observer?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
      drawnOptionRef.current = undefined;
    };
  }, []);

  // New data or settings redraw the chart. Screens should keep these values stable between renders
  // (memoised), or every render redraws and a zoomed chart returns to its full range.
  useEffect(() => {
    drawRef.current("props");
  }, [p.option, p.series, p.marks, p.axis, p.zoom, p.yFit, p.legend, p.xTicks, p.formatX, p.formatTooltipX, p.timeScale, p.formatValue, look]);

  return (
    <figure
      role="img"
      aria-label={p.title}
      aria-describedby={descId}
      className={`chart-look-${look} m-0 w-full`}
    >
      <div ref={boxRef} style={{ width: "100%", height: p.height ?? DEFAULT_HEIGHT }} />
      <figcaption id={descId} className="sr-only">{p.description}</figcaption>
    </figure>
  );
}
