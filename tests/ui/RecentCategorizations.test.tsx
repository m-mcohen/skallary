// @vitest-environment jsdom
// tests/ui/RecentCategorizations.test.tsx
// The last 30 days of filings, newest first, each with Undo.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecentCategorizations from "../../src/ui/transactions/RecentCategorizations";
import type { CategorizationLogEntry } from "../../src/domain/categorizations";

afterEach(cleanup);

const entry = (over: Partial<CategorizationLogEntry>): CategorizationLogEntry => ({
  id: 1,
  createdAt: "2026-10-04T15:00:00.000Z",
  sourceTransactionId: "t1",
  label: "Shell",
  fromCategory: "Fuel",
  toCategory: "Gas",
  ruleId: 3,
  adjustmentId: null,
  recurringPayeeKey: null,
  recurringAccountId: null,
  priorRecurringChoice: null,
  writtenRecurringChoice: null,
  undoneAt: null,
  ...over,
});

test("each line names the merchant, the change and how far it reached, and offers Undo or says Undone", async () => {
  const user = userEvent.setup();
  let undone = false;
  const undo = vi.fn(async () => {
    undone = true;
    return { undone: true };
  });
  const onUndone = vi.fn();
  const load = vi.fn(async () => [
    entry({ id: 2, undoneAt: undone ? "2026-10-05T00:00:00.000Z" : null }),
    entry({ id: 1, label: "Netflix", fromCategory: "Streaming", toCategory: "Fun", undoneAt: "2026-10-04T16:00:00.000Z", ruleId: null, adjustmentId: 9 }),
  ]);
  render(<RecentCategorizations open onOpenChange={() => {}} load={load} undo={undo} onUndone={onUndone} />);
  const lines = await screen.findAllByRole("listitem");
  expect(within(lines[0]).getByText("Shell")).toBeTruthy();
  expect(within(lines[0]).getByText("Fuel → Gas")).toBeTruthy();
  expect(within(lines[0]).getByText("Every transaction from this merchant")).toBeTruthy();
  expect(within(lines[0]).getByText("Oct 4")).toBeTruthy();
  expect(within(lines[1]).getByText("This transaction")).toBeTruthy();
  expect(within(lines[1]).getByText("Undone")).toBeTruthy();
  expect(within(lines[1]).queryByRole("button", { name: /Undo/ })).toBeNull();

  await user.click(within(lines[0]).getByRole("button", { name: "Undo Shell" }));
  expect(undo).toHaveBeenCalledWith(2);
  expect(onUndone).toHaveBeenCalledTimes(1);
  // The list is read again, so the line now says Undone.
  await waitFor(() => expect(within(screen.getAllByRole("listitem")[0]).getByText("Undone")).toBeTruthy());
});

test("an empty list says so", async () => {
  render(<RecentCategorizations open onOpenChange={() => {}} load={async () => []} undo={vi.fn()} onUndone={vi.fn()} />);
  expect(await screen.findByText("Nothing filed in the last 30 days.")).toBeTruthy();
});

test("a refused undo shows the server's words", async () => {
  const user = userEvent.setup();
  const undo = vi.fn(async () => {
    throw new Error("The undo did not finish. Nothing changed.");
  });
  render(<RecentCategorizations open onOpenChange={() => {}} load={async () => [entry({})]} undo={undo} onUndone={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Undo Shell" }));
  expect(await screen.findByText("The undo did not finish. Nothing changed.")).toBeTruthy();
});
