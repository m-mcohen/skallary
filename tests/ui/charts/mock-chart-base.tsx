// A stand-in for ChartBase in screen tests. It records the props every chart is given and draws
// one button per point, named "<series label> <x>", which clicks through like a mark on the chart.
//
// Usage, in a screen test:
//   vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
//   const charts = mockChartBase();   // then charts.calls, charts.last("Monthly cash flow")
import type { ChartBaseProps } from "../../../src/ui/charts/types";

/** What a screen gives the chart base: the shared props, plus the Sankey's option (or a function of the palette) and its band click. */
export type ChartCall = ChartBaseProps & { option?: unknown; onNodeClick?: (id: string) => void };

const calls: ChartCall[] = [];

function MockChartBase(p: ChartCall) {
  calls.push(p);
  return (
    <figure aria-label={p.title}>
      <figcaption>{p.description}</figcaption>
      {p.series.flatMap((s) =>
        s.points.map((pt) => (
          <button
            key={`${s.id}|${pt.x}`}
            type="button"
            aria-label={`${s.label} ${pt.x}`}
            data-stack={s.stack ?? ""}
            onClick={() => p.onMarkClick?.({ seriesId: s.id, x: pt.x })}
          >
            {pt.cents}
          </button>
        )),
      )}
    </figure>
  );
}

/** Every chart drawn since the last reset; `last(title)` is the most recent props given to that chart. */
export function mockChartBase(): { calls: ChartCall[]; last(title: string): ChartCall; reset(): void } {
  return {
    calls,
    last(title: string) {
      for (let i = calls.length - 1; i >= 0; i--) if (calls[i].title === title) return calls[i];
      throw new Error(`no chart titled "${title}" was drawn`);
    },
    reset() {
      calls.length = 0;
    },
  };
}

export default { default: MockChartBase };
