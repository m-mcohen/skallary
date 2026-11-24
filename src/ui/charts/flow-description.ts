// The Sankey in words, for a screen reader and the line under the chart: one plain sentence, the
// biggest bands, and which bands are estimates.
import type { PayFlow } from "../../domain/sankey";

const sum = (flow: PayFlow, keep: (l: PayFlow["links"][number]) => boolean) => flow.links.filter(keep).reduce((s, l) => s + l.cents, 0);

export function describeFlow(flow: PayFlow, formatValue: (c: number) => string): string {
  if (flow.links.length === 0) return "No money moved in this period.";
  const label = (id: string) => flow.nodes.find((n) => n.id === id)?.label ?? id;
  const parts: string[] = [];

  const gross = sum(flow, (l) => l.from === "gross");
  const arrived = sum(flow, (l) => l.to === "bank" && l.from !== "from-savings");
  if (flow.showsPaycheck && gross > 0) {
    const kept = sum(flow, (l) => l.from === "gross" && (l.to === "taxes" || l.to === "benefits"));
    parts.push(`Your gross pay of ${formatValue(gross)} lost ${formatValue(kept)} to taxes and benefits.`);
  } else if (arrived > 0) {
    parts.push(`${formatValue(arrived)} came into your bank.`);
  }

  const categories = flow.links
    .filter((l) => l.from === "bank" && l.to.startsWith("cat:"))
    .sort((a, b) => b.cents - a.cents || a.to.localeCompare(b.to))
    .slice(0, 2);
  if (categories.length > 0) {
    parts.push(`The biggest uses were ${categories.map((l) => `${label(l.to)} (${formatValue(l.cents)})`).join(" and ")}.`);
  }

  const left = sum(flow, (l) => l.to === "left-over");
  const fromSavings = sum(flow, (l) => l.from === "from-savings");
  if (left > 0) parts.push(`${formatValue(left)} was left over.`);
  else if (fromSavings > 0) parts.push(`${formatValue(fromSavings)} came from savings, so nothing was left over.`);

  const modelled = flow.nodes.filter((n) => n.modelled).map((n) => n.label);
  if (modelled.length > 0) parts.push(`Estimated from your Salary figures, not from bank rows: ${modelled.join(", ")}.`);
  return parts.join(" ");
}
