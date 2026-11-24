import { use, init } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { LineChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import { expect, test } from "vitest";

import { buildChartOption } from "../../../src/ui/charts/buildChartOption";
import type { Palette } from "../../../src/ui/charts/looks";

use([SVGRenderer, LineChart, GridComponent]);

const PAL: Palette = {
  ink: "i", ink2: "i2", line: "l", grid: "g", card: "c", blue: "b", red: "r", green: "gr", flow: "f",
  categorical: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"],
};

// The axis labels of a chart whose readings are on three days in a row.
function tickLabels(): string[] {
  const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
  const option = buildChartOption(
    {
      title: "t", description: "d", axis: "time", timeScale: true, formatX: (x: string) => x,
      series: [{ id: "n", label: "n", role: "actual", mark: "line", points: days.map((x, i) => ({ x, cents: 100 * i })) }],
    },
    "ink-and-signal", false, PAL,
  ) as { xAxis: { axisLabel: { formatter: (v: number) => string } } };
  const chart = init(null as unknown as HTMLElement, null, { renderer: "svg", ssr: true, width: 600, height: 300 });
  chart.setOption(option as never);
  const axis = (chart as unknown as { getModel(): { getComponent(n: string, i: number): { axis: { scale: { getTicks(): { value: number }[] } } } } })
    .getModel().getComponent("xAxis", 0).axis;
  const labels = axis.scale.getTicks().map((t) => option.xAxis.axisLabel.formatter(t.value));
  chart.dispose();
  return labels;
}

test("time-axis ticks name the calendar days of the readings, in any time zone", () => {
  const labels = tickLabels();
  expect(labels).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
});
