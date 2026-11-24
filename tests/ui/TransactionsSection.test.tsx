// @vitest-environment jsdom
// tests/ui/TransactionsSection.test.tsx
//
// The screen. The filter engine is tested in tests/domain, so these cover the
// wiring: that the pipeline runs before display, that filters reach the engine,
// and that the two states which are not a list (loading, no server) render.
import { formatShortDate } from "../../src/domain/period";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TransactionsSection from "../../src/ui/TransactionsSection";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import { formatCents } from "../../src/domain/money";
import { customPeriod, type Period } from "../../src/domain/period";

// Every render pins the period, so no test depends on today's date.
const ALL_TIME: Period = { preset: "all", from: null, to: null };
const AUGUST = customPeriod("2026-08-01", "2026-08-31");

// AG Grid uses ResizeObserver, which jsdom does not implement.
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
  {
    id: "a1",
    name: "JOINT CHECKING (0101)",
    type: "depository",
    institution: null,
    currency: "USD",
    isOwned: true,
    includeInSpend: true,
    owner: "me",
  },
] as Account[];

const txns = [
  {
    sourceTransactionId: "a",
    accountId: "a1",
    date: "2026-09-01",
    amountCents: -1234,
    sourceCategory: "Groceries",
    merchant: null,
    isTransfer: false,
    sourceUpdatedAt: null,
    payee: "Whole Foods",
  },
  {
    sourceTransactionId: "b",
    accountId: "a1",
    date: "2026-08-20",
    amountCents: -99900,
    sourceCategory: null,
    merchant: null,
    isTransfer: false,
    sourceUpdatedAt: null,
    payee: "Mystery Charge",
  },
] as NormalizedTxn[];

const layer = (over: Record<string, unknown> = {}) => ({
  loadDb: async () => ({ base: "" }),
  getTransactions: async () => txns,
  getAccounts: async () => accounts,
  getRules: async () => [],
  getAdjustments: async () => [],
  getCategoryMappings: async () => ({}),
  getCategories: async () => ["Groceries", "Rent"],
  createCategory: vi.fn(async () => {}),
  // One call per filing, with Undo; notes.
  fileCategorization: vi.fn(async () => ({ id: 7 })),
  undoCategorization: vi.fn(async () => ({ undone: true })),
  getRecentCategorizations: async () => [],
  getNotes: async () => [],
  saveNote: vi.fn(async () => {}),
  getMaaserMarks: async () => [],
  saveMaaserMark: vi.fn(async () => {}),
  deleteMaaserMark: vi.fn(async () => {}),
  ...over,
});

/** What the one filing call carried: the rule and one-row change, the note, the mark. */
const filed = (l: ReturnType<typeof layer>) => (l.fileCategorization as ReturnType<typeof vi.fn>).mock.calls[0][1];

