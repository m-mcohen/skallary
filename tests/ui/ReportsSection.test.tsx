// @vitest-environment jsdom
// tests/ui/ReportsSection.test.tsx
//
// Charts are hard to assert on. What is assertable is that the three tabs
// exist, that the same tab renders the same numbers we saw in the domain
// tests, and that a click-through builds the right hash for the Transactions
// screen to receive.
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportsSection from "../../src/ui/ReportsSection";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import { formatCents } from "../../src/domain/money";
import { prepareTransactions } from "../../src/domain/pipeline";
import { EMPTY_FILTER, filterRows, ledgerTotal, toRows } from "../../src/domain/transactions-view";
import { parseLedgerQuery } from "../../src/ui/lib/ledger-link";
import { customPeriod, type Period } from "../../src/domain/period";
import { configurePeriodStore, getCompare } from "../../src/ui/lib/period-store";

// Every render pins the period. A test that leaned on the default (the last 12
// months from the real today) would start failing a year after its fixture dates.
const ALL_TIME: Period = { preset: "all", from: null, to: null };

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = ResizeObserverStub;
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const accounts = [
  {
    id: "a1",
    name: "JOINT",
    type: "depository",
    institution: null,
    currency: "USD",
    isOwned: true,
    includeInSpend: true,
    owner: "me",
  },
] as Account[];

const txns = [
  { sourceTransactionId: "r1", accountId: "a1", date: "2026-07-05", amountCents: -30000, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null },
  { sourceTransactionId: "r2", accountId: "a1", date: "2026-07-15", amountCents: 800000, sourceCategory: "Paychecks", merchant: null, isTransfer: false, sourceUpdatedAt: null },
  { sourceTransactionId: "r3", accountId: "a1", date: "2026-08-05", amountCents: -45000, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null },
] as NormalizedTxn[];

const layer = () => ({
  loadDb: async () => ({ base: "" }),
  getTransactions: async () => txns,
  getAccounts: async () => accounts,
  getRules: async () => [],
  getAdjustments: async () => [],
  getCategoryMappings: async () => ({}),
});

test("a new tab in the link updates Reports without remounting", async () => {
  window.history.replaceState(null, "", "#/reports?period=all&tab=spending");
  render(<ReportsSection period={ALL_TIME} compare="none" dataLayer={layer()} />);
  await screen.findByTestId("report-total-Groceries");
  window.history.replaceState(null, "", "#/reports?period=all&tab=income");
  fireEvent(window, new HashChangeEvent("hashchange"));
  expect((await screen.findByTestId("report-total-Paychecks")).textContent).toBe("$8,000.00");
  expect(screen.queryByTestId("report-total-Groceries")).toBeNull();
});

test.each(["tab", "ledger"])("a bookmarked comparison survives a %s link", async (destination) => {
  window.localStorage.clear();
  configurePeriodStore({ asOf: () => "2026-09-20" });
  window.history.replaceState(null, "", "#/reports?period=last-month&compare=previous");
  render(<ReportsSection dataLayer={layer()} />);
  const category = await screen.findByTestId("report-link-Groceries");
  if (destination === "tab") {
    await userEvent.setup().click(screen.getByRole("tab", { name: "Income" }));
    expect(new URLSearchParams(window.location.hash.split("?")[1]).get("compare")).toBe("previous");
    expect(getCompare()).toBe("previous");
  } else {
    const parsed = parseLedgerQuery(new URLSearchParams(category.getAttribute("href")!.split("?")[1]));
    expect(new URLSearchParams(parsed.ledger!.back.split("?")[1]).get("compare")).toBe("previous");
  }
});

