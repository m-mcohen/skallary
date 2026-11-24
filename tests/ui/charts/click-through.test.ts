import { expect, test } from "vitest";
import type { FlowNode } from "../../../src/domain/sankey";
import { buildPayFlow } from "../../../src/domain/sankey";
import { filterRows, toRows } from "../../../src/domain/transactions-view";
import { parseLedgerQuery, ledgerHref } from "../../../src/ui/lib/ledger-link";
import { EMPTY_FILTER } from "../../../src/domain/transactions-view";
import type { Account, NormalizedTxn } from "../../../src/domain/types";
import { isFlowNodeClickable, ledgerSpecForFlowNode } from "../../../src/ui/charts/click-through";

const node = (id: string, kind: FlowNode["kind"]): FlowNode => ({ id, label: id, kind, modelled: false });
const open = (n: FlowNode) => ledgerSpecForFlowNode(n, "2026-10", "2026-10", "#/budget/charts");

test("a category band opens that category's transactions for the period", () => {
  expect(open(node("cat:Groceries", "category"))).toMatchObject({
    categories: ["Groceries"], from: "2026-10-01", to: "2026-10-31",
  });
  // A year spans January to the as-of month.
  expect(ledgerSpecForFlowNode(node("cat:Rent", "category"), "2026-01", "2026-10", "#/x")).toMatchObject({ from: "2026-01-01", to: "2026-10-31" });
});

test("bands with no rows behind them open nothing", () => {
  for (const n of [node("taxes", "taxes"), node("left-over", "left-over"), node("bank", "bank"), node("pot", "pot"), node("in:refunds", "bank"), node("in:pot-pay", "bank"), node("gap", "gap")]) {
    expect(open(n), n.id).toBeNull();
    expect(isFlowNodeClickable(n), n.id).toBe(false);
  }
});

test("a source of money in opens that income, and Saving opens the saving rows", () => {
  expect(open(node("in:Paychecks", "bank"))).toMatchObject({ categories: ["Paychecks"] });
  expect(open(node("saving", "saving"))).toMatchObject({ kind: "saving" });
});

const CHK: Account = { id: "chk", name: "Checking", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" };
let n = 0;
const row = (date: string, amountCents: number, sourceCategory: string): NormalizedTxn => ({
  sourceTransactionId: `c${++n}`, accountId: "chk", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null,
});

test("every band that opens rows opens exactly the rows its amount adds up", () => {
  const prepared = [
    row("2026-10-01", 500000, "Paychecks"),
    row("2026-10-02", 1200, "Interest"),                 // investment income: money in, not "income"
    row("2026-10-03", -200000, "Rent"),
    row("2026-10-04", 9000, "Bonus"), row("2026-10-05", -30000, "Bonus"), // an income category whose refunds beat its pay: drawn as money out
    row("2026-10-06", -50000, "Investing"),
  ];
  const flow = buildPayFlow({ prepared, accounts: [CHK], mapping: {}, from: "2026-10", to: "2026-10", pot: null, potLedger: null, paycheck: null, showPaycheck: false });
  const rows = toRows(prepared, [CHK], {});
  const opened: string[] = [];
  for (const node of flow.nodes) {
    const spec = ledgerSpecForFlowNode(node, flow.from, flow.to, "#/budget/charts");
    if (!spec) continue;
    const { initialFilter } = parseLedgerQuery(new URLSearchParams(ledgerHref(spec).split("?")[1]));
    const shown = filterRows(rows, { ...EMPTY_FILTER, ...initialFilter });
    const sum = Math.abs(shown.reduce((s, r) => s + r.txn.amountCents, 0));
    const band = flow.links.filter((l) => l.from === node.id || l.to === node.id).reduce((s, l) => Math.max(s, l.cents), 0);
    expect(sum, node.id).toBe(band);
    expect(shown.length, node.id).toBeGreaterThan(0);
    opened.push(node.id);
  }
  expect(opened).toEqual(expect.arrayContaining(["in:Interest", "in:Paychecks", "cat:Bonus", "cat:Rent", "saving"]));
});