describe("TransactionsSection", () => {
  test("lists transactions with their resolved category", async () => {
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} />);
    expect(await screen.findByText("Whole Foods")).toBeTruthy();
    // The category dropdown also contains "Groceries", so target the row's cell
    // by its testid rather than a plain text query.
    expect(screen.getByTestId("txn-category-a").textContent).toBe("Groceries");
  });

  // Money rule: money out carries a minus sign;
  // red is kept for a real shortfall or overspend, which a purchase is not.
  test("amounts read -$12.34 in the plain color", async () => {
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} />);
    await screen.findByText("Whole Foods");
    const cells = [...document.querySelectorAll('[col-id="txn.amountCents"][role="gridcell"]')];
    expect(cells.map((c) => c.textContent)).toContain("-$12.34");
    for (const c of cells) expect(c.className).not.toMatch(/text-destructive/);
  });

  // Dates read "2026-09-30"; the account filter listed every account
  // twice, in two name styles.
  test("dates read as Sep 1, and the row names its account by the short name", async () => {
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} />);
    await screen.findByText("Whole Foods");
    const dates = [...document.querySelectorAll('[col-id="txn.date"][role="gridcell"]')].map((c) => c.textContent);
    expect(dates).toContain(formatShortDate("2026-09-01"));
    expect(dates).not.toContain("2026-09-01");
    const names = [...document.querySelectorAll('[col-id="accountName"][role="gridcell"]')].map((c) => c.textContent);
    expect(names).toContain("Joint Checking (0101)");
  });

  test("the account filter lists live accounts by short name, archived ones in their own group", async () => {
    const withArchived = [...accounts, { ...accounts[0], id: "old", name: "JOINT CHECKING (...0101)", archived: true }] as Account[];
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer({ getAccounts: async () => withArchived })} />);
    await screen.findByText("Whole Foods");
    const select = screen.getByLabelText("Account") as HTMLSelectElement;
    const live = [...select.querySelectorAll(":scope > option")].map((o) => o.textContent);
    expect(live).toEqual(["All accounts", "Joint Checking (0101)"]);
    const archived = select.querySelector('optgroup[label="Archived"]')!;
    expect([...archived.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Joint Checking (...0101)"]);
  });

  test("shows a row with no category as needing one", async () => {
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} />);
    expect(await screen.findByText("Mystery Charge")).toBeTruthy();
    expect(screen.getAllByText(/Uncategorized/).length).toBeGreaterThan(0);
  });

  test("searching narrows the list", async () => {
    const user = userEvent.setup();
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} />);
    await screen.findByText("Whole Foods");
    await user.type(screen.getByPlaceholderText(/search/i), "mystery");
    await waitFor(() => {
      expect(screen.queryByText("Whole Foods")).toBeNull();
      expect(screen.getByText("Mystery Charge")).toBeTruthy();
    });
  });

  test("the needs-a-category filter isolates those rows", async () => {
    const user = userEvent.setup();
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} />);
    await screen.findByText("Whole Foods");
    await user.click(screen.getByRole("button", { name: /needs a category/i }));
    await waitFor(() => {
      expect(screen.queryByText("Whole Foods")).toBeNull();
      expect(screen.getByText("Mystery Charge")).toBeTruthy();
    });
  });

  test("an initialFilter seeds the view, so the Dashboard can deep-link in", async () => {
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} initialFilter={{ needsCategory: true }} />);
    expect(await screen.findByText("Mystery Charge")).toBeTruthy();
    expect(screen.queryByText("Whole Foods")).toBeNull();
  });

  test("summarises what is currently shown, not the whole set", async () => {
    const user = userEvent.setup();
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} />);
    await screen.findByText("Whole Foods");
    expect(screen.getByTestId("txn-summary").textContent).toMatch(/2 transactions/);
    await user.type(screen.getByPlaceholderText(/search/i), "mystery");
    await waitFor(() => {
      expect(screen.getByTestId("txn-summary").textContent).toMatch(/1 transaction/);
    });
  });

  test("says so when the local server is unreachable, rather than showing an empty list", async () => {
    render(
      <TransactionsSection period={ALL_TIME}
        dataLayer={layer({
          loadDb: async () => {
            throw new Error("no server");
          },
        })}
      />
    );
    expect(await screen.findByText(/not connected/i)).toBeTruthy();
  });

  test("distinguishes an empty result from no data at all", async () => {
    const user = userEvent.setup();
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} />);
    await screen.findByText("Whole Foods");
    await user.type(screen.getByPlaceholderText(/search/i), "zzzznothing");
    await waitFor(() => {
      expect(screen.getByText(/no transactions match/i)).toBeTruthy();
    });
  });
});

