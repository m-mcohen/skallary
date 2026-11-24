// The "Where pay goes" diagram: a flow of money, drawn through the shared chart base. The option is
// built from the flow only when the flow, the view or the formatter changes, so a hover or a re-render
// of the screen never redraws it.
import { useMemo } from "react";

import { formatCents } from "../../domain/money";
import type { PayFlow } from "../../domain/sankey";
import ChartBase from "./ChartBase";
import { describeFlow } from "./flow-description";
import type { Palette } from "./looks";
import { buildSankeyOption } from "./sankey-option";
import { useStable } from "./useStable";

const HEIGHT = 360;

export default function SankeyChart(p: { flow: PayFlow; view: "bank" | "paycheck"; onNodeClick?: (id: string) => void }) {
  const flow = useStable(p.flow);
  const view = p.view;
  // Memoised on the flow and view: a new function would be read as a view switch and move the bands.
  const option = useMemo(() => (pal: Palette, dark: boolean) => buildSankeyOption(flow, "ink-and-signal", dark, pal, view, formatCents), [flow, view]);
  return (
    <ChartBase
      title="Where pay goes"
      description={describeFlow(flow, formatCents)}
      axis="category"
      series={EMPTY}
      height={HEIGHT}
      option={option}
      onNodeClick={p.onNodeClick}
    />
  );
}

const EMPTY: never[] = [];