describe("ReportsSection", () => {
  test("defaults to spending and shows the top category with its total", async () => {
    render(<ReportsSection dataLayer={layer()} period={ALL_TIME} compare="none" />);
    await waitFor(() => {
      // The spending table lists categories with their totals; Groceries is
      // the only expense category in the fixture and totals $750.00.
      expect(screen.getByTestId("report-total-Groceries").textContent).toMatch(/750\.00/);
    });
  });

  test("switching to Income hides expense categories", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={ALL_TIME} compare="none" />);
    await screen.findByTestId("report-total-Groceries");
    await user.click(screen.getByRole("tab", { name: /^Income$/ }));
    await waitFor(() => {
      expect(screen.queryByTestId("report-total-Groceries")).toBeNull();
      expect(screen.getByTestId("report-total-Paychecks").textContent).toMatch(/8,000\.00/);
    });
  });

  // A partial month shows its ending day in tables and monthly charts.
  test("a month the period ends inside says the day it runs through", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={{ preset: "custom", from: "2026-06-01", to: "2026-07-15" }} compare="none" />);
    await screen.findByTestId("report-total-Groceries");
    expect(screen.getAllByText("Jul 2026 (through Jul 15)").length).toBeGreaterThan(0);
    // 45 days draw by week; the note under the chart is for a chart by month.
    await user.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getAllByText(/Jul 2026 runs through Jul 15\./).length).toBeGreaterThan(0);
    expect(screen.queryByText("Jun 2026 (through Jun 30)")).toBeNull();
    await user.click(screen.getByRole("tab", { name: /Cash flow/ }));
    await waitFor(() => expect(screen.getByTestId("cashflow-2026-07").textContent).toContain("Jul 2026 (through Jul 15)"));
  });

  test("Cash flow shows income, expense, and net per month, with net matching to the cent", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={ALL_TIME} compare="none" />);
    await screen.findByTestId("report-total-Groceries");
    await user.click(screen.getByRole("tab", { name: /Cash flow/ }));
    await waitFor(() => {
      const row = screen.getByTestId("cashflow-2026-07");
      expect(row.textContent).toMatch(/8,000\.00/);
      expect(row.textContent).toMatch(/300\.00/);
      expect(row.textContent).toMatch(/7,700\.00/);
    });
    // Spending keeps its neutral tone.
    expect(screen.getByTestId("cashflow-2026-07-expense").className).not.toMatch(/text-destructive/);
  });

  test("months read Jul 2026, not 2026-07, in the Spending header and the Cash flow rows", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={ALL_TIME} compare="none" />);
    await screen.findByTestId("report-total-Groceries");
    expect(screen.getByRole("columnheader", { name: "Jul 2026" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "2026-07" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: /Cash flow/ }));
    const row = await screen.findByTestId("cashflow-2026-07");
    expect(row.querySelector("td")!.textContent).toBe("Jul 2026");
  });

  test("clicking a category row links into Transactions as a ledger of that category", async () => {
    render(<ReportsSection dataLayer={layer()} period={ALL_TIME} compare="none" />);
    const link = await screen.findByTestId("report-link-Groceries");
    const parsed = parseLedgerQuery(new URLSearchParams(link.getAttribute("href")!.split("?")[1]));
    // Spending links include purchases only.
    expect(parsed.initialFilter).toEqual({ categories: ["Groceries"], kind: "expense", flow: "out", countedAccountsOnly: true });
    expect(parsed.ledger).toEqual({ label: "Groceries", back: "#/reports?tab=spending&period=all" });
  });
});

