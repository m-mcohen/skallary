// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from "vitest";
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

const dec: BudgetChange = { id: 2, planId: PLAN.id, planningCategory: "Groceries", fromMonth: "2026-12", amountCents: 95000, reason: "changed", goalId: null, createdAt: "" };

async function openPanel(over = {}) {
  const user = userEvent.setup();
  const made = makeBudgetLayer(over);
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today={TODAY} />);
  const row = await screen.findByRole("row", { name: /^Groceries\b/ });
  await user.click(within(row).getByRole("button", { name: "Groceries" }));
  const panel = await screen.findByRole("region", { name: "Groceries" });
  return { user, panel, ...made };
}
async function openChange(over = {}) {
  const opened = await openPanel(over);
  await opened.user.click(within(opened.panel).getByRole("button", { name: "Change budget" }));
  return opened;
}

test("opens on From October on (something changed); fill-ins copy a figure", async () => {
  const { user, panel } = await openChange();
  expect(within(panel).getByRole("radio", { name: "From October 2026 on (something changed)" }).getAttribute("aria-checked")).toBe("true");
  expect(within(panel).getByRole("radio", { name: "Every month of 2026 (it was wrong all year)" }).getAttribute("aria-checked")).toBe("false");
  await user.click(within(panel).getByRole("button", { name: /12-month average/ }));
  expect((within(panel).getByRole("textbox", { name: "New amount" }) as HTMLInputElement).value).toBe("500.00");
});

test("the effect before saving and what it replaces, then Save from October on", async () => {
  const { user, panel, layer } = await openChange({ changes: [dec] });
  const box = within(panel).getByRole("textbox", { name: "New amount" });
  await user.clear(box);
  await user.type(box, "550");
  expect(within(panel).getByText(/Left over in 2026/)).toBeTruthy();
  expect(within(panel).getByText(/Spending budget in October 2026/)).toBeTruthy();
  expect(within(panel).getByText("This replaces $950.00 from December 2026")).toBeTruthy();
  await user.click(within(panel).getByRole("button", { name: "Save" }));
  expect(layer.changeBudgetLine).toHaveBeenCalledWith(expect.anything(), PLAN.id, "Groceries", "2026-10", 55000);
});

test("Every month of 2026 (it was wrong all year) saves with no month", async () => {
  const { user, panel, layer } = await openChange();
  await user.click(within(panel).getByRole("radio", { name: "Every month of 2026 (it was wrong all year)" }));
  const box = within(panel).getByRole("textbox", { name: "New amount" });
  await user.clear(box);
  await user.type(box, "480");
  await user.click(within(panel).getByRole("button", { name: "Save" }));
  expect(layer.changeBudgetLine).toHaveBeenCalledWith(expect.anything(), PLAN.id, "Groceries", null, 48000);
});

test("a bad amount is refused in plain words", async () => {
  const { user, panel, layer } = await openChange();
  const box = within(panel).getByRole("textbox", { name: "New amount" });
  await user.clear(box);
  await user.type(box, "abc");
  await user.click(within(panel).getByRole("button", { name: "Save" }));
  expect(within(panel).getByText("Enter an amount, like 450 or 450.00.")).toBeTruthy();
  expect(layer.changeBudgetLine).not.toHaveBeenCalled();
});

test("Go back to suggested lists what it clears and the amount it returns to", async () => {
  const { user, panel, layer } = await openPanel({ changes: [dec] });
  await user.click(within(panel).getByRole("button", { name: "Go back to suggested" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(await within(dialog).findByText("This clears: $950.00 from December 2026.")).toBeTruthy();
  expect(within(dialog).getByText("Back to $500.00 a month, from your 12-month average.")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Go back" }));
  expect(layer.resetBudgetLine).toHaveBeenCalledWith(expect.anything(), PLAN.id, "Groceries");
});

// The box opens at the line's own amount for the starting
// month, never the month's full budget (a big month, a goal, or the giving raise on top).
test("the amount box leaves out a big month and a goal amount", async () => {
  const big = { id: 5, planId: PLAN.id, planningCategory: "Groceries", month: "2026-10", label: "Party", amountCents: 40000, createdAt: "" };
  const goal: BudgetChange = { id: 9, planId: PLAN.id, planningCategory: "Groceries", fromMonth: "2026-03", amountCents: 7000, reason: "goal", goalId: "g1", createdAt: "" };
  const { panel } = await openChange({ bigMonths: [big], changes: [goal] });
  expect((within(panel).getByRole("textbox", { name: "New amount" }) as HTMLInputElement).value).toBe("450.00");
  expect(within(panel).getByText("Plus $70.00 a month for goals, kept on top.")).toBeTruthy();
});

test("a refund line saves a negative amount", async () => {
  const { user, panel, layer } = await openChange();
  const box = within(panel).getByRole("textbox", { name: "New amount" });
  await user.clear(box);
  await user.type(box, "-150.00");
  await user.click(within(panel).getByRole("button", { name: "Save" }));
  expect(layer.changeBudgetLine).toHaveBeenCalledWith(expect.anything(), PLAN.id, "Groceries", "2026-10", -15000);
});
