// @vitest-environment jsdom
// tests/ui/MarkRecurring.test.tsx
//
// Mark as recurring on Transactions: a repeat button on each money-out spending
// row that has a merchant; a dialog that guesses how often it repeats and saves
// the user's choice; the button shows filled once the row belongs to a recurring
// charge.
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import TransactionsSection from "../../src/ui/TransactionsSection";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { RecurringChoice, RecurringChoiceInput } from "../../src/domain/recurring-choices";

const ALL_TIME = { preset: "all", from: null, to: null } as const;

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error -- jsdom polyfill for tests only
  global.ResizeObserver = ResizeObserverStub;
});

afterEach(cleanup);

const accounts = [
  { id: "a1", name: "REWARDS CARD (0303)", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
] as Account[];

const t = (id: string, date: string, amountCents: number, payee: string | null, over: Partial<NormalizedTxn> = {}) =>
  ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory: "Insurance", merchant: null, isTransfer: false, sourceUpdatedAt: null, payee, ...over }) as NormalizedTxn;

const txns = [
  t("l1", "2026-08-02", -3000, "Example Insurance"),
  t("l2", "2026-08-21", 500, "Example Insurance"),
  t("l3", "2026-09-02", -1800, "Example Insurance"),
  t("x1", "2026-09-03", -50000, "Pinecrest Autopay", { isTransfer: true }),
  t("p1", "2026-09-04", -500, null, { description: "POS 1234" }),
  t("i1", "2026-09-05", 500000, "Employer", { sourceCategory: "Paychecks" }),
  t("n1", "2026-06-15", -1500, "Netflix", { sourceCategory: "Streaming" }),
  t("n2", "2026-07-15", -1500, "Netflix", { sourceCategory: "Streaming" }),
  t("n3", "2026-08-15", -1500, "Netflix", { sourceCategory: "Streaming" }),
];

const layer = (over: Record<string, unknown> = {}) => {
  let choices: RecurringChoice[] = [];
  const saved: RecurringChoiceInput[] = [];
  return {
    saved,
    loadDb: async () => ({ base: "" }),
    getTransactions: async () => txns,
    getMaaserMarks: async () => [],
    getAccounts: async () => accounts,
    getRules: async () => [],
    getAdjustments: async () => [],
    getCategoryMappings: async () => ({}),
    getCategories: async () => ["Insurance", "Streaming", "Paychecks"],
    createCategory: async () => {},
    addRule: async () => 1,
    addAdjustment: async () => {},
    getRecurringChoices: async () => choices,
    saveRecurringChoice: async (_db: unknown, c: RecurringChoiceInput) => {
      saved.push(c);
      choices = [...choices, { ...c, createdAt: "2026-09-10T12:00:00.000Z" }];
    },
    ...over,
  };
};

const show = (data: ReturnType<typeof layer>) =>
  render(<TransactionsSection dataLayer={data} period={ALL_TIME} initialFilter={{ transfers: "include" }} asOfDate="2026-09-10" />);

describe("Mark as recurring", () => {
  test("money-out spending rows with a merchant get the button; transfers, money in and rows with no merchant do not", async () => {
    show(layer());
    await screen.findAllByRole("button", { name: "Mark Example Insurance as recurring" });
    // Two Example Insurance payments; the refund (money in) has none.
    expect(screen.getAllByRole("button", { name: "Mark Example Insurance as recurring" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Pinecrest Autopay/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Employer/ })).toBeNull();
    // A row with no payee and no merchant has no merchant key: look inside ITS row, because a button
    // there would be named "Mark  as recurring", not after its description.
    const noMerchant = screen.getByText("POS 1234").closest("[role=row]") as HTMLElement;
    expect(within(noMerchant).queryByRole("button", { name: /recurring/ })).toBeNull();
    // The app already found Netflix: its rows show the filled button.
    expect(screen.getAllByRole("button", { name: "Netflix is recurring" })).toHaveLength(3);
  });

  test("the dialog guesses the rhythm, saves the choice, and the button turns filled", async () => {
    const data = layer();
    show(data);
    fireEvent.click((await screen.findAllByRole("button", { name: "Mark Example Insurance as recurring" }))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Mark Example Insurance as recurring?")).toBeTruthy();
    expect((within(dialog).getByLabelText("How often") as HTMLSelectElement).value).toBe("monthly");
    expect(dialog.textContent).toContain("Charges from Example Insurance on Rewards Card (0303) will count as one recurring charge.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as recurring" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Example Insurance is recurring" })).toHaveLength(2));
    expect(data.saved).toEqual([{ payeeKey: "example insurance", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Example Insurance" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a refused save keeps the dialog open with the server's words", async () => {
    show(layer({ saveRecurringChoice: async () => { throw new Error("Pick how often it repeats."); } }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Mark Example Insurance as recurring" }))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as recurring" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Pick how often it repeats.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  test("Cancel and Escape save nothing", async () => {
    const data = layer();
    show(data);
    fireEvent.click((await screen.findAllByRole("button", { name: "Mark Example Insurance as recurring" }))[0]);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: "Mark Example Insurance as recurring" })[0]);
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(data.saved).toEqual([]);
  });

  test("a row that is already recurring says so and links to the Recurring screen", async () => {
    show(layer());
    fireEvent.click((await screen.findAllByRole("button", { name: "Netflix is recurring" }))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Already recurring, every month.");
    expect(within(dialog).getByRole("link", { name: "Open Recurring" }).getAttribute("href")).toBe("#/recurring");
    expect(within(dialog).queryByRole("button", { name: "Mark as recurring" })).toBeNull();
  });
});

test("the dialog offers Only charges of about this amount, and ticking it saves the amount", async () => {
  const deps = layer();
  render(<TransactionsSection dataLayer={deps as never} initialFilter={ALL_TIME as never} asOfDate="2026-09-10" />);
  fireEvent.click((await screen.findAllByRole("button", { name: "Mark Example Insurance as recurring" }))[0]);
  const dialog = await screen.findByRole("dialog");
  const box = within(dialog).getByLabelText(/Only charges of about \$(18\.00|30\.00)/);
  fireEvent.click(box);
  fireEvent.click(within(dialog).getByRole("button", { name: "Mark as recurring" }));
  await waitFor(() => expect(deps.saved.length).toBe(1));
  expect(deps.saved[0]).toMatchObject({ payeeKey: "example insurance", accountId: "a1", choice: "recurring", amountCents: expect.any(Number) });
  expect([1800, 3000]).toContain(deps.saved[0].amountCents);
});