// The rule this screen is held to: a figure you can click equals the total of
// the ledger it opens, to the cent. So the test does what a person would do:
// it follows EVERY link in every table and adds up what it lands on.
describe("ReportsSection click-through ties out", () => {
  const tieAccounts = [
    ...accounts,
    { ...accounts[0], id: "a9", name: "NOT COUNTED", includeInSpend: false },
  ] as Account[];
  const t = (id: string, date: string, amountCents: number, sourceCategory: string, over: Partial<NormalizedTxn> = {}) =>
    ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over }) as NormalizedTxn;
  // Eleven spending categories, so three fold into "Other" (the chart keeps eight).
  const SPENDING = ["Rent", "Groceries", "Dining", "Utilities", "Gas", "Insurance", "Kids", "Travel", "Gifts & Giving", "Pets", "Hobbies"];
  const tieTxns: NormalizedTxn[] = [
    ...SPENDING.flatMap((category, i) => [
      t(`jul-${i}`, "2026-07-10", -(120000 - i * 9000), category),
      t(`aug-${i}`, "2026-08-31", -(110000 - i * 8000), category),
    ]),
    t("refund", "2026-08-12", 2500, "Groceries"),
    t("uncounted", "2026-08-13", -77700, "Groceries", { accountId: "a9" }),
    t("transfer", "2026-08-14", -55500, "Groceries", { isTransfer: true }),
    t("pay-jul", "2026-07-01", 900000, "Paychecks"),
    t("pay-aug", "2026-08-01", 900000, "Paychecks"),
    t("side", "2026-08-20", 45000, "Other Income"),
    t("only-july", "2026-07-20", -3300, "Hobbies"),
  ];
  const tieLayer = () => ({ ...layer(), getTransactions: async () => tieTxns, getAccounts: async () => tieAccounts });
  const allRows = toRows(prepareTransactions(tieTxns, { rules: [], adjustments: [] }), tieAccounts, {});

  /** Follow one link the way Transactions would, and say what it should read. */
  function landedTotal(link: Element): string {
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("#/transactions?"), href).toBe(true);
    const parsed = parseLedgerQuery(new URLSearchParams(href.slice(href.indexOf("?") + 1)));
    expect(parsed.ledger, href).not.toBeNull();
    expect(parsed.initialFilter.countedAccountsOnly, href).toBe(true);
    const total = ledgerTotal(filterRows(allRows, { ...EMPTY_FILTER, ...parsed.initialFilter }));
    const kind = parsed.initialFilter.kind ?? null;
    return formatCents(kind === "expense" ? total.expenseCents : kind === "income" ? total.incomeCents : total.netCents);
  }

  /** "($1,234.00)" on the cash-flow tab is $1,234.00 of expense. */
  const shown = (link: Element) => (link.textContent ?? "").replace(/[()]/g, "").trim();

  function checkEveryLink(minimum: number) {
    const links = [...document.querySelectorAll("table a[data-ledger]")];
    expect(links.length).toBeGreaterThanOrEqual(minimum);
    for (const link of links) {
      // The category name is a link to the same ledger as its Total, so its
      // text is a name, not money; every other link's text is the figure.
      if (link.getAttribute("data-testid")?.startsWith("report-link-")) continue;
      expect(shown(link), link.getAttribute("href") ?? "").toBe(landedTotal(link));
    }
    return links;
  }

  test("Spending: every cell, category total, the Other row, and the bottom totals", async () => {
    render(<ReportsSection dataLayer={tieLayer()} period={ALL_TIME} compare="none" />);
    await screen.findByTestId("report-total-Rent");
    // 9 rows (8 + Other) x (2 months + total) + 3 bottom totals = 30 figures, plus 8 name links.
    const links = checkEveryLink(30);

    // The total nets the separate refund and excludes the uncounted account
    // and transfer, just as the linked ledger does.
    expect(screen.getByTestId("cell-Groceries-2026-08").textContent).toBe(formatCents(102000));
    expect(screen.getByTestId("cell-Refunds and credits-2026-08").textContent).toBe(formatCents(-2500));

    // Other folds three categories, and its link must carry all three.
    const otherLink = screen.getByTestId("report-total-Other").querySelector("a[data-ledger]")!;
    const parsedOther = parseLedgerQuery(new URLSearchParams(otherLink.getAttribute("href")!.split("?")[1]));
    expect([...(parsedOther.initialFilter.categories ?? [])].sort()).toEqual(["Gifts & Giving", "Hobbies", "Pets"]);
    expect(parsedOther.ledger?.label).toBe("Other (3 categories)");

    expect(links.every((l) => (l.getAttribute("href") ?? "").includes("back=%23%2Freports%3Ftab%3Dspending%26period%3Dall"))).toBe(true);
  });

  test("a category name opens the same ledger as its Total, not the old link that did not tie out", async () => {
    render(<ReportsSection dataLayer={tieLayer()} period={ALL_TIME} compare="none" />);
    const name = await screen.findByTestId("report-link-Groceries");
    const total = screen.getByTestId("report-total-Groceries").querySelector("a[data-ledger]")!;
    expect(name.getAttribute("href")).toBe(total.getAttribute("href"));
    expect(landedTotal(name)).toBe(shown(total));
  });

  test("a zero is plain text, because there is nothing behind it to open", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={ALL_TIME} compare="none" />);
    await screen.findByTestId("report-total-Groceries");
    await user.click(screen.getByRole("tab", { name: /^Income$/ }));
    // Paychecks has July income and nothing in August.
    const empty = await screen.findByTestId("cell-Paychecks-2026-08");
    expect(empty.textContent).toBe(formatCents(0));
    expect(empty.querySelector("a")).toBeNull();
  });

  test("Income: every figure", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={tieLayer()} period={ALL_TIME} compare="none" />);
    await screen.findByTestId("report-total-Rent");
    await user.click(screen.getByRole("tab", { name: /^Income$/ }));
    await screen.findByTestId("report-total-Paychecks");
    const links = checkEveryLink(8);
    expect(links.every((l) => (l.getAttribute("href") ?? "").includes("tab%3Dincome"))).toBe(true);
  });

  test("Cash flow: income, investment income, expense, saved and left over for every month", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={tieLayer()} period={ALL_TIME} compare="none" />);
    await screen.findByTestId("report-total-Rent");
    await user.click(screen.getByRole("tab", { name: /Cash flow/ }));
    await screen.findByTestId("cashflow-2026-08");
    // A zero figure is not a link, and this fixture has no saving or investment
    // income, so the count is unchanged. The saving column has its own test.
    checkEveryLink(6);
    const leftOver = screen.getByTestId("cashflow-2026-08-left-over").querySelector("a[data-ledger]")!;
    const parsedLeftOver = parseLedgerQuery(new URLSearchParams(leftOver.getAttribute("href")!.split("?")[1]));
    expect(parsedLeftOver.initialFilter.kind).toBeUndefined();
    expect(parsedLeftOver.initialFilter).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
  });

  test("the open tab lives in the link, so Back from a ledger returns to it", async () => {
    window.location.hash = "#/reports?tab=cashflow";
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={tieLayer()} period={ALL_TIME} compare="none" />);
    expect(await screen.findByTestId("cashflow-2026-08")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /^Income$/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/reports?tab=income&period=all"));
  });
});