describe("TransactionsSection recategorization", () => {
  // Opens the picker on a row and returns its search box (a
  // type-to-filter picker replaced the native select).
  const openPicker = async (user: ReturnType<typeof userEvent.setup>, id: string) => {
    await user.click(await screen.findByTestId(`txn-category-${id}`));
    return screen.getByRole("combobox", { name: "Category", hidden: false }) as HTMLInputElement;
  };
  const pick = async (user: ReturnType<typeof userEvent.setup>, box: HTMLInputElement, name: string) => {
    await user.type(box, name);
    await user.click(await screen.findByRole("option", { name }));
  };

  test("an uncategorized row writes a forward payee rule", async () => {
    // applyRules fills a BLANK category, so one rule fixes every row with this
    // payee, past and future. That is the review queue's behaviour, reused.
    const user = userEvent.setup();
    const l = layer();
    render(<TransactionsSection period={ALL_TIME} dataLayer={l} />);
    // Wait until the picker's own <select> is present, not the top filter bar's
    // "All categories" select which also has label "Category" (filter uses
    // aria-label). openPicker matches by role/name after the click.
    const select = await openPicker(user, "b");
    await pick(user, select, "Rent");

    await waitFor(() => expect(l.fileCategorization).toHaveBeenCalledTimes(1));
    expect(filed(l).rule).toMatchObject({
      priority: 100,
      payeeContains: "mystery charge",
      action: "categorize",
      toCategory: "Rent",
    });
    expect(filed(l).adjustment).toBeNull();
    expect(filed(l)).toMatchObject({ sourceTransactionId: "b", label: "Mystery Charge", fromCategory: "Uncategorized", toCategory: "Rent" });
  });

  test("an already-categorized row writes an id-matched adjustment, not a rule", async () => {
    // applyRules deliberately never overwrites an existing category, so a rule
    // here would silently do nothing. Adjustments run last and beat the rules.
    const user = userEvent.setup();
    const l = layer();
    render(<TransactionsSection period={ALL_TIME} dataLayer={l} />);
    const select = await openPicker(user, "a");
    await pick(user, select, "Rent");

    await waitFor(() => expect(l.fileCategorization).toHaveBeenCalledTimes(1));
    expect(filed(l).adjustment).toMatchObject({
      matchKind: "id",
      sourceTransactionId: "a",
      action: "recategorize",
      toCategory: "Rent",
    });
    expect(filed(l).rule).toBeNull();
    expect(filed(l)).toMatchObject({ fromCategory: "Groceries", toCategory: "Rent" });
  });

  test("'and everything like it' also writes the forward rule", async () => {
    const user = userEvent.setup();
    const l = layer();
    render(<TransactionsSection period={ALL_TIME} dataLayer={l} />);
    const select = await openPicker(user, "a");
    await user.click(screen.getByLabelText(/everything like it/i));
    await pick(user, select, "Rent");

    await waitFor(() => expect(l.fileCategorization).toHaveBeenCalledTimes(1));
    expect(filed(l).adjustment).not.toBeNull();
    expect(filed(l).rule).toMatchObject({ payeeContains: "whole foods", toCategory: "Rent" });
  });

  test("refuses to write a rule when there is no payee to key on", async () => {
    // A blank key matches every transaction. The row still takes an adjustment.
    const user = userEvent.setup();
    const l = layer({
      getTransactions: async () => [{ ...txns[1], payee: null, merchant: null }],
    });
    render(<TransactionsSection period={ALL_TIME} dataLayer={l} />);
    const select = await openPicker(user, "b");
    await pick(user, select, "Rent");

    await waitFor(() => expect(l.fileCategorization).toHaveBeenCalledTimes(1));
    expect(filed(l).rule).toBeNull();
    expect(filed(l).adjustment).toMatchObject({ sourceTransactionId: "b" });
  });

  test("marking a row a transfer records it as one", async () => {
    const user = userEvent.setup();
    const l = layer();
    render(<TransactionsSection period={ALL_TIME} dataLayer={l} />);
    await openPicker(user, "a");
    await user.click(await screen.findByRole("option", { name: "Transfer (not spending)" }));

    await waitFor(() => expect(l.fileCategorization).toHaveBeenCalledTimes(1));
    expect(filed(l).adjustment).toMatchObject({ matchKind: "id", sourceTransactionId: "a", action: "transfer" });
    expect(filed(l).toCategory).toBe("Transfer (not spending)");
    expect(filed(l)).not.toHaveProperty("recurring");
  });

  // Moved here from Settings, Bank connection, whose copy of the
  // review queue became a link to Transactions, Needs a category.
  test("an uncategorized row marked a transfer writes a transfer rule on its payee", async () => {
    const user = userEvent.setup();
    const l = layer();
    render(<TransactionsSection period={ALL_TIME} dataLayer={l} />);
    await openPicker(user, "b");
    await user.click(await screen.findByRole("option", { name: "Transfer (not spending)" }));

    await waitFor(() => expect(l.fileCategorization).toHaveBeenCalledTimes(1));
    expect(filed(l).rule).toMatchObject({ priority: 100, payeeContains: "mystery charge", action: "transfer" });
  });

  test("surfaces a failed write instead of silently losing it", async () => {
    const user = userEvent.setup();
    const l = layer({
      fileCategorization: vi.fn(async () => {
        throw new Error("db locked");
      }),
    });
    render(<TransactionsSection period={ALL_TIME} dataLayer={l} />);
    const select = await openPicker(user, "a");
    await pick(user, select, "Rent");
    expect(await screen.findByText(/db locked/)).toBeTruthy();
  });
});

