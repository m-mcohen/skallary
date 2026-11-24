// @vitest-environment jsdom
// tests/ui/PanelBudgetBox.test.tsx
// The budget box (picks 1A, 3A, layout A): the first line of the panel
// that opens under the line you click is the line's budget, from the month you are looking at
// on. Enter or clicking away saves; Esc puts the old amount back. Change budget stays for the
// other choices. No box on a finished month or on Paychecks, which reads Settings.
import { afterEach, beforeAll, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetMonth from "../../src/ui/budget/BudgetMonth";
import { makeBudgetLayer, PLAN, TODAY } from "./budget-fixtures";
import type { BigMonth } from "../../src/domain/plan-types";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = RO;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => cleanup());

const BOX = "Budget from October 2026 on";

async function openPanel(line: string, over = {}) {
  const user = userEvent.setup();
  const made = makeBudgetLayer(over);
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today={TODAY} />);
  const row = await screen.findByRole("row", { name: new RegExp(`^${line}\\b`) });
  await user.click(within(row).getByRole("button", { name: line }));
  return { user, panel: await screen.findByRole("region", { name: line }), ...made };
}

test("the box is the first line of the panel, filled in with the line's own budget", async () => {
  const { panel } = await openPanel("Groceries");
  const box = within(panel).getByRole("textbox", { name: BOX }) as HTMLInputElement;
  expect(box.value).toBe("450.00");
  expect(panel.firstElementChild!.contains(box)).toBe(true);
  // Change budget stays for the other choices.
  expect(within(panel).getByRole("button", { name: "Change budget" })).toBeTruthy();
});

test("Enter saves from this month on, and says so", async () => {
  const { user, panel, layer } = await openPanel("Groceries");
  const box = within(panel).getByRole("textbox", { name: BOX });
  await user.clear(box);
  await user.type(box, "500{Enter}");
  await waitFor(() => expect(layer.changeBudgetLine).toHaveBeenCalledWith(expect.anything(), PLAN.id, "Groceries", "2026-10", 50_000));
  expect((await within(panel).findByRole("status")).textContent).toBe("Saved: $500.00 a month from October 2026 on.");
});

test("clicking away saves; leaving it unchanged saves nothing", async () => {
  const { user, panel, layer } = await openPanel("Groceries");
  const box = within(panel).getByRole("textbox", { name: BOX });
  await user.click(box);
  fireEvent.blur(box);
  expect(layer.changeBudgetLine).not.toHaveBeenCalled();
  await user.clear(box);
  await user.type(box, "475.25");
  fireEvent.blur(box);
  await waitFor(() => expect(layer.changeBudgetLine).toHaveBeenCalledWith(expect.anything(), PLAN.id, "Groceries", "2026-10", 47_525));
  expect(layer.changeBudgetLine).toHaveBeenCalledTimes(1);
});

test("Esc puts the old amount back and saves nothing", async () => {
  const { user, panel, layer } = await openPanel("Groceries");
  const box = within(panel).getByRole("textbox", { name: BOX }) as HTMLInputElement;
  await user.clear(box);
  await user.type(box, "999{Escape}");
  expect(box.value).toBe("450.00");
  fireEvent.blur(box);
  expect(layer.changeBudgetLine).not.toHaveBeenCalled();
});

test("text that is not dollars is refused in plain words, and nothing is saved", async () => {
  const { user, panel, layer } = await openPanel("Groceries");
  const box = within(panel).getByRole("textbox", { name: BOX });
  await user.clear(box);
  await user.type(box, "abc{Enter}");
  expect((await within(panel).findByRole("alert")).textContent).toBe("Type dollars, such as 450.00.");
  expect(layer.changeBudgetLine).not.toHaveBeenCalled();
});

test("the box holds your own amount, not a big month on top of it", async () => {
  // October's budget is $450.00 + a $300.00 big month = $750.00; the box must not save the big month into the line.
  const big: BigMonth = { id: 7, planId: PLAN.id, planningCategory: "Groceries", month: "2026-10", label: "Party", amountCents: 30_000, createdAt: "" };
  const { panel } = await openPanel("Groceries", { bigMonths: [big] });
  // The line's own row (the panel's row under it takes its name from its contents).
  expect(document.querySelector("tr[aria-label='Groceries']")!.textContent).toContain("$750.00");
  expect((within(panel).getByRole("textbox", { name: BOX }) as HTMLInputElement).value).toBe("450.00");
});

test("Paychecks has no box (it reads Settings)", async () => {
  const { panel } = await openPanel("Paychecks");
  expect(within(panel).queryByRole("textbox", { name: /^Budget from/ })).toBeNull();
});

test("a finished month's panel has no box", async () => {
  const user = userEvent.setup();
  const made = makeBudgetLayer();
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today={TODAY} />);
  await screen.findByRole("table", { name: "Budget for October 2026" });
  await user.click(screen.getByRole("button", { name: /previous month/i }));
  const row = await screen.findByRole("row", { name: /^Groceries\b/ });
  await user.click(within(row).getByRole("button", { name: "Groceries" }));
  const panel = await screen.findByRole("region", { name: "Groceries" });
  expect(within(panel).queryByRole("textbox", { name: /^Budget from/ })).toBeNull();
});
