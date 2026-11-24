// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetMonth from "../../src/ui/budget/BudgetMonth";
import { makeBudgetLayer, PLAN, TODAY } from "./budget-fixtures";
import type { BudgetChange } from "../../src/domain/plan-types";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = RO;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => cleanup());

const rentChange: BudgetChange = { id: 3, planId: PLAN.id, planningCategory: "Rent", fromMonth: "2026-11", amountCents: 230000, reason: "changed", goalId: null, createdAt: "" };
const suggestions = [
  { planningCategory: "Clothing", amountCents: 0, basis: { kind: "average" as const, months: 7, emptyMonths: 6 } },
  { planningCategory: "Gifts", amountCents: 12000, basis: { kind: "average" as const, months: 12, emptyMonths: 9 } },
  { planningCategory: "Groceries", amountCents: 50000, basis: { kind: "average" as const, months: 12, emptyMonths: 0 } },
  { planningCategory: "Rent", amountCents: 210000, basis: { kind: "bill" as const, bills: [{ label: "Landlord", cadence: "monthly" as const, usualCents: 210000 }] } },
];

async function openSetup() {
  const user = userEvent.setup();
  const made = makeBudgetLayer({ changes: [rentChange] });
  made.layer.getSetup = vi.fn(async () => ({ suggestions }));
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today={TODAY} />);
  await screen.findByRole("table", { name: "Budget for October 2026" });
  await user.click(screen.getByRole("button", { name: "Set up budget" }));
  const page = await screen.findByRole("region", { name: "Set up budget" });
  await within(page).findByRole("checkbox", { name: "Groceries" });
  return { user, page, ...made };
}

test("it opens in place of the table; every change ticked, small ones labeled, set-by-you unticked", async () => {
  const { page } = await openSetup();
  expect(screen.queryByRole("table", { name: "Budget for October 2026" })).toBeNull();
  expect(within(page).getByRole("checkbox", { name: "Groceries" }).getAttribute("aria-checked")).toBe("true");
  expect(within(page).getByRole("row", { name: /^Gifts/ }).textContent).toContain("small");
  const rent = within(page).getByRole("row", { name: /^Rent/ });
  expect(within(rent).getByText("Set by you")).toBeTruthy();
  expect(within(page).getByRole("checkbox", { name: "Rent" }).getAttribute("aria-checked")).toBe("false");
  expect(within(page).getByText(/This clears: \$2,300\.00 from November 2026/)).toBeTruthy();
  expect(within(page).getAllByText("Bill: Landlord $2,100.00 every month").length).toBeGreaterThan(0);
});

test("Apply sends the ticked lines", async () => {
  const { user, page, layer } = await openSetup();
  await user.click(within(page).getByRole("button", { name: "Apply 2 changes" }));
  expect(layer.applySetup).toHaveBeenCalledWith(expect.anything(), PLAN.id, [
    { line: "Gifts", amountCents: 12000 },
    { line: "Groceries", amountCents: 50000 },
  ]);
});

test("Untick all turns Apply into Keep as is, which applies nothing and still counts as a review", async () => {
  const { user, page, layer } = await openSetup();
  await user.click(within(page).getByRole("button", { name: "Untick all" }));
  await user.click(within(page).getByRole("button", { name: "Keep as is" }));
  expect(layer.applySetup).toHaveBeenCalledWith(expect.anything(), PLAN.id, []);
});

test("the totals move as boxes change, and Cancel goes back to the month", async () => {
  const { user, page } = await openSetup();
  const before = within(page).getByTestId("setup-monthly").textContent;
  await user.click(within(page).getByRole("checkbox", { name: "Groceries" }));
  expect(within(page).getByTestId("setup-monthly").textContent).not.toBe(before);
  await user.click(within(page).getByRole("button", { name: "Cancel" }));
  expect(await screen.findByRole("table", { name: "Budget for October 2026" })).toBeTruthy();
});

// Every line's amount can be typed, the folded ones too; a typed line is ticked and applies as typed.
test("a typed amount is ticked and applied in place of the suggestion", async () => {
  const { user, page, layer } = await openSetup();
  const groceries = within(page).getByRole("textbox", { name: "Groceries amount" });
  await user.clear(groceries);
  await user.type(groceries, "450");
  await user.click(within(page).getByRole("button", { name: "1 line unchanged" }));
  const clothing = within(page).getByRole("textbox", { name: "Clothing amount" });
  await user.clear(clothing);
  await user.type(clothing, "75.50");
  expect(within(page).getByRole("checkbox", { name: "Clothing" }).getAttribute("aria-checked")).toBe("true");
  await user.click(within(page).getByRole("button", { name: "Apply 3 changes" }));
  expect(layer.applySetup).toHaveBeenCalledWith(expect.anything(), PLAN.id, [
    { line: "Clothing", amountCents: 7550 },
    { line: "Gifts", amountCents: 12000 },
    { line: "Groceries", amountCents: 45000 },
  ]);
});

test("lines with no change are folded", async () => {
  const { page } = await openSetup();
  expect(within(page).getByText("1 line unchanged")).toBeTruthy();
});

test("the Dashboard's link opens it straight away", async () => {
  const made = makeBudgetLayer({ changes: [rentChange] });
  made.layer.getSetup = vi.fn(async () => ({ suggestions }));
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today={TODAY} startSetup />);
  expect(await screen.findByRole("region", { name: "Set up budget" })).toBeTruthy();
});

// Closing Set up budget clears ?setup=1, so a reload does not reopen it.
test("closing Set up budget clears ?setup=1 from the address", async () => {
  window.location.hash = "#/budget/month?setup=1";
  const user = userEvent.setup();
  const made = makeBudgetLayer({ changes: [rentChange] });
  made.layer.getSetup = vi.fn(async () => ({ suggestions }));
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today={TODAY} startSetup />);
  const page = await screen.findByRole("region", { name: "Set up budget" });
  await within(page).findByRole("checkbox", { name: "Groceries" });
  await user.click(within(page).getByRole("button", { name: "Cancel" }));
  expect(window.location.hash).toBe("#/budget/month");
});

// The owner's rule: a skipped tax step says so plainly. With no filing status, Salary needed is
// not priced on any table; the set-this-up card stands in its place.
test("with the tax step skipped, Salary needed shows the set-this-up card, not a figure", async () => {
  const user = userEvent.setup();
  const made = makeBudgetLayer({ changes: [rentChange] });
  made.layer.getSetup = vi.fn(async () => ({ suggestions }));
  const read = made.layer.getSalarySettings;
  made.layer.getSalarySettings = async (db) => ({ ...(await read(db)), tax: { filingStatus: null, children: null } });
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today={TODAY} />);
  await screen.findByRole("table", { name: "Budget for October 2026" });
  await user.click(screen.getByRole("button", { name: "Set up budget" }));
  const page = await screen.findByRole("region", { name: "Set up budget" });
  await within(page).findByRole("checkbox", { name: "Groceries" });
  expect(within(page).queryByTestId("setup-salary")).toBeNull();
  expect(within(page).getByRole("link", { name: /set this up/i }).getAttribute("href")).toBe("#/setup/tax");
});