describe("TransactionsSection with an initial category filter", () => {
  test("narrows the list on load", async () => {
    // Reports links here as #/transactions?category=Groceries. The router
    // strips the query from the tab; AppShell parses it and passes it as an
    // initialFilter category.
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} initialFilter={{ categories: ["Groceries"] }} />);
    expect(await screen.findByText("Whole Foods")).toBeTruthy();
    expect(screen.queryByText("Mystery Charge")).toBeNull();
  });
});

describe("TransactionsSection as a ledger", () => {
  const ledgerAccounts = [
    ...accounts,
    { ...accounts[0], id: "a3", name: "PARTNER CHECKING (0404)", includeInSpend: false },
  ] as Account[];
  const row = (over: Partial<NormalizedTxn>): NormalizedTxn =>
    ({
      sourceTransactionId: "x",
      accountId: "a1",
      date: "2026-08-10",
      amountCents: -100,
      sourceCategory: "Groceries",
      merchant: null,
      isTransfer: false,
      sourceUpdatedAt: null,
      ...over,
    }) as NormalizedTxn;
  const ledgerTxns = [
    row({ sourceTransactionId: "g2", date: "2026-08-20", amountCents: 2500, payee: "Refund Later" }),
    row({ sourceTransactionId: "g1", date: "2026-08-02", amountCents: -10000, payee: "Shop First" }),
    row({ sourceTransactionId: "g3", date: "2026-08-21", amountCents: -7000, payee: "Partner Groceries", accountId: "a3" }),
    row({ sourceTransactionId: "x1", date: "2026-08-22", amountCents: -3000, payee: "Moved Money", isTransfer: true }),
    row({ sourceTransactionId: "p1", date: "2026-08-25", amountCents: 500000, payee: "Payroll", sourceCategory: "Paychecks" }),
    row({ sourceTransactionId: "s1", date: "2026-09-01", amountCents: -4000, payee: "September Shop" }),
  ];
  const ledgerLayer = () =>
    layer({ getTransactions: async () => ledgerTxns, getAccounts: async () => ledgerAccounts });
  const groceriesAugust = {
    categories: ["Groceries"],
    kind: "expense" as const,
    from: "2026-08-01",
    to: "2026-08-31",
    countedAccountsOnly: true,
  };

  test("the header total is the figure that was clicked: refund netted, uncounted account and transfer left out", async () => {
    render(
      <TransactionsSection period={AUGUST}
        dataLayer={ledgerLayer()}
        initialFilter={groceriesAugust}
        ledger={{ label: "Groceries", back: "#/reports?tab=spending" }}
      />
    );
    const header = await screen.findByTestId("ledger-header");
    expect(header.textContent).toMatch(/Groceries/);
    expect(header.textContent).toMatch(/Aug 1 to Aug 31, 2026/);
    expect(header.textContent).toMatch(/2 transactions/);
    // $100.00 spent less a $25.00 refund. Not $100.00 (by sign), not $145.00
    // (with the account that is not counted), not $175.00 (with the transfer).
    expect(screen.getByTestId("ledger-total").textContent).toBe(formatCents(7500));
    expect(screen.queryByText("Partner Groceries")).toBeNull();
    expect(screen.queryByText("Moved Money")).toBeNull();
    expect(screen.queryByText("September Shop")).toBeNull();
  });

  test("reads oldest first with a running total that ends on the figure", async () => {
    render(
      <TransactionsSection period={AUGUST} dataLayer={ledgerLayer()} initialFilter={groceriesAugust} ledger={{ label: "Groceries", back: "#/reports" }} />
    );
    await screen.findByTestId("ledger-header");
    await waitFor(() => expect(document.querySelector('[row-index="0"]')).toBeTruthy());
    expect(document.querySelector('[row-index="0"]')?.textContent).toMatch(/Shop First/);
    expect(document.querySelector('[row-index="1"]')?.textContent).toMatch(/Refund Later/);
    expect(screen.getByText("Running total")).toBeTruthy();
    const running = [...document.querySelectorAll('[col-id="running"][role="gridcell"]')].map((c) => c.textContent);
    // Spending terms, so the last line is the header figure: $100.00, then $75.00 after the refund.
    expect(running).toEqual([formatCents(10000), formatCents(7500)]);
    expect(running.at(-1)).toBe(screen.getByTestId("ledger-total").textContent);
  });

  test("a ledger of both sides shows income, expense, and what was left over", async () => {
    render(
      <TransactionsSection period={AUGUST}
        dataLayer={ledgerLayer()}
        initialFilter={{ from: "2026-08-01", to: "2026-08-31", countedAccountsOnly: true }}
        ledger={{ label: "Net, August 2026", back: "#/reports?tab=cashflow" }}
      />
    );
    await screen.findByTestId("ledger-header");
    const total = screen.getByTestId("ledger-total").textContent ?? "";
    expect(total).toContain(`Income ${formatCents(500000)}`);
    expect(total).toContain(`Expense ${formatCents(7500)}`);
    // "Net" became "Left over" when saving became its own bucket: the figure
    // now subtracts what was put away, so the old name would have been a lie.
    // With no saving rows the arithmetic is unchanged.
    expect(total).toContain(`Left over ${formatCents(492500)}`);
    // Saving and investment income stay out of the header until there is
    // something in them, so an ordinary ledger reads as it always has.
    expect(total).not.toContain("Saved");
    expect(total).not.toContain("Investment income");
  });

  test("Back returns to the screen that linked here, and the full list is one click away", async () => {
    render(
      <TransactionsSection period={AUGUST} dataLayer={ledgerLayer()} initialFilter={groceriesAugust} ledger={{ label: "Groceries", back: "#/reports?tab=spending" }} />
    );
    await screen.findByTestId("ledger-header");
    expect(screen.getByRole("link", { name: /back/i }).getAttribute("href")).toBe("#/reports?tab=spending");
    expect(screen.getByRole("link", { name: /show all transactions/i }).getAttribute("href")).toBe("#/transactions");
  });

  test("without a ledger the screen is exactly as before: no header, no running total, newest first", async () => {
    render(<TransactionsSection period={ALL_TIME} dataLayer={ledgerLayer()} />);
    await screen.findByText("September Shop");
    expect(screen.queryByTestId("ledger-header")).toBeNull();
    expect(screen.queryByText("Running total")).toBeNull();
    // Accounts that are not counted are still listed on the plain screen.
    expect(screen.getByText("Partner Groceries")).toBeTruthy();
    expect(document.querySelector('[row-index="0"]')?.textContent).toMatch(/September Shop/);
  });
});