// The period adds one new way for a figure and its ledger to disagree: a month
// column cut short by the period. Its ledger has to be cut at the same day.
describe("ReportsSection under a period", () => {
  const t = (id: string, date: string, amountCents: number, sourceCategory: string) =>
    ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null }) as NormalizedTxn;
  const periodTxns: NormalizedTxn[] = [
    t("jun", "2026-06-10", -11100, "Groceries"),
    t("jul-early", "2026-07-03", -20000, "Groceries"),
    t("jul-late", "2026-07-28", -30000, "Groceries"),
    t("aug-early", "2026-08-05", -40000, "Groceries"),
    t("aug-late", "2026-08-25", -50000, "Groceries"),
    t("rent-jul", "2026-07-01", -150000, "Rent"),
    t("rent-aug", "2026-08-01", -150000, "Rent"),
    t("pay-jul", "2026-07-15", 800000, "Paychecks"),
    t("pay-aug", "2026-08-15", 800000, "Paychecks"),
  ];
  const periodLayer = () => ({ ...layer(), getTransactions: async () => periodTxns });
  const allRows = toRows(prepareTransactions(periodTxns, { rules: [], adjustments: [] }), accounts, {});
  // Starts after June, and ends in the MIDDLE of August.
  const cut = customPeriod("2026-07-01", "2026-08-15");

  const landed = (link: Element) => {
    const href = link.getAttribute("href") ?? "";
    const parsed = parseLedgerQuery(new URLSearchParams(href.slice(href.indexOf("?") + 1)));
    const total = ledgerTotal(filterRows(allRows, { ...EMPTY_FILTER, ...parsed.initialFilter }));
    const kind = parsed.initialFilter.kind ?? null;
    return { parsed, text: formatCents(kind === "expense" ? total.expenseCents : kind === "income" ? total.incomeCents : total.netCents) };
  };
  const shown = (link: Element) => (link.textContent ?? "").replace(/[()]/g, "").trim();
  const moneyLinks = () =>
    [...document.querySelectorAll("table a[data-ledger]")].filter((l) => !l.getAttribute("data-testid")?.startsWith("report-link-"));

  test("figures cover only the period: June is gone and August stops at the 15th", async () => {
    render(<ReportsSection dataLayer={periodLayer()} period={cut} compare="none" />);
    await screen.findByTestId("report-total-Groceries");
    expect(screen.queryByTestId("cell-Groceries-2026-06")).toBeNull();
    expect(screen.getByTestId("cell-Groceries-2026-07").textContent).toBe(formatCents(50000));
    expect(screen.getByTestId("cell-Groceries-2026-08").textContent).toBe(formatCents(40000)); // not $900.00
    expect(screen.getByTestId("report-total-Groceries").textContent).toBe(formatCents(90000)); // not $1,511.00
  });

  test("every link still ties out, and a month cut short links to a ledger cut at the same day", async () => {
    render(<ReportsSection dataLayer={periodLayer()} period={cut} compare="none" />);
    await screen.findByTestId("report-total-Groceries");
    const links = moneyLinks();
    expect(links.length).toBeGreaterThanOrEqual(9);
    for (const link of links) expect(shown(link), link.getAttribute("href") ?? "").toBe(landed(link).text);

    const august = landed(screen.getByTestId("cell-Groceries-2026-08").querySelector("a")!).parsed.initialFilter;
    expect(august).toMatchObject({ from: "2026-08-01", to: "2026-08-15" });
    const total = landed(screen.getByTestId("report-total-Groceries").querySelector("a")!).parsed.initialFilter;
    expect(total).toMatchObject({ from: "2026-07-01", to: "2026-08-15" });
    const grand = landed(screen.getByTestId("report-grand-total").querySelector("a")!).parsed.initialFilter;
    expect(grand).toMatchObject({ from: "2026-07-01", to: "2026-08-15" });
  });

  test("cash flow ties out under the same cut", async () => {
    window.location.hash = "#/reports?tab=cashflow";
    render(<ReportsSection dataLayer={periodLayer()} period={cut} compare="none" />);
    await screen.findByTestId("cashflow-2026-08");
    // The August paycheck lands on the 15th, the last day of the period: inclusive, so it counts.
    expect(screen.getByTestId("cashflow-2026-08-income").textContent).toBe(formatCents(800000));
    for (const link of moneyLinks()) expect(shown(link), link.getAttribute("href") ?? "").toBe(landed(link).text);
  });

  test("Back carries the tab AND the period, and a ledger is labeled by what it is, not by a month", async () => {
    render(<ReportsSection dataLayer={periodLayer()} period={cut} compare="none" />);
    await screen.findByTestId("report-total-Groceries");
    const { parsed } = landed(screen.getByTestId("cell-Groceries-2026-08").querySelector("a")!);
    expect(parsed.ledger).toEqual({ label: "Groceries", back: "#/reports?tab=spending&from=2026-07-01&to=2026-08-15" });
  });

  test("a preset period rides in the link by name; all time links carry no dates", async () => {
    const preset = { preset: "last-3" as const, from: "2026-07-01", to: "2026-08-31" };
    const { unmount } = render(<ReportsSection dataLayer={periodLayer()} period={preset} compare="none" />);
    await screen.findByTestId("report-total-Groceries");
    expect(landed(screen.getByTestId("report-total-Groceries").querySelector("a")!).parsed.ledger?.back).toBe("#/reports?tab=spending&period=last-3");
    unmount();

    render(<ReportsSection dataLayer={periodLayer()} period={ALL_TIME} compare="none" />);
    await screen.findByTestId("report-total-Groceries");
    expect(screen.getByTestId("cell-Groceries-2026-06").textContent).toBe(formatCents(11100));
    const all = landed(screen.getByTestId("report-total-Groceries").querySelector("a")!).parsed.initialFilter;
    expect(all.from).toBeUndefined();
    expect(all.to).toBeUndefined();
  });
});

