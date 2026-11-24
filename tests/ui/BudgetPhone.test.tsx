// @vitest-environment jsdom
// On a phone the line panel opens as a full-height sheet with
// one close control, not the sheet's own X on top of the panel's Close.
import { afterEach, beforeAll, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetMonth from "../../src/ui/budget/BudgetMonth";
import BudgetYear from "../../src/ui/budget/BudgetYear";
import { makeBudgetLayer, PLAN, TODAY } from "./budget-fixtures";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = RO;
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
});
afterEach(() => cleanup());

test("the month screen's panel is a full-height sheet with one Close", async () => {
  const user = userEvent.setup();
  const { layer } = makeBudgetLayer();
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today={TODAY} />);
  const row = await screen.findByRole("row", { name: /^Groceries\b/ });
  await user.click(within(row).getByRole("button", { name: "Groceries" }));
  const sheet = await screen.findByRole("dialog");
  expect(sheet.className).toContain("data-[side=bottom]:h-dvh");
  expect(within(sheet).getAllByRole("button", { name: /^Close$/ })).toHaveLength(1);
});

test("the Year tab's panel is a full-height sheet with one Close", async () => {
  const user = userEvent.setup();
  const { layer } = makeBudgetLayer();
  render(<BudgetYear planId={PLAN.id} dataLayer={layer} today={TODAY} />);
  const row = await screen.findByRole("row", { name: /^Groceries\b/ });
  await user.click(within(row).getByRole("button", { name: /^Groceries, March 2026/ }));
  const sheet = await screen.findByRole("dialog");
  expect(sheet.className).toContain("data-[side=bottom]:h-dvh");
  expect(within(sheet).getAllByRole("button", { name: /^Close$/ })).toHaveLength(1);
});
