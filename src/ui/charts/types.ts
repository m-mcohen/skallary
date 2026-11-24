// The chart base's types. Lane C owns this file; every field after the
// first set is optional, so a screen that gives only the first fields still draws.
export type ChartLook = "ink-and-signal";
/** What a series means; the look turns a role into a colour. "category" takes `colorIndex` from the categorical palette. */
export type SeriesRole = "actual" | "plan" | "good" | "bad" | "neutral" | "category";
/** One point. `cents: null` is a gap (a month with no figure), never a zero. `tone` colours that one mark. */
export interface ChartPoint { x: string; cents: number | null; tone?: "good" | "bad" }
export interface ChartSeries {
  id: string;
  label: string;
  role: SeriesRole;
  mark: "bar" | "line" | "step";
  points: ChartPoint[];
  stack?: string;          // bars with the same stack name sit on top of each other
  dash?: boolean;          // a dashed line (the plan role is always dashed)
  colorIndex?: number;     // 0..7, for role "category"
  showPoints?: boolean;    // a dot at every point (a one-point series always shows its dot)
  barMaxWidth?: number;    // bars narrower than the look's width when there are many
}
/** A line across the chart, a line down it, or one emphasised point of a series. */
export type ChartMark =
  | { kind: "hline"; cents: number; role: SeriesRole; label?: string; dash?: boolean }
  | { kind: "vline"; x: string; label?: string }
  | { kind: "dot"; seriesId: string; x: string };
export interface ChartBaseProps {
  look?: ChartLook;                 // default "ink-and-signal"
  title: string;                    // accessible name
  description: string;              // accessible description: one plain sentence about the data
  axis: "time" | "category";
  series: ChartSeries[];
  height?: number;
  zoom?: boolean;                   // time charts only
  linkGroup?: string;               // linked hover between charts
  onMarkClick?: (m: { seriesId: string; x: string }) => void; // open the transactions behind a mark
  formatValue?: (cents: number) => string;                    // default formatCents
  formatX?: (x: string) => string;  // one label for the axis and, unless formatTooltipX is given, the tooltip
  formatTooltipX?: (x: string) => string; // a longer tooltip heading (a week as its first to last day)
  timeScale?: boolean;              // x values are ISO dates placed at their real dates (readings far apart sit far apart)
  xTicks?: string[];                // only these x values get an axis label
  yFit?: boolean;                   // the money axis fits the data instead of starting at zero
  legend?: boolean;                 // default true
  marks?: ChartMark[];
}
