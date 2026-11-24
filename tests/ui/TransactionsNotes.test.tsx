// @vitest-environment jsdom
// tests/ui/TransactionsNotes.test.tsx
// On the Transactions screen: the note icon and its editor,
// search wording, the Recurring heading, and a filing that carries a note and
// "This repeats" in one call, with Undo.
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import TransactionsSection from "../../src/ui/TransactionsSection";
import { Toaster } from "../../src/components/ui/sonner";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { Period } from "../../src/domain/period";

const ALL_TIME: Period = { preset: "all", from: null, to: null };

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error -- jsdom polyfill for tests only
  global.ResizeObserver = ResizeObserverStub;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

afterEach(() => {
  act(() => toast.dismiss());
  cleanup();
});

const accounts = [
  { id: "a1", name: "JOINT CHECKING (0101)", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
] as Account[];

const row = (id: string, date: string, over: Partial<NormalizedTxn> = {}): NormalizedTxn => ({
  sourceTransactionId: id, accountId: "a1", date, amountCents: -1500, sourceCategory: "Streaming",
  merchant: null, isTransfer: false, sourceUpdatedAt: null, payee: "Netflix", ...over,
});
const txns = [
  row("n1", "2026-07-03"),
  row("n2", "2026-08-03"),
  row("n3", "2026-09-03"),
  row("p1", "2026-09-30", { amountCents: 500000, sourceCategory: "Paychecks", payee: "Payroll" }),
];

const layer = (over: Record<string, unknown> = {}) => ({
  loadDb: async () => ({ base: "" }),
  getTransactions: async () => txns,
  getMaaserMarks: async () => [],
  getAccounts: async () => accounts,
  getRules: async () => [],
  getAdjustments: async () => [],
  getCategoryMappings: async () => ({}),
  getCategories: async () => ["Streaming", "Fun"],
  createCategory: vi.fn(async () => {}),
  getRecurringChoices: async () => [],
  saveRecurringChoice: vi.fn(async () => {}),
  getMerchantRenames: async () => [],
  getZelleMemoNames: async () => false,
  fileCategorization: vi.fn(async () => ({ id: 7 })),
  undoCategorization: vi.fn(async () => ({ undone: true })),
  getRecentCategorizations: async () => [],
  getNotes: async () => [{ sourceTransactionId: "n2", note: "Shared with Sam", updatedAt: "x" }],
  saveNote: vi.fn(async () => {}),
  ...over,
});

test("the note icon is plain when empty and filled with a note, whose words show on hover", async () => {
  render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} asOfDate="2026-10-05" />);
  const withNote = await screen.findByRole("button", { name: "Note: Shared with Sam" });
  expect(withNote.getAttribute("data-filled")).toBe("true");
  expect(withNote.getAttribute("title")).toBe("Shared with Sam");
  const empty = screen.getAllByRole("button", { name: "Add a note" });
  expect(empty.length).toBe(3);
  expect(empty[0].getAttribute("data-filled")).toBe("false");
});

test("the note editor saves what was typed; Cancel saves nothing", async () => {
  const user = userEvent.setup();
  const l = layer();
  render(<TransactionsSection period={ALL_TIME} dataLayer={l} asOfDate="2026-10-05" />);
  await user.click((await screen.findAllByRole("button", { name: "Add a note" }))[0]);
  await user.type(await screen.findByRole("textbox", { name: "Note" }), "Paid back");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(l.saveNote).not.toHaveBeenCalled();

  await user.click(screen.getAllByRole("button", { name: "Add a note" })[0]);
  const box = await screen.findByRole("textbox", { name: "Note" });
  await user.clear(box);
  await user.type(box, "Paid back");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(l.saveNote).toHaveBeenCalledTimes(1));
  const [, id, note] = (l.saveNote as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(note).toBe("Paid back");
  expect(["n1", "n3", "p1"]).toContain(id);
});

test("the search box names notes, and a note's words find its row", async () => {
  const user = userEvent.setup();
  render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} asOfDate="2026-10-05" />);
  const search = await screen.findByPlaceholderText("Search merchant, category, or note...");
  await user.type(search, "sam");
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^Note:|^Add a note$/ })).toHaveLength(1));
  expect(screen.getByRole("button", { name: "Note: Shared with Sam" })).toBeTruthy();
});

test("the Recurring column has its heading, and the unmarked repeat button is not muted", async () => {
  render(<TransactionsSection period={ALL_TIME} dataLayer={layer({ getTransactions: async () => [txns[0]] })} asOfDate="2026-10-05" />);
  expect(await screen.findByText("Recurring")).toBeTruthy();
  const repeat = await screen.findByRole("button", { name: "Mark Netflix as recurring" });
  expect(repeat.className).not.toContain("text-muted-foreground");
});

