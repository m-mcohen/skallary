import { expect, test } from "vitest";
import { describeFlow } from "../../../src/ui/charts/flow-description";
import { invention } from "./sankey-fixtures";

const fmt = (c: number) => `$${(c / 100).toLocaleString("en-US")}`;

test("the description names the money in, the biggest bands and what is left", () => {
  const text = describeFlow(invention(), fmt);
  expect(text).toContain("$5,000");
  expect(text).toContain("Rent");
  expect(text).toContain("Groceries");
  expect(text).toContain("$1,750");
});

test("a shortfall says it came from savings and mentions no left over amount", () => {
  const flow = invention();
  flow.links = flow.links.filter((l) => l.to !== "left-over");
  flow.links.push({ from: "from-savings", to: "bank", cents: 30000, modelled: false });
  flow.nodes.push({ id: "from-savings", label: "From savings", kind: "from-savings", modelled: false });
  const text = describeFlow(flow, fmt);
  expect(text).toContain("$300 came from savings");
  expect(text).not.toMatch(/\$[\d,]+ was left over/);
  // Savings money is not money that came in.
  expect(text).toContain("$5,000 came into your bank");
});

test("an empty flow says no money moved in the period", () => {
  expect(describeFlow({ from: "2026-10", to: "2026-10", nodes: [], links: [], showsPaycheck: false }, fmt)).toBe("No money moved in this period.");
});

test("estimated bands are named, so nobody reads them as bank rows", () => {
  const flow = invention();
  flow.nodes.push({ id: "taxes", label: "Taxes", kind: "taxes", modelled: true });
  expect(describeFlow(flow, fmt)).toContain("Taxes");
});
