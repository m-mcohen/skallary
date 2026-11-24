// What a click on a Sankey band opens. Only a band with rows behind it opens anything: a category
// (its spending), a source of money in (its income), and Saving. Taxes, benefits, the pot, left
// over and the rest are sums or estimates with no rows, so they open nothing and do not look clickable.
import { monthBounds } from "../../domain/period";
import type { FlowNode } from "../../domain/sankey";
import type { LedgerSpec } from "../lib/ledger-link";

// Money in that is not one income category's own rows: refunds are pooled from several categories,
// and pay into the pot is filed under the pot.
const NOT_AN_INCOME_CATEGORY = new Set(["in:refunds", "in:pot-pay"]);

/** True when a click on this band opens real rows. The chart shows a pointer only for these. */
export function isFlowNodeClickable(node: FlowNode): boolean {
  return ledgerSpecForFlowNode(node, "2000-01", "2000-01", "#/") !== null;
}

/** `from` and `to` are months ("YYYY-MM"), the period the Sankey is drawn for. */
export function ledgerSpecForFlowNode(node: FlowNode, from: string, to: string, back: string): LedgerSpec | null {
  const span = { from: monthBounds(from).from, to: monthBounds(to).to, back };
  if (node.kind === "category" && node.id.startsWith("cat:")) {
    const name = node.id.slice("cat:".length);
    // No kind filter: a category drawn as spending can be an income category whose refunds beat its pay,
    // and its rows are then income rows. The category and dates pick exactly the rows the band sums.
    return { ...span, label: name, categories: [name] };
  }
  if (node.kind === "bank" && node.id.startsWith("in:") && !NOT_AN_INCOME_CATEGORY.has(node.id)) {
    const name = node.id.slice("in:".length);
    // No kind filter: investment income (interest, dividends) is money in too, and the ledger's income filter drops it.
    return { ...span, label: name, categories: [name] };
  }
  if (node.kind === "saving") return { ...span, label: "Saving", kind: "saving" };
  return null;
}