describe("TransactionsSection follows the period", () => {
  test("lists only what falls inside the period, inclusive at both ends", async () => {
    render(<TransactionsSection period={customPeriod("2026-08-20", "2026-08-31")} dataLayer={layer()} />);
    expect(await screen.findByText("Mystery Charge")).toBeTruthy(); // dated 2026-08-20, the first day
    expect(screen.queryByText("Whole Foods")).toBeNull(); // dated 2026-09-01
    expect(screen.getByTestId("txn-summary").textContent).toMatch(/1 transaction/);
  });

  test("the From and To boxes are gone: the top bar owns the dates now", async () => {
    render(<TransactionsSection period={ALL_TIME} dataLayer={layer()} />);
    await screen.findByText("Whole Foods");
    expect(screen.queryByLabelText("From")).toBeNull();
    expect(screen.queryByLabelText("To")).toBeNull();
  });

  test("changing the period re-filters what is already loaded, without fetching again", async () => {
    const getTransactions = vi.fn(async () => txns);
    const dataLayer = layer({ getTransactions });
    const { rerender } = render(<TransactionsSection period={ALL_TIME} dataLayer={dataLayer} />);
    await screen.findByText("Whole Foods");
    expect(screen.getByText("Mystery Charge")).toBeTruthy();

    rerender(<TransactionsSection period={customPeriod("2026-09-01", "2026-09-30")} dataLayer={dataLayer} />);
    await waitFor(() => expect(screen.queryByText("Mystery Charge")).toBeNull());
    expect(screen.getByText("Whole Foods")).toBeTruthy();
    expect(getTransactions).toHaveBeenCalledTimes(1);
  });

  test("other filters survive a period change", async () => {
    const user = userEvent.setup();
    const dataLayer = layer();
    const { rerender } = render(<TransactionsSection period={ALL_TIME} dataLayer={dataLayer} />);
    await screen.findByText("Whole Foods");
    await user.type(screen.getByPlaceholderText(/search/i), "mystery");
    await waitFor(() => expect(screen.queryByText("Whole Foods")).toBeNull());
    rerender(<TransactionsSection period={AUGUST} dataLayer={dataLayer} />);
    await waitFor(() => expect(screen.getByTestId("txn-summary").textContent).toMatch(/1 transaction/));
    expect((screen.getByPlaceholderText(/search/i) as HTMLInputElement).value).toBe("mystery");
  });
});

