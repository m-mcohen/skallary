import type { ChartLook, SeriesRole } from "./types";

/** A look's numbers. Its colours live in looks.css; a second look is a new entry here plus a CSS block. */
export interface LookNumbers {
  fontSize: number;
  grid: "h";                 // horizontal grid lines only
  lineWidth: number;
  area: boolean;             // fills under lines
  barRadius: number;
  barWidth: number;
  nodeWidth: number;         // Sankey
  nodeGap: number;
  flowOpacity: number;
  curveness: number;
  crosshair: "line";
  tooltip: { padding: [number, number]; radius: number; shadow: string; fontSize: number };
}

export const LOOKS: Record<ChartLook, LookNumbers> = {
  "ink-and-signal": {
    fontSize: 12,
    grid: "h",
    lineWidth: 2,
    area: false,
    barRadius: 4,
    barWidth: 14,
    nodeWidth: 12,
    nodeGap: 12,
    flowOpacity: 0.55,
    curveness: 0.5,
    crosshair: "line",
    tooltip: { padding: [8, 10], radius: 8, shadow: "0 4px 16px rgb(0 0 0 / 0.12)", fontSize: 12 },
  },
};

export interface Palette {
  ink: string; ink2: string; line: string; grid: string; card: string;
  blue: string; red: string; green: string; flow: string; categorical: string[];
  font?: string;             // the page's font, so chart text matches the app
}

/** Reads the look's colour tokens (looks.css) as they apply to `el` right now, light or dark. */
export function readPalette(el: Element): Palette {
  const style = getComputedStyle(el);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    ink: v("--chart-ink"), ink2: v("--chart-ink-2"), line: v("--chart-line"), grid: v("--chart-grid"),
    card: v("--chart-card"), blue: v("--chart-blue"), red: v("--chart-red"), green: v("--chart-green"),
    flow: v("--chart-flow"),
    categorical: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--chart-c${i}`)),
    font: style.fontFamily || undefined,
  };
}

/** Actual is ink, plan blue, good green, bad red, neutral ink-2; a category takes its place in the categorical palette. */
export function colorOfRole(role: SeriesRole, colorIndex: number | undefined, pal: Palette): string {
  switch (role) {
    case "actual": return pal.ink;
    case "plan": return pal.blue;
    case "good": return pal.green;
    case "bad": return pal.red;
    case "neutral": return pal.ink2;
    case "category": {
      const n = pal.categorical.length;
      return pal.categorical[(((colorIndex ?? 0) % n) + n) % n];
    }
  }
}
