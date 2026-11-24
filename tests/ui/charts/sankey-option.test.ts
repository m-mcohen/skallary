import { expect, test } from "vitest";
import { flowOrder } from "../../../src/domain/sankey";
import { buildSankeyOption, MODELLED_OPACITY } from "../../../src/ui/charts/sankey-option";
import { flowInteraction, flowLinks, flowNodes, nodeAlign } from "./option-reader";
import { invention, PALETTE } from "./sankey-fixtures";

const fmt = (c: number) => `$${c / 100}`;
const build = (flow = invention(), view: "bank" | "paycheck" = "bank") => buildSankeyOption(flow, "ink-and-signal", false, PALETTE, view, fmt);

test("every band the flow has is drawn, with its amount unchanged", () => {
  const flow = invention();
  flow.links[1].modelled = true;
  const option = build(flow);
  const drawn = flowLinks(option);
  expect(drawn.map((l) => [l.source, l.target, l.cents])).toEqual(flow.links.map((l) => [l.from, l.to, l.cents]));
  expect(flowNodes(option)).toEqual(flowOrder(flow));
  // A modelled band is fainter; the others are not.
  expect(drawn.map((l) => l.opacity === MODELLED_OPACITY)).toEqual([false, true, false, false, false]);
});

test("the paycheck view aligns left and the bank view justifies", () => {
  expect(nodeAlign(build(invention(), "paycheck"))).toBe("left");
  expect(nodeAlign(build(invention(), "bank"))).toBe("justify");
});

test("no band can be dragged, and only the bands that open rows show a pointer", () => {
  const { draggable, pointerNodes } = flowInteraction(build());
  expect(draggable).toBe(false);
  expect(pointerNodes.sort()).toEqual(["cat:Groceries", "cat:Rent", "in:Paychecks", "saving"]);
});