describe("TransactionsSection ledger for an average", () => {
  const t = (id: string, date: string, amountCents: number): NormalizedTxn =>
    ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null, payee: id }) as NormalizedTxn;
  const threeMonths = [t("jun", "2026-06-10", -10000), t("jul", "2026-07-10", -20000), t("aug", "2026-08-10", -40000)];

  test("shows the average as the figure, and says what total it came from", async () => {
    render(
      <TransactionsSection
        period={customPeriod("2026-06-01", "2026-08-31")}
        dataLayer={layer({ getTransactions: async () => threeMonths })}
        initialFilter={{ categories: ["Groceries"], kind: "expense", countedAccountsOnly: true }}
        ledger={{ label: "Groceries", back: "#/reports", divideBy: 3 }}
      />
    );
    await screen.findByTestId("ledger-header");
    // $700.00 over 3 months is $233.33, rounded to the cent.
    expect(screen.getByTestId("ledger-total").textContent).toBe(formatCents(23333));
    expect(screen.getByTestId("ledger-average-note").textContent).toBe(`${formatCents(70000)} in total, divided by 3 months`);
  });

  test("an ordinary ledger has no such note", async () => {
    render(
      <TransactionsSection
        period={customPeriod("2026-06-01", "2026-08-31")}
        dataLayer={layer({ getTransactions: async () => threeMonths })}
        initialFilter={{ categories: ["Groceries"], kind: "expense", countedAccountsOnly: true }}
        ledger={{ label: "Groceries", back: "#/reports" }}
      />
    );
    await screen.findByTestId("ledger-header");
    expect(screen.getByTestId("ledger-total").textContent).toBe(formatCents(70000));
    expect(screen.queryByTestId("ledger-average-note")).toBeNull();
  });
});

