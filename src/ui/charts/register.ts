// The one place that loads ECharts: only the pieces the app draws, with the SVG renderer.
import { use, init, connect, type EChartsType } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { LineChart, BarChart, ScatterChart, SankeyChart } from "echarts/charts";
import {
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, AriaComponent,
} from "echarts/components";

use([
  SVGRenderer, LineChart, BarChart, ScatterChart, SankeyChart,
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, AriaComponent,
]);

export type ChartInstance = EChartsType;

export function initChart(el: HTMLElement, width: number, height: number): ChartInstance {
  return init(el, null, { renderer: "svg", width, height });
}

/** Links every chart in `group`: hovering one moves the others' crosshair. */
export function connectCharts(group: string): void {
  connect(group);
}