test("filing from the grid makes one call carrying the change, the note and This repeats; the toast's Undo undoes it", async () => {
  const user = userEvent.setup();
  // One payment only, so the app has not found it recurring and the box starts unticked.
  const l = layer({ getTransactions: async () => [txns[2]] });
  render(
    <>
      <TransactionsSection period={ALL_TIME} dataLayer={l} asOfDate="2026-10-05" />
      <Toaster />
    </>
  );
  await user.click(await screen.findByTestId("txn-category-n3"));
  const box = screen.getByRole("combobox", { name: "Category" });
  await user.type(screen.getByRole("textbox", { name: "Note" }), "Family plan");
  await user.click(screen.getByRole("checkbox", { name: "This repeats" }));
  expect((screen.getByRole("combobox", { name: "How often" }) as HTMLSelectElement).value).toBe("monthly");
  await user.type(box, "Fun");
  await user.click(await screen.findByRole("option", { name: "Fun" }));

  await waitFor(() => expect(l.fileCategorization).toHaveBeenCalledTimes(1));
  const f = (l.fileCategorization as ReturnType<typeof vi.fn>).mock.calls[0][1];
  expect(f).toMatchObject({
    sourceTransactionId: "n3",
    label: "Netflix",
    fromCategory: "Streaming",
    toCategory: "Fun",
    rule: null,
    adjustment: { matchKind: "id", sourceTransactionId: "n3", action: "recategorize", toCategory: "Fun" },
    note: "Family plan",
    recurring: { action: "save", choice: { payeeKey: "netflix", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Netflix" } },
  });

  const toastEl = await screen.findByText("Filed Netflix as Fun.");
  await user.click(within(toastEl.closest("[data-sonner-toast]") as HTMLElement).getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(l.undoCategorization).toHaveBeenCalledWith(expect.anything(), 7));
});

test("a note left as it was is not sent, so the filing leaves it alone", async () => {
  const user = userEvent.setup();
  const l = layer();
  render(<TransactionsSection period={ALL_TIME} dataLayer={l} asOfDate="2026-10-05" />);
  await user.click(await screen.findByTestId("txn-category-n2"));
  expect((screen.getByRole("textbox", { name: "Note" }) as HTMLInputElement).value).toBe("Shared with Sam");
  await user.type(screen.getByRole("combobox", { name: "Category" }), "Fun");
  await user.click(await screen.findByRole("option", { name: "Fun" }));
  await waitFor(() => expect(l.fileCategorization).toHaveBeenCalledTimes(1));
  expect((l.fileCategorization as ReturnType<typeof vi.fn>).mock.calls[0][1]).not.toHaveProperty("note");
});

test("money coming in offers no This repeats", async () => {
  const user = userEvent.setup();
  render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} asOfDate="2026-10-05" />);
  await user.click(await screen.findByTestId("txn-category-p1"));
  await screen.findByRole("textbox", { name: "Note" });
  expect(screen.queryByRole("checkbox", { name: "This repeats" })).toBeNull();
});

test("a charge the app already found recurring starts ticked with its rhythm, and filing it unchanged sends no mark", async () => {
  const user = userEvent.setup();
  const l = layer({ getTransactions: async () => [txns[0], txns[1], txns[2]] });
  render(<TransactionsSection period={ALL_TIME} dataLayer={l} asOfDate="2026-10-05" />);
  await user.click(await screen.findByTestId("txn-category-n3"));
  expect((screen.getByRole("checkbox", { name: "This repeats" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("combobox", { name: "How often" }) as HTMLSelectElement).value).toBe("monthly");
  await user.type(screen.getByRole("combobox", { name: "Category" }), "Fun");
  await user.click(await screen.findByRole("option", { name: "Fun" }));
  await waitFor(() => expect(l.fileCategorization).toHaveBeenCalledTimes(1));
  expect((l.fileCategorization as ReturnType<typeof vi.fn>).mock.calls[0][1]).not.toHaveProperty("recurring");
});

test("unticking a charge the app found sends Not recurring", async () => {
  const user = userEvent.setup();
  const l = layer({ getTransactions: async () => [txns[0], txns[1], txns[2]] });
  render(<TransactionsSection period={ALL_TIME} dataLayer={l} asOfDate="2026-10-05" />);
  await user.click(await screen.findByTestId("txn-category-n3"));
  await user.click(screen.getByRole("checkbox", { name: "This repeats" }));
  await user.type(screen.getByRole("combobox", { name: "Category" }), "Fun");
  await user.click(await screen.findByRole("option", { name: "Fun" }));
  await waitFor(() => expect(l.fileCategorization).toHaveBeenCalledTimes(1));
  expect((l.fileCategorization as ReturnType<typeof vi.fn>).mock.calls[0][1].recurring).toMatchObject({
    action: "save",
    choice: { choice: "not_recurring", cadence: null },
  });
});

test("Recent categorizations opens from the filter row and its Undo re-reads the screen", async () => {
  const user = userEvent.setup();
  const getTransactions = vi.fn(async () => txns);
  const l = layer({
    getTransactions,
    getRecentCategorizations: async () => [
      {
        id: 3, createdAt: "2026-10-04T15:00:00.000Z", sourceTransactionId: "n3", label: "Netflix", fromCategory: "Streaming",
        toCategory: "Fun", ruleId: null, adjustmentId: 4, recurringPayeeKey: null, recurringAccountId: null,
        priorRecurringChoice: null, writtenRecurringChoice: null, undoneAt: null,
      },
    ],
  });
  render(<TransactionsSection period={ALL_TIME} dataLayer={l} asOfDate="2026-10-05" />);
  await user.click(await screen.findByRole("button", { name: "Recent categorizations" }));
  expect(await screen.findByText("Streaming → Fun")).toBeTruthy();
  const reads = getTransactions.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Undo Netflix" }));
  await waitFor(() => expect(l.undoCategorization).toHaveBeenCalledWith(expect.anything(), 3));
  await waitFor(() => expect(getTransactions.mock.calls.length).toBeGreaterThan(reads));
});