describe("TransactionsSection ledgers that are not a category total", () => {
  test("a series ledger before the first payment shows zero payments instead of NaN", async () => {
    render(
      <TransactionsSection
        period={customPeriod("2000-01-01", "2000-01-01")}
        dataLayer={layer({ getTransactions: async () => [row("p1", "2026-08-05", -1599, { payee: "Netflix" })] })}
        initialFilter={{ accountIds: ["a1"], payeeKey: "netflix" }}
        ledger={{ label: "Netflix", back: "#/bills", view: "series" }}
      />
    );
    await screen.findByTestId("ledger-header");
    expect(screen.getByTestId("ledger-total").textContent).toBe("0 payments");
  });

  const row = (id: string, date: string, amountCents: number, over: Partial<NormalizedTxn> = {}): NormalizedTxn =>
    ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null, payee: id, ...over }) as NormalizedTxn;
  const activity = [
    row("paid-in", "2026-08-01", 500000, { sourceCategory: "Paychecks" }),
    row("spent", "2026-08-05", -30000),
    row("moved-out", "2026-08-10", -100000, { isTransfer: true }),
  ];

  test("an account's activity reads as money in and money out, counts transfers, and says it is not the balance", async () => {
    render(
      <TransactionsSection
        period={AUGUST}
        dataLayer={layer({ getTransactions: async () => activity })}
        initialFilter={{ accountIds: ["a1"], transfers: "include" }}
        ledger={{ label: "JOINT CHECKING (0101)", back: "#/accounts", view: "account" }}
      />
    );
    const header = await screen.findByTestId("ledger-header");
    expect(header.textContent).toMatch(/3 transactions/);
    expect(screen.getByTestId("ledger-total").textContent).toBe(`In ${formatCents(500000)} \u00b7 Out ${formatCents(130000)}`);
    expect(screen.getByTestId("ledger-note").textContent).toBe("Activity in this account over these dates, transfers included. This is not the balance.");
    await waitFor(() => expect(document.querySelectorAll('[col-id="running"][role="gridcell"]').length).toBe(3));
    const running = [...document.querySelectorAll('[col-id="running"][role="gridcell"]')].map((c) => c.textContent);
    // The transfer moves this account's money like anything else, so it counts here.
    expect(running).toEqual([formatCents(500000), formatCents(470000), formatCents(370000)]);
  });

  test("a recurring series reads as its payments, with their typical amount, and claims no total", async () => {
    const payments = [row("p1", "2026-06-05", -1599, { payee: "Netflix" }), row("p2", "2026-07-05", -1599, { payee: "Netflix" }), row("p3", "2026-08-05", -1799, { payee: "Netflix" })];
    render(
      <TransactionsSection
        period={ALL_TIME}
        dataLayer={layer({ getTransactions: async () => payments })}
        initialFilter={{ accountIds: ["a1"], payeeKey: "netflix" }}
        ledger={{ label: "Netflix", back: "#/bills", view: "series" }}
      />
    );
    await screen.findByTestId("ledger-header");
    expect(screen.getByTestId("ledger-total").textContent).toBe(`3 payments \u00b7 usual ${formatCents(1599)}`);
    expect(screen.getByTestId("ledger-note").textContent).toBe("The payments in this recurring charge. Recurring shows the usual amount, the middle of the last 3, not a total.");
  });

  // Same-day payments are ordered by id, as the finder orders
  // them, so the header's usual amount (last 3: b, c, d -> $3.00) matches the Recurring screen's.
  test("same-day payments give the same usual amount as the Recurring screen", async () => {
    const sameDay = ["a", "b", "c", "d"].map((id, i) => row(id, "2026-10-01", -(i + 1) * 100, { payee: "Netflix" }));
    render(
      <TransactionsSection
        period={ALL_TIME}
        dataLayer={layer({ getTransactions: async () => sameDay })}
        initialFilter={{ accountIds: ["a1"], payeeKey: "netflix" }}
        ledger={{ label: "Netflix", back: "#/recurring", view: "series" }}
      />
    );
    await screen.findByTestId("ledger-header");
    expect(screen.getByTestId("ledger-total").textContent).toBe(`4 payments · usual ${formatCents(300)}`);
  });
});

// Reports shows a spending category's purchases and the
// refunds on separate lines, so a ledger can list one direction. Its header says so.
describe("TransactionsSection ledger of one direction", () => {
  const row = (id: string, amountCents: number): NormalizedTxn =>
    ({ sourceTransactionId: id, accountId: "a1", date: "2026-08-10", amountCents, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null, payee: id }) as NormalizedTxn;
  const both = [row("bought", -102000), row("came-back", 2500)];

  test("refunds and credits only: the money that came back, and a note saying so", async () => {
    render(
      <TransactionsSection
        period={AUGUST}
        dataLayer={layer({ getTransactions: async () => both })}
        initialFilter={{ kind: "expense", flow: "in", countedAccountsOnly: true }}
        ledger={{ label: "Refunds and credits", back: "#/reports" }}
      />
    );
    await screen.findByTestId("ledger-header");
    expect(screen.getByTestId("ledger-total").textContent).toBe(formatCents(-2500));
    expect(screen.getByTestId("ledger-note").textContent).toBe("Money that came back on spending categories only. Counted accounts only. Transfers between your accounts are left out.");
  });

  test("purchases only: a category's spending before refunds", async () => {
    render(
      <TransactionsSection
        period={AUGUST}
        dataLayer={layer({ getTransactions: async () => both })}
        initialFilter={{ categories: ["Groceries"], kind: "expense", flow: "out", countedAccountsOnly: true }}
        ledger={{ label: "Groceries", back: "#/reports" }}
      />
    );
    await screen.findByTestId("ledger-header");
    expect(screen.getByTestId("ledger-total").textContent).toBe(formatCents(102000));
    expect(screen.getByTestId("ledger-note").textContent).toBe("Purchases only; refunds and credits are on their own line in Reports. Counted accounts only. Transfers between your accounts are left out.");
  });
});