// An unfinished month compares the same days in each period.
// Spending after the comparison cut-off stays outside the baseline.
describe("ReportsSection comparisons", () => {
  const t = (id: string, date: string, amountCents: number, sourceCategory: string) =>
    ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null }) as NormalizedTxn;
  const cmpTxns: NormalizedTxn[] = [
    t("old", "2025-06-01", -100, "Groceries"), // history reaches back far enough for every comparison
    t("g-may", "2026-05-10", -30000, "Groceries"),
    t("g-jun", "2026-06-10", -10000, "Groceries"),
    t("g-jul", "2026-07-10", -20000, "Groceries"),
    t("g-aug-a", "2026-08-05", -30000, "Groceries"),
    t("g-aug-b", "2026-08-20", -10000, "Groceries"), // the 20th is inside "through the 20th"
    t("g-aug-c", "2026-08-21", -99900, "Groceries"), // the 21st is not
    t("g-sep", "2026-09-10", -50000, "Groceries"),
    t("r-aug", "2026-08-01", -150000, "Rent"),
    t("r-sep", "2026-09-01", -150000, "Rent"),
    t("d-sep", "2026-09-05", -8000, "Dining"), // nothing in the baseline: percent is not applicable
    t("p-aug", "2026-08-15", 800000, "Paychecks"),
    t("p-sep", "2026-09-15", 700000, "Paychecks"),
  ];
  const cmpLayer = () => ({ ...layer(), getTransactions: async () => cmpTxns });
  const allRows = toRows(prepareTransactions(cmpTxns, { rules: [], adjustments: [] }), accounts, {});
  const thisMonth: Period = { preset: "this-month", from: "2026-09-01", to: "2026-09-20" };
  const text = (id: string) => screen.getByTestId(id).textContent;

  test("baseline, change, and change percent, on the same days only", async () => {
    render(<ReportsSection dataLayer={cmpLayer()} period={thisMonth} compare="previous" />);
    await screen.findByTestId("report-total-Groceries");
    expect(text("compare-caption")).toBe("Sep 1 to Sep 20, 2026 compared with Aug 1 to Aug 20, 2026.");

    expect(text("report-total-Groceries")).toBe(formatCents(50000));
    expect(text("baseline-Groceries")).toBe(formatCents(40000)); // not $1,399.00
    expect(text("change-Groceries")).toBe("+$100.00");
    expect(text("changepct-Groceries")).toBe("+25.0%");

    expect(text("baseline-Rent")).toBe(formatCents(150000));
    expect(text("change-Rent")).toBe("$0.00");
    expect(text("changepct-Rent")).toBe("0.0%");

    // A new category: dollars always show, percent of nothing does not.
    expect(text("baseline-Dining")).toBe(formatCents(0));
    expect(text("change-Dining")).toBe("+$80.00");
    expect(text("changepct-Dining")).toBe("n/a");

    expect(text("report-grand-total")).toBe(formatCents(208000));
    expect(text("baseline-total")).toBe(formatCents(190000));
    expect(text("change-total")).toBe("+$180.00");
    expect(text("changepct-total")).toBe("+9.5%");
  });

  test("more spending is marked unfavorable, less income is too, and the mark is in words as well as color", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={cmpLayer()} period={thisMonth} compare="previous" />);
    await screen.findByTestId("report-total-Groceries");
    expect(screen.getByTestId("change-Groceries").getAttribute("data-favorable")).toBe("false");
    expect(screen.getByTestId("change-Groceries").textContent).toBe("+$100.00");
    expect(screen.getByTestId("change-Groceries").getAttribute("title")).toBe("Up, unfavorable");
    expect(screen.getByTestId("change-Rent").getAttribute("data-favorable")).toBe("none");

    await user.click(screen.getByRole("tab", { name: /^Income$/ }));
    await screen.findByTestId("report-total-Paychecks");
    expect(text("change-Paychecks")).toBe("-$1,000.00");
    expect(screen.getByTestId("change-Paychecks").getAttribute("data-favorable")).toBe("false");
    expect(screen.getByTestId("change-Paychecks").getAttribute("title")).toBe("Down, unfavorable");
  });

  test("the baseline figure is a sum, so it opens its own ledger and ties out", async () => {
    render(<ReportsSection dataLayer={cmpLayer()} period={thisMonth} compare="previous" />);
    await screen.findByTestId("report-total-Groceries");
    const link = screen.getByTestId("baseline-Groceries").querySelector("a[data-ledger]")!;
    const parsed = parseLedgerQuery(new URLSearchParams(link.getAttribute("href")!.split("?")[1]));
    expect(parsed.initialFilter).toMatchObject({ categories: ["Groceries"], kind: "expense", from: "2026-08-01", to: "2026-08-20", countedAccountsOnly: true });
    expect(parsed.ledger?.label).toBe("Groceries, previous period");
    const total = ledgerTotal(filterRows(allRows, { ...EMPTY_FILTER, ...parsed.initialFilter }));
    expect(formatCents(total.expenseCents)).toBe(link.textContent);
    // A change is a difference, not a sum, so it does not open anything.
    expect(screen.getByTestId("change-Groceries").querySelector("a")).toBeNull();
  });

  test("an average of whole months opens as one ledger, its total divided by the months", async () => {
    const august: Period = { preset: "last-month", from: "2026-08-01", to: "2026-08-31" };
    render(<ReportsSection dataLayer={cmpLayer()} period={august} compare="avg-3" />);
    await screen.findByTestId("report-total-Groceries");
    expect(text("compare-caption")).toBe("Aug 1 to Aug 31, 2026 compared with the average month over the 3 months before.");
    // May 300, June 100, July 200: an average of $200.00 a month.
    expect(text("baseline-Groceries")).toBe(formatCents(20000));
    const link = screen.getByTestId("baseline-Groceries").querySelector("a[data-ledger]")!;
    const parsed = parseLedgerQuery(new URLSearchParams(link.getAttribute("href")!.split("?")[1]));
    expect(parsed.initialFilter).toMatchObject({ from: "2026-05-01", to: "2026-07-31" });
    expect(parsed.ledger?.divideBy).toBe(3);
    const total = ledgerTotal(filterRows(allRows, { ...EMPTY_FILTER, ...parsed.initialFilter }));
    expect(formatCents(Math.round(total.expenseCents / 3))).toBe(link.textContent);
  });

  test("an average of part-months is several separate stretches of days, so it shows but does not open", async () => {
    render(<ReportsSection dataLayer={cmpLayer()} period={thisMonth} compare="avg-3" />);
    await screen.findByTestId("report-total-Groceries");
    expect(text("compare-caption")).toBe("Sep 1 to Sep 20, 2026 compared with the average of the same days in the 3 months before.");
    // Aug 1-20 $400, Jul 1-20 $200, Jun 1-20 $100: $700 / 3 = $233.33
    expect(text("baseline-Groceries")).toBe(formatCents(23333));
    expect(screen.getByTestId("baseline-Groceries").querySelector("a")).toBeNull();
  });

  test("cash flow gets a summary of income, expense, and net against the baseline", async () => {
    window.location.hash = "#/reports?tab=cashflow";
    render(<ReportsSection dataLayer={cmpLayer()} period={thisMonth} compare="previous" />);
    await screen.findByTestId("compare-summary");
    expect(text("summary-current-income")).toBe(formatCents(700000));
    expect(text("summary-baseline-income")).toBe(formatCents(800000));
    expect(text("summary-change-income")).toBe("-$1,000.00");
    expect(text("summary-current-expense")).toBe(formatCents(208000));
    expect(text("summary-baseline-expense")).toBe(formatCents(190000));
    expect(text("summary-current-net")).toBe(formatCents(492000));
    expect(text("summary-baseline-net")).toBe(formatCents(610000));
    expect(text("summary-change-net")).toBe("-$1,180.00");
    expect(screen.getByTestId("summary-change-net").getAttribute("data-favorable")).toBe("false");
  });

  test("no comparison, no columns; and a period with no end cannot be compared, and says so", async () => {
    const { unmount } = render(<ReportsSection dataLayer={cmpLayer()} period={thisMonth} compare="none" />);
    await screen.findByTestId("report-total-Groceries");
    expect(screen.queryByTestId("baseline-Groceries")).toBeNull();
    expect(screen.queryByTestId("compare-caption")).toBeNull();
    unmount();

    render(<ReportsSection dataLayer={cmpLayer()} period={ALL_TIME} compare="previous" />);
    await screen.findByTestId("report-total-Groceries");
    expect(screen.queryByTestId("baseline-Groceries")).toBeNull();
    expect(text("compare-caption")).toBe("All time has nothing before it to compare with. Choose a period with a start and an end.");
  });

  test("when the history does not reach back far enough, it says so instead of comparing against nothing", async () => {
    const lastYear: Period = { preset: "last-year", from: "2025-01-01", to: "2025-12-31" };
    render(<ReportsSection dataLayer={cmpLayer()} period={lastYear} compare="previous" />);
    await screen.findByTestId("report-total-Groceries");
    expect(screen.queryByTestId("baseline-Groceries")).toBeNull();
    expect(text("compare-caption")).toBe("Your history starts Jun 1, 2025, which is not far enough back to compare with Jan 1 to Dec 31, 2024.");
  });
});

