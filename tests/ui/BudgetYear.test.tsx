// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetYear from "../../src/ui/budget/BudgetYear";
import { makeBudgetLayer, PLAN, TODAY } from "./budget-fixtures";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = RO;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => cleanup());

const open = async () => {
  const made = makeBudgetLayer();
  render(<BudgetYear planId={PLAN.id} dataLayer={made.layer} today={TODAY} />);
  await screen.findByRole("table", { name: "Budget for 2026" });
  return made;
};

test("12 months across plus Average, a line between finished and future months", async () => {
  await open();
  const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
  expect(heads).toEqual(["Line", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Average"]);
  expect(screen.getByRole("columnheader", { name: "Oct" }).className).toContain("border-l");
  expect(screen.getByRole("columnheader", { name: "Sep" }).className).not.toContain("border-l");
});

test("a finished cell opens the panel on that month, budget locked", async () => {
  const user = userEvent.setup();
  await open();
  const row = screen.getByRole("row", { name: /^Groceries\b/ });
  await user.click(within(row).getByRole("button", { name: /^Groceries, March 2026/ }));
  const panel = await screen.findByRole("region", { name: "Groceries" });
  expect(within(panel).getByText("12 months to March 2026")).toBeTruthy();
  expect(within(panel).queryByRole("button", { name: "Change budget" })).toBeNull();
});

test("a future cell opens Change budget from that month on", async () => {
  const user = userEvent.setup();
  await open();
  const row = screen.getByRole("row", { name: /^Groceries\b/ });
  await user.click(within(row).getByRole("button", { name: /^Groceries, December 2026/ }));
  const panel = await screen.findByRole("region", { name: "Groceries" });
  expect(within(panel).getByRole("radio", { name: "From December 2026 on (something changed)" }).getAttribute("aria-checked")).toBe("true");
});

test("the grid scrolls inside its own box, line names frozen", async () => {
  await open();
  const box = screen.getByTestId("year-scroll");
  expect(box.className).toContain("overflow-x-auto");
  expect(screen.getByRole("rowheader", { name: /^Groceries/ }).className).toContain("sticky");
});

test("Rent is marked Set by you on the Year tab too", async () => {
  await open();
  expect(within(screen.getByRole("row", { name: /^Rent\b/ })).getByText("Set by you")).toBeTruthy();
});

// A screen reader hears each cell's figure, whether it is spent
// or budget, and a row's Set by you label.
test("cells and rows name their figures for a screen reader", async () => {
  await open();
  const row = screen.getByRole("row", { name: /^Groceries\b/ });
  expect(within(row).getByRole("button", { name: /^Groceries, March 2026, spent \$500\.00$/ })).toBeTruthy();
  expect(within(row).getByRole("button", { name: /^Groceries, December 2026, budget \$450\.00$/ })).toBeTruthy();
  expect(screen.getByRole("rowheader", { name: "Rent, set by you" })).toBeTruthy();
});

// Paychecks reads Settings; a future click must not open Change budget on it.
test("a future Paychecks cell opens the panel without Change budget", async () => {
  const user = userEvent.setup();
  await open();
  const row = screen.getByRole("row", { name: /^Paychecks\b/ });
  await user.click(within(row).getByRole("button", { name: /^Paychecks, December 2026/ }));
  const panel = await screen.findByRole("region", { name: "Paychecks" });
  expect(within(panel).queryByRole("textbox", { name: "New amount" })).toBeNull();
});

// A future big month is edited or deleted from its Year row.
test("a future big month's Year row has Edit and Delete", async () => {
  const user = userEvent.setup();
  const made = makeBudgetLayer({ bigMonths: [{ id: 6, planId: PLAN.id, planningCategory: "Gifts", month: "2026-12", label: "Holiday gifts", amountCents: 40000, createdAt: "" }] });
  render(<BudgetYear planId={PLAN.id} dataLayer={made.layer} today={TODAY} />);
  await user.click(await screen.findByRole("button", { name: "Change Holiday gifts" }));
  await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
  const ask = await screen.findByRole("alertdialog");
  await user.click(within(ask).getByRole("button", { name: "Delete" }));
  expect(made.layer.deleteBigMonth).toHaveBeenCalledWith(expect.anything(), 6);
});

// In December, a click on next year's budget opened this December's
// panel, against next year's lines. It opens on next year's first month instead.
test("in December, a cell in next year's budget opens the panel on that budget's first month", async () => {
  const user = userEvent.setup();
  const made = makeBudgetLayer();
  const PLAN_2027 = { ...PLAN, id: "plan-2027", name: "2027", startDate: "2027-01-01", endDate: "2027-12-31" };
  made.layer.listPlans = async () => [PLAN, PLAN_2027];
  render(<BudgetYear planId={PLAN_2027.id} dataLayer={made.layer} today="2026-12-10" />);
  await screen.findByRole("table", { name: "Budget for 2027" });
  const row = screen.getByRole("row", { name: /^Groceries\b/ });
  await user.click(within(row).getByRole("button", { name: /^Groceries, March 2027/ }));
  const panel = await screen.findByRole("region", { name: "Groceries" });
  expect(within(panel).getByText("12 months to January 2027")).toBeTruthy();
  expect(within(panel).getByRole("radio", { name: "From March 2027 on (something changed)" }).getAttribute("aria-checked")).toBe("true");
});
