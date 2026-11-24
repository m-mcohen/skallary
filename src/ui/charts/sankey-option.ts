// The Sankey's option for the chart library, in look A ("Ink and signal"). Pure: a flow in, an
// option out. Every band of the flow is drawn at its exact amount; the drawing order is the
// flow's own order (layoutIterations 0), so the picture is the same every time.
import type { FlowNode, PayFlow } from "../../domain/sankey";
import { flowOrder } from "../../domain/sankey";
import { isFlowNodeClickable } from "./click-through";
import { LOOKS, type Palette } from "./looks";
import type { ChartLook } from "./types";

/** A modelled band (estimated from Salary figures) is drawn fainter: a Sankey cannot dash a band. */
export const MODELLED_OPACITY = 0.35;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function nodeColor(node: FlowNode, pal: Palette): string {
  switch (node.kind) {
    case "bank": return node.id === "bank" ? pal.blue : pal.ink; // the hub is blue; money-in sources are ink
    case "pot": return pal.blue;
    case "saving": case "left-over": case "from-savings": return pal.green;
    case "taxes": case "benefits": case "gap": return pal.ink2;
    default: return pal.ink; // gross pay and categories
  }
}

export function buildSankeyOption(
  flow: PayFlow, look: ChartLook, dark: boolean, palette: Palette, view: "bank" | "paycheck", formatValue: (c: number) => string,
): unknown {
  void dark; // the palette already carries light or dark
  const L = LOOKS[look];
  const pal = palette;
  const order = flowOrder(flow);
  const nodes = [...flow.nodes].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const labelOf = (id: string) => byId.get(id)?.label ?? id;
  const size = (id: string) => {
    const i = flow.links.filter((l) => l.to === id).reduce((s, l) => s + l.cents, 0);
    const o = flow.links.filter((l) => l.from === id).reduce((s, l) => s + l.cents, 0);
    return Math.max(i, o);
  };
  const text = { color: pal.ink2, fontFamily: pal.font, fontSize: L.fontSize };

  return {
    animation: false,
    stateAnimation: { duration: 0 },
    backgroundColor: "transparent",
    textStyle: { fontFamily: pal.font, fontSize: L.fontSize, color: pal.ink2 },
    aria: { enabled: true },
    tooltip: {
      trigger: "item", triggerOn: "mousemove",
      backgroundColor: pal.card, borderColor: pal.line, borderWidth: 1, padding: L.tooltip.padding,
      extraCssText: `box-shadow: ${L.tooltip.shadow}; border-radius: ${L.tooltip.radius}px;`,
      textStyle: { color: pal.ink, fontFamily: pal.font, fontSize: L.tooltip.fontSize },
      formatter: (p: { dataType?: string; name?: string; value?: number; data?: { source?: string; target?: string; modelled?: boolean } }) => {
        if (p.dataType === "edge") {
          const d = p.data ?? {};
          const note = d.modelled ? "<br>Estimated from your Salary figures" : "";
          return `${escapeHtml(labelOf(String(d.source)))} to ${escapeHtml(labelOf(String(d.target)))}<br><b>${escapeHtml(formatValue(Number(p.value)))}</b>${note}`;
        }
        const id = String(p.name);
        return `${escapeHtml(labelOf(id))}<br><b>${escapeHtml(formatValue(size(id)))}</b>`;
      },
    },
    series: [{
      id: "flow", type: "sankey",
      left: 8, right: 210, top: 12, bottom: 12,
      nodeWidth: L.nodeWidth, nodeGap: L.nodeGap,
      layoutIterations: 0,
      // Not draggable: a move cursor would promise an action no band offers. Only a band that opens rows shows a pointer.
      draggable: false,
      nodeAlign: view === "paycheck" ? "left" : "justify",
      emphasis: { focus: "adjacency" },
      cursor: "default",
      lineStyle: { color: pal.flow, opacity: L.flowOpacity, curveness: L.curveness },
      label: {
        ...text, position: "right",
        formatter: (p: { name: string }) => `{n|${labelOf(p.name)}}  {a|${formatValue(size(p.name))}}`,
        rich: { n: { color: pal.ink, fontFamily: pal.font, fontSize: L.fontSize }, a: text },
      },
      labelLayout: { hideOverlap: true },
      data: nodes.map((n) => ({
        name: n.id,
        itemStyle: { color: nodeColor(n, pal), borderWidth: 0 },
        ...(isFlowNodeClickable(n) ? { cursor: "pointer" } : {}),
      })),
      links: flow.links.map((l) => ({
        source: l.from, target: l.to, value: l.cents, modelled: l.modelled,
        lineStyle: { opacity: l.modelled ? MODELLED_OPACITY : L.flowOpacity },
      })),
    }],
  };
}