// Left over measures income minus spending. Saving is reported separately.
describe("ReportsSection Left over tab", () => {
  const t = (id: string, date: string, amountCents: number, sourceCategory: string, over: Partial<NormalizedTxn> = {}) =>
    ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over }) as NormalizedTxn;
  const netTxns: NormalizedTxn[] = [
    t("old", "2025-01-01", -100, "Groceries"),
    t("pay-jun", "2026-06-15", 500000, "Paychecks"),
    t("rent-jun", "2026-06-01", -200000, "Rent"),
    t("pay-jul", "2026-07-15", 500000, "Paychecks"),
    t("rent-jul", "2026-07-01", -200000, "Rent"),
    t("roof-jul", "2026-07-20", -450000, "Home Improvement"), // July is a loss
    t("pay-aug", "2026-08-15", 500000, "Paychecks"),
    t("rent-aug", "2026-08-01", -200000, "Rent"),
    t("refund-aug", "2026-08-09", 5000, "Rent"), // nets against spending, so August saves more
    t("moved", "2026-08-10", -100000, "Savings", { isTransfer: true }), // moving money is not a loss
  ];
  const netLayer = () => ({ ...layer(), getTransactions: async () => netTxns });
  const allRows = toRows(prepareTransactions(netTxns, { rules: [], adjustments: [] }), accounts, {});
  const summer: Period = { preset: "custom", from: "2026-06-01", to: "2026-08-31" };
  const openNet = async (monthInView = "2026-07") => {
    const user = userEvent.setup();
    await screen.findByTestId("report-total-Rent");
    await user.click(screen.getByRole("tab", { name: /^Left over$/ }));
    await screen.findByTestId(`net-${monthInView}`);
  };
  const text = (id: string) => screen.getByTestId(id).textContent;

  test("one figure per month: above zero reads positive, below zero reads negative, and each is marked", async () => {
    render(<ReportsSection dataLayer={netLayer()} period={summer} compare="none" />);
    await openNet();
    expect(text("net-2026-06")).toBe(formatCents(300000));
    expect(text("net-2026-07")).toBe(formatCents(-150000));
    expect(text("net-2026-08")).toBe(formatCents(305000)); // the refund counts; the transfer does not
    expect(screen.getByTestId("net-2026-06").getAttribute("data-result")).toBe("above");
    expect(screen.getByTestId("net-2026-07").getAttribute("data-result")).toBe("below");
    expect(text("net-total")).toBe(formatCents(455000));
    // Nothing was put away, so the headline says nothing about saving.
    expect(text("net-headline")).toBe(`Left over ${formatCents(455000)} over Jun 1 to Aug 31, 2026`);
    expect(screen.getByTestId("net-chart").getAttribute("aria-label")).toBe("Left over by month: 2 months above zero, 1 month below");
  });

  test("a period that runs short reads as a negative number, never as Lost", async () => {
    render(<ReportsSection dataLayer={netLayer()} period={{ preset: "custom", from: "2026-07-01", to: "2026-07-31" }} compare="none" />);
    await openNet();
    expect(text("net-headline")).toBe(`Left over ${formatCents(-150000)} over Jul 1 to Jul 31, 2026`);
    // The amount alone uses the figure typeface.
    const headline = screen.getByTestId("net-headline");
    expect(headline.className).not.toMatch(/font-mono/);
    expect(headline.querySelector(".font-mono")!.textContent).toBe(formatCents(-150000));
  });

  test("every figure opens a ledger of that month's income AND spending, and ties out", async () => {
    render(<ReportsSection dataLayer={netLayer()} period={summer} compare="none" />);
    await openNet();
    const links = [...document.querySelectorAll('[data-testid="net-table"] a[data-ledger]')];
    expect(links).toHaveLength(4); // three months and the total
    for (const link of links) {
      const parsed = parseLedgerQuery(new URLSearchParams(link.getAttribute("href")!.split("?")[1]));
      expect(parsed.initialFilter.kind, link.textContent ?? "").toBeUndefined();
      expect(parsed.ledger).toEqual({ label: "Left over", back: "#/reports?tab=net&from=2026-06-01&to=2026-08-31" });
      const total = ledgerTotal(filterRows(allRows, { ...EMPTY_FILTER, ...parsed.initialFilter }));
      expect(formatCents(total.netCents)).toBe(link.textContent);
    }
    const july = parseLedgerQuery(new URLSearchParams(screen.getByTestId("net-2026-07").querySelector("a")!.getAttribute("href")!.split("?")[1]));
    expect(july.initialFilter).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
  });

  test("the tab can be opened by link, and is remembered in the link", async () => {
    window.location.hash = "#/reports?tab=net";
    render(<ReportsSection dataLayer={netLayer()} period={summer} compare="none" />);
    expect(await screen.findByTestId("net-2026-07")).toBeTruthy();
  });

  test("against a comparison, left over shows its baseline and change, and less left over is unfavorable", async () => {
    const august: Period = { preset: "last-month", from: "2026-08-01", to: "2026-08-31" };
    render(<ReportsSection dataLayer={netLayer()} period={august} compare="previous" />);
    await openNet("2026-08");
    expect(text("compare-caption")).toBe("Aug 1 to Aug 31, 2026 compared with Jul 1 to Jul 31, 2026.");
    expect(text("net-compare-current")).toBe(formatCents(305000));
    expect(text("net-compare-baseline")).toBe(formatCents(-150000));
    expect(text("change-net")).toBe("+$4,550.00");
    expect(text("changepct-net")).toBe("n/a"); // a percent of a loss is not a number worth showing
    expect(screen.getByTestId("change-net").getAttribute("data-favorable")).toBe("true");
  });
});

