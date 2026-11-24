// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetMonth from "../../src/ui/budget/BudgetMonth";
import BigMonthDialog from "../../src/ui/budget/BigMonthDialog";
import type { Db } from "../../src/ui/lib/db";
import { makeBudgetLayer, PLAN, TODAY } from "./budget-fixtures";
import type { BigMonth } from "../../src/domain/plan-types";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = RO;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => cleanup());

const trip: BigMonth = { id: 5, planId: PLAN.id, planningCategory: "Gifts", month: "2026-10", label: "Holiday gifts", amountCents: 40000, createdAt: "" };

test("Add a big month from the top bar saves its name, line, month and amount", async () => {
  const user = userEvent.setup();
  const { layer } = makeBudgetLayer();
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today={TODAY} />);
  await screen.findByRole("table", { name: "Budget for October 2026" });
  await user.click(screen.getByRole("button", { name: "Add a big month" }));
  const dialog = await screen.findByRole("dialog", { name: "Add a big month" });
  await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Holiday gifts");
  await user.click(within(dialog).getByRole("combobox", { name: "Line" }));
  await user.click(await screen.findByRole("option", { name: "Gifts" }));
  await user.click(within(dialog).getByRole("combobox", { name: "Month" }));
  await user.click(await screen.findByRole("option", { name: "December 2026" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Amount" }), "400");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(layer.addBigMonth).toHaveBeenCalledWith(expect.anything(), PLAN.id, { planningCategory: "Gifts", month: "2026-12", label: "Holiday gifts", amountCents: 40000 });
});

test("a big month shows as an indented row under its line, and its line's budget includes it", async () => {
  const { layer } = makeBudgetLayer({ bigMonths: [trip] });
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today={TODAY} />);
  const big = await screen.findByRole("row", { name: "Holiday gifts, a big month" });
  expect(within(big).getAllByText("$400.00").length).toBeGreaterThan(0);
  expect(within(screen.getByRole("row", { name: /^Gifts\b/ })).getAllByText("$500.00").length).toBeGreaterThan(0);
});

test("Delete asks first, then deletes", async () => {
  const user = userEvent.setup();
  const { layer } = makeBudgetLayer({ bigMonths: [trip] });
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today={TODAY} />);
  await user.click(await screen.findByRole("button", { name: "Change Holiday gifts" }));
  await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
  const ask = await screen.findByRole("alertdialog");
  expect(within(ask).getByText("Delete Holiday gifts?")).toBeTruthy();
  await user.click(within(ask).getByRole("button", { name: "Delete" }));
  expect(layer.deleteBigMonth).toHaveBeenCalledWith(expect.anything(), 5);
});

test("a name and an amount are required", async () => {
  const user = userEvent.setup();
  const { layer } = makeBudgetLayer();
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today={TODAY} />);
  await screen.findByRole("table", { name: "Budget for October 2026" });
  await user.click(screen.getByRole("button", { name: "Add a big month" }));
  const dialog = await screen.findByRole("dialog", { name: "Add a big month" });
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(within(dialog).getByText("Name the big month.")).toBeTruthy();
  expect(layer.addBigMonth).not.toHaveBeenCalled();
});

// A double-click on Save added the big month twice.
test("a double-click on Save adds the big month once", async () => {
  const { layer } = makeBudgetLayer();
  let finish: () => void = () => {};
  layer.addBigMonth = vi.fn(() => new Promise<BigMonth>((resolve) => { finish = () => resolve({ ...trip, id: 9 }); }));
  const onSaved = vi.fn();
  render(<BigMonthDialog plan={PLAN} today={TODAY} lines={["Gifts"]} presetLine="Gifts" db={{} as Db} deps={layer} onClose={() => {}} onSaved={onSaved} />);
  const dialog = await screen.findByRole("dialog", { name: "Add a big month" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Holiday gifts" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Amount" }), { target: { value: "400" } });
  const save = within(dialog).getByRole("button", { name: "Save" });
  fireEvent.click(save);
  fireEvent.click(save);
  finish();
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(layer.addBigMonth).toHaveBeenCalledTimes(1);
});

test("a projected bill or raise row is named, says where it was carried over from, and offers no Edit or Delete", async () => {
  const bill: BigMonth = { ...trip, id: -1, label: "Car insurance", origin: "yearly-bill", sourceId: 4, obligationYear: 2025 };
  const raise: BigMonth = { ...trip, id: -2, label: "Holiday gifts raise", origin: "raise", sourceId: 7 };
  const { layer } = makeBudgetLayer({ bigMonths: [bill, raise, { ...trip, id: 5 }] });
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today={TODAY} />);
  const billRow = await screen.findByRole("row", { name: "Car insurance, yearly bill" });
  expect(within(billRow).getByText("Yearly bill")).toBeTruthy();
  expect(within(billRow).getByText("carried over from 2025")).toBeTruthy();
  expect(within(screen.getByRole("row", { name: "Holiday gifts raise, raise" })).getByText("Raise")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /^Change /i })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Change Car insurance" })).toBeNull();
});
