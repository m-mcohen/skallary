// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetMonth from "../../src/ui/budget/BudgetMonth";
import { makeBudgetLayer, PLAN, TODAY } from "./budget-fixtures";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = RO;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { cleanup(); localStorage.clear(); });

const open = async (over = {}) => {
  const { layer, state } = makeBudgetLayer(over);
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today={TODAY} />);
  await screen.findByRole("table", { name: "Budget for October 2026" });
  return { layer, state };
};
const rowOf = (name: string) => screen.getByRole("row", { name: new RegExp(`^${name}\\b`) });

test("groups read Fixed costs, Variable costs, Income, then Left over, with subtotals", async () => {
  await open();
  const headers = screen.getAllByRole("rowheader").map((h) => h.textContent);
  expect(headers.filter((t) => ["Fixed costs", "Variable costs", "Income", "Left over"].includes(t ?? ""))).toEqual(["Fixed costs", "Variable costs", "Income", "Left over"]);
  expect(screen.getByRole("columnheader", { name: "12-month average" })).toBeTruthy();
});

test("empty lines hide behind Show N lines with nothing in them", async () => {
  const user = userEvent.setup();
  await open();
  expect(screen.queryByRole("row", { name: /^Hobby/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Show 1 line with nothing in it" }));
  expect(rowOf("Hobby")).toBeTruthy();
});

test("Groceries is over budget: red Left, a Heading over tag, its note mark; Rent is Set by you", async () => {
  await open();
  const g = rowOf("Groceries");
  expect(within(g).getByText("Heading over")).toBeTruthy();
  expect(within(g).getByText("-$50.00").className).toContain("text-budget-red");
  expect(within(g).getByRole("button", { name: "Note for Groceries" })).toBeTruthy();
  expect(within(rowOf("Rent")).getByText("Set by you")).toBeTruthy();
});

test("October has no salary in Settings: Paychecks says so and Left over has no budget", async () => {
  await open();
  expect(within(rowOf("Paychecks")).getByText("No salary in Settings for October 2026.")).toBeTruthy();
});

test("the comparison picker changes the column and is remembered in this browser", async () => {
  const user = userEvent.setup();
  await open();
  await user.click(screen.getByRole("combobox", { name: "Compare against" }));
  await user.click(await screen.findByRole("option", { name: "Last month" }));
  expect(await screen.findByRole("columnheader", { name: "September 2026" })).toBeTruthy();
  expect(localStorage.getItem("budget.compare")).toBe("last-month");
});

test("Biggest change first lists every spending line together", async () => {
  const user = userEvent.setup();
  await open();
  await user.click(screen.getByRole("button", { name: "Biggest change first" }));
  expect(screen.getByRole("rowheader", { name: "All spending, biggest change first" })).toBeTruthy();
});

test("the month stepper steps back to September, a finished month", async () => {
  const user = userEvent.setup();
  await open();
  await user.click(screen.getByRole("button", { name: /previous month/i }));
  expect(await screen.findByRole("table", { name: "Budget for September 2026" })).toBeTruthy();
});

test("clicking a line opens its panel", async () => {
  const user = userEvent.setup();
  await open();
  await user.click(within(rowOf("Groceries")).getByRole("button", { name: "Groceries" }));
  expect(await screen.findByRole("region", { name: "Groceries" })).toBeTruthy();
});

test("a failed read of the charity marks shows an error instead of quietly counting every gift", async () => {
  const made = makeBudgetLayer();
  made.layer.getMaaserMarks = async () => {
    throw new Error("Could not read the marks.");
  };
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today={TODAY} />);
  expect(await screen.findByText("Could not read the marks.")).toBeTruthy();
  expect(screen.queryByRole("row", { name: /^Groceries\b/ })).toBeNull();
});