// Type to filter the list, or add a new category, on every screen
// that asks. A new name is recorded first (so every list knows it), then applied
// the way any category is, and the "everything like it" switch is there for it.
describe("TransactionsSection picker: a new category", () => {
  const openPicker = async (user: ReturnType<typeof userEvent.setup>, id: string) => {
    await user.click(await screen.findByTestId(`txn-category-${id}`));
    return screen.getByRole("combobox", { name: "Category", hidden: false }) as HTMLInputElement;
  };

  test("typing a name no category has offers Create; choosing it records the name, then applies it", async () => {
    const user = userEvent.setup();
    const l = layer();
    render(<TransactionsSection period={ALL_TIME} dataLayer={l} />);
    const box = await openPicker(user, "a");
    expect(screen.getByLabelText(/everything like it/i)).toBeTruthy(); // the option is on offer
    await user.type(box, "Kids");
    await user.click(await screen.findByRole("option", { name: 'Create "Kids"' }));

    await waitFor(() => expect(l.fileCategorization).toHaveBeenCalled());
    expect(l.createCategory).toHaveBeenCalledWith(expect.anything(), "Kids");
    const created = (l.createCategory as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const applied = (l.fileCategorization as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(created).toBeLessThan(applied);
    expect(filed(l).adjustment).toMatchObject({ action: "recategorize", toCategory: "Kids" });
  });

  test("an existing category typed in another case is picked, not created twice", async () => {
    const user = userEvent.setup();
    const l = layer();
    render(<TransactionsSection period={ALL_TIME} dataLayer={l} />);
    const box = await openPicker(user, "a");
    await user.type(box, "rent");
    expect(screen.queryByRole("option", { name: /^Create/ })).toBeNull();
    await user.click(await screen.findByRole("option", { name: "Rent" }));
    await waitFor(() => expect(l.fileCategorization).toHaveBeenCalled());
    expect(l.createCategory).not.toHaveBeenCalled();
  });
});

describe("the charity pot column", () => {
  test("a control on a Charity row and nothing on an ordinary row", async () => {
    const charity = { ...txns[0], sourceTransactionId: "c", sourceCategory: "Charity" } as NormalizedTxn;
    const l = layer({ getTransactions: async () => [charity, txns[0]] });
    render(<TransactionsSection dataLayer={l} period={ALL_TIME} />);
    await screen.findAllByText("Whole Foods", { exact: false });
    expect(screen.getAllByRole("switch", { name: "Counts toward Charity" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("switch", { name: "Counts toward Charity" }));
    expect(l.saveMaaserMark).toHaveBeenCalledWith(expect.anything(), { sourceTransactionId: "c", kind: "not_maaser", countedCents: null });
  });
});

describe("a charity figure's ledger", () => {
  test("lists only the rows behind the figure, with in and out and no running total", async () => {
    const charity = { ...txns[0], sourceTransactionId: "c", sourceCategory: "Charity", payee: "A Charity", amountCents: -5000 } as NormalizedTxn;
    const l = layer({ getTransactions: async () => [charity, txns[0]] });
    render(
      <TransactionsSection
        dataLayer={l}
        period={ALL_TIME}
        ledger={{ label: "Given, from your cards and checking", back: "#/budget/month", view: "maaser" }}
        initialFilter={{ maaser: ["givenCards"], transfers: "include" }}
      />,
    );
    expect(await screen.findByText("A Charity")).toBeTruthy();
    expect(screen.queryByText("Whole Foods")).toBeNull();
    expect(screen.getByTestId("ledger-total").textContent).toBe(`In ${formatCents(0)} · Out ${formatCents(5000)}`);
    expect(screen.getByTestId("ledger-note").textContent).toContain("The rows behind this figure on the charity pot's ledger.");
    expect(screen.queryByRole("columnheader", { name: "Running total" })).toBeNull();
  });
});