// Cash flow separates investing from spending. The linked ledger must contain
// the transactions that produced the amount.
describe("Cash flow shows what was put away", () => {
  const savingAccounts = [
    ...accounts,
    { ...accounts[0], id: "demo-brokerage", name: "Ridgeline Individual Investing", savingsDestination: "Investing" },
  ] as Account[];

  const row = (id: string, accountId: string, date: string, amountCents: number, sourceCategory: string | null): NormalizedTxn =>
    ({ sourceTransactionId: id, accountId, date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null }) as NormalizedTxn;

  // The investment contribution has two transfer legs. Interest arrives separately
  // in the spending account.
  const savingTxns: NormalizedTxn[] = [
    row("pay", "a1", "2026-08-01", 500000, "Paychecks"),
    row("rent", "a1", "2026-08-05", -180000, "Rent"),
    row("contrib-out", "a1", "2026-08-10", -200000, null),
    row("contrib-in", "demo-brokerage", "2026-08-11", 200000, null),
    row("interest", "a1", "2026-08-31", 5000, "Interest"),
  ];

  const savingLayer = () => ({
    ...layer(),
    getTransactions: async () => savingTxns,
    getAccounts: async () => savingAccounts,
  });

  const openCashFlow = async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={savingLayer()} period={ALL_TIME} compare="none" />);
    await user.click(await screen.findByRole("tab", { name: /Cash flow/ }));
    return screen.findByTestId("cashflow-2026-08");
  };

  test("the investment contribution is reported as saving", async () => {
    await openCashFlow();
    expect(screen.getByTestId("cashflow-2026-08-saving").textContent).toBe(formatCents(200000));
    // Rent is the only expense.
    expect(screen.getByTestId("cashflow-2026-08-expense").textContent).toBe(formatCents(180000));
  });

  test("a month of net refunds reads as a plain negative amount, never (-$30.00)", async () => {
    const user = userEvent.setup();
    const refunds: NormalizedTxn[] = [row("refund", "a1", "2026-08-09", 3000, "Shopping")];
    render(<ReportsSection dataLayer={{ ...savingLayer(), getTransactions: async () => refunds }} period={ALL_TIME} compare="none" />);
    await user.click(await screen.findByRole("tab", { name: /Cash flow/ }));
    const cell = await screen.findByTestId("cashflow-2026-08-expense");
    expect(cell.textContent).toBe(formatCents(-3000));
    expect(cell.textContent).not.toMatch(/\(/);
  });

  test("interest is investment income, not wage income", async () => {
    await openCashFlow();
    expect(screen.getByTestId("cashflow-2026-08-investment-income").textContent).toBe(formatCents(5000));
    expect(screen.getByTestId("cashflow-2026-08-income").textContent).toBe(formatCents(500000));
  });

  // Left over excludes the saving transfer.
  test("left over is income plus investment income, less spending; saving is not part of it", async () => {
    await openCashFlow();
    expect(screen.getByTestId("cashflow-2026-08-left-over").textContent).toBe(
      formatCents(500000 + 5000 - 180000)
    );
  });

  test("saved % is the share of everything that came in", async () => {
    await openCashFlow();
    // A 2,000 contribution on 5,050 of total income rounds to 40%.
    expect(screen.getByTestId("cashflow-2026-08-savings-rate").textContent).toBe("40%");
  });

  test("a month with nothing coming in leaves Saved % blank, not a dash", async () => {
    const user = userEvent.setup();
    const spendOnly: NormalizedTxn[] = [row("rent", "a1", "2026-08-05", -180000, "Rent")];
    render(<ReportsSection dataLayer={{ ...savingLayer(), getTransactions: async () => spendOnly }} period={ALL_TIME} compare="none" />);
    await user.click(await screen.findByRole("tab", { name: /Cash flow/ }));
    expect((await screen.findByTestId("cashflow-2026-08-savings-rate")).textContent).toBe("");
  });

  test("the saved figure opens a ledger that adds up to it, counting the move once", async () => {
    await openCashFlow();
    const link = screen.getByTestId("cashflow-2026-08-saving").querySelector("a[data-ledger]")!;
    const parsed = parseLedgerQuery(new URLSearchParams(link.getAttribute("href")!.split("?")[1]));
    expect(parsed.initialFilter.kind).toBe("saving");

    const rows = toRows(
      prepareTransactions(savingTxns, { rules: [], adjustments: [], accounts: savingAccounts }),
      savingAccounts,
      {}
    );
    const landed = filterRows(rows, { ...EMPTY_FILTER, ...parsed.initialFilter });
    // ONE row, not two: the arrival leg at the brokerage is suppressed.
    expect(landed).toHaveLength(1);
    expect(ledgerTotal(landed).savingCents).toBe(200000);
  });

  // The headline reports a transfer into investments separately from left over.
  test("the Left over headline names what was put away, and never says Lost", async () => {
    const user = userEvent.setup();
    const july: NormalizedTxn[] = [
      row("pay", "a1", "2026-08-01", 240000, "Paychecks"),
      row("rent", "a1", "2026-08-05", -180000, "Rent"),
      row("contrib-out", "a1", "2026-08-10", -200000, null),
      row("contrib-in", "demo-brokerage", "2026-08-11", 200000, null),
    ];
    const layerShort = { ...savingLayer(), getTransactions: async () => july };
    render(<ReportsSection dataLayer={layerShort} period={ALL_TIME} compare="none" />);
    await user.click(await screen.findByRole("tab", { name: /^Left over$/ }));
    await screen.findByTestId("net-2026-08");
    const headline = screen.getByTestId("net-headline").textContent!;
    // The transfer has its own sentence.
    expect(headline.startsWith(`Left over ${formatCents(240000 - 180000)} over `)).toBe(true);
    expect(headline.endsWith(`. Also put ${formatCents(200000)} into investments.`)).toBe(true);
    expect(headline).not.toMatch(/Lost/);
  });

  // The comparison baseline used to file saving as spending, so a month you saved
  // in looked like a month you overspent in.
  test("against the month before, saving stays out of the spending comparison", async () => {
    const txns: NormalizedTxn[] = [
      ...savingTxns,
      row("pay-sep", "a1", "2026-09-01", 500000, "Paychecks"),
      row("rent-sep", "a1", "2026-09-05", -180000, "Rent"),
    ];
    const september: Period = { preset: "custom", from: "2026-09-01", to: "2026-09-30" };
    render(<ReportsSection dataLayer={{ ...savingLayer(), getTransactions: async () => txns }} period={september} compare="previous" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: /Cash flow/ }));
    await screen.findByTestId("summary-baseline-expense");
    // August spending includes the rent alone.
    expect(screen.getByTestId("summary-baseline-expense").textContent).toBe(formatCents(180000));
    expect(screen.getByTestId("summary-baseline-net").textContent).toBe(formatCents(500000 + 5000 - 180000));
    expect(screen.getByTestId("summary-current-net").textContent).toBe(formatCents(500000 - 180000));
  });
});
