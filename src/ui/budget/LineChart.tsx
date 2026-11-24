// The line panel's 12 months: bars of what was spent, the budget as a stepped line, the
// 12-month average dashed. A bar is red in a month whose spending beat its budget by a real amount.
import { useMemo } from "react";
import ChartBase from "../charts/ChartBase";
import type { ChartMark, ChartSeries } from "../charts/types";
import { formatCents } from "../../domain/money";
import type { LineFigures } from "../../domain/budget-month";
import { monthBounds } from "../../domain/period";
import { ledgerHref } from "../lib/ledger-link";

export default function LineChart({ figures, line, side = "spending" }: { figures: LineFigures; line: string; side?: "spending" | "income" }) {
  const { series, marks, formatX } = useMemo(() => {
    const labels = new Map(figures.months.map((m) => [m.month, m.label]));
    const series: ChartSeries[] = [
      {
        id: "spent", label: "Spent", role: "actual", mark: "bar",
        points: figures.months.map((m) => ({ x: m.month, cents: m.spentCents, ...(m.tone === "red" ? { tone: "bad" as const } : {}) })),
      },
      {
        id: "budget", label: "Budget", role: "plan", mark: "step",
        points: figures.months.map((m) => ({ x: m.month, cents: m.budgetCents })),
      },
    ];
    const marks: ChartMark[] = figures.avg12 !== null
      ? [{ kind: "hline", cents: figures.avg12, role: "neutral", dash: true }]
      : [];
    return { series, marks, formatX: (x: string) => labels.get(x) ?? x };
  }, [figures]);
  const last = figures.months[figures.months.length - 1];
  const description =
    `${line}, 12 months: ${last ? `${formatCents(last.spentCents)} spent in the latest month` : "no months"}` +
    (figures.avg12 !== null ? `, ${formatCents(figures.avg12)} on average.` : ".");
  return (
    <ChartBase
      title={`${line}, 12 months`}
      description={description}
      axis="category"
      series={series}
      marks={marks}
      formatX={formatX}
      onMarkClick={(m) => {
        // A bar opens that month's rows for this line; the budget step line is a plan, with no rows.
        if (m.seriesId !== "spent") return;
        const { from, to } = monthBounds(m.x);
        window.location.hash = ledgerHref({ label: `${line}, ${formatX(m.x)}`, back: "#/budget/month", categories: [line], kind: side === "income" ? "income" : "expense", from, to });
      }}
      height={192}
    />
  );
}
