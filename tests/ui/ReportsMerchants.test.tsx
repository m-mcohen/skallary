// @vitest-environment jsdom
// tests/ui/ReportsMerchants.test.tsx
//
// Merchant as a grouping in Reports, beside
// Category, on Spending and Income. The total, the chart, the ranked list and the
// monthly table follow it; a merchant's name opens its page; each figure still
// opens a ledger that adds up to it. Names are the shown names (rename list, then
// the Zelle clean); the categories never change.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportsSection from "../../src/ui/ReportsSection";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import { customPeriod } from "../../src/domain/period";
import { formatCents } from "../../src/domain/money";
import { prepareTransactions } from "../../src/domain/pipeline";
import { renameMap, type MerchantRename } from "../../src/domain/merchants";
import { EMPTY_FILTER, filterRows, ledgerTotal, toRows } from "../../src/domain/transactions-view";
import { parseLedgerQuery } from "../../src/ui/lib/ledger-link";
import { configurePeriodStore } from "../../src/ui/lib/period-store";

import { mockChartBase } from "./charts/mock-chart-base";

vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
const charts = mockChartBase();

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = ResizeObserverStub;
});
beforeEach(() => {
  charts.reset();
  window.localStorage.clear();
  configurePeriodStore({ asOf: () => "2026-10-02" });
  window.location.hash = "#/reports?tab=spending";
});
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const accounts = [
  { id: "a1", name: "JOINT", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
] as Account[];
const t = (id: string, date: string, amountCents: number, sourceCategory: string, payee: string) =>
  ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory, merchant: payee, payee, isTransfer: false, sourceUpdatedAt: null }) as NormalizedTxn;

const txns: NormalizedTxn[] = [
  t("rent-jun", "2026-06-05", -150000, "Rent", "Landlord LLC"),
  t("rent-jul", "2026-07-05", -150000, "Rent", "Landlord LLC"),
  t("rent-aug", "2026-08-05", -150000, "Rent", "Landlord LLC"),
  t("pub-jun", "2026-06-12", -30000, "Groceries", "Publix"),
  t("pub-jul", "2026-07-12", -40000, "Groceries", "PUBLIX"),
  t("wf-aug", "2026-08-12", -50000, "Groceries", "Whole Foods"),
  t("wf-back", "2026-08-13", 2500, "Groceries", "Whole Foods"),
  t("amz-jul", "2026-07-20", -10000, "Shopping", "Amazon"),
  t("prime-aug", "2026-08-02", -1499, "Shopping", "Amazon Prime"),
  t("amz-back", "2026-08-20", 15000, "Shopping", "Amazon"),
  t("zelle-1", "2026-08-21", -5000, "Gifts", "Zelle Payment to Jane Doe JPM99aaa1bcd"),
  t("zelle-2", "2026-08-22", -7000, "Gifts", "Zelle Payment to Jane Doe JPM99bbb2cde"),
  t("pay-aug", "2026-08-15", 800000, "Paychecks", "Employer"),
];
const publix: MerchantRename[] = [{ sourceName: "PUBLIX", displayName: "Publix", createdAt: "2026-10-02T12:00:00.000Z" }];
const layer = (renames: MerchantRename[] = publix) => ({
  loadDb: async () => ({ base: "" }),
  getTransactions: async () => txns,
  getAccounts: async () => accounts,
  getRules: async () => [],
  getAdjustments: async () => [],
  getCategoryMappings: async () => ({}),
  getMerchantRenames: async () => renames,
});
const summer = customPeriod("2026-06-01", "2026-08-31");
const text = (id: string) => screen.getByTestId(id).textContent;
const rankNames = () => [...document.querySelectorAll("[data-rank-row]")].map((r) => r.getAttribute("data-rank-row"));
const allRows = toRows(prepareTransactions(txns, { rules: [], adjustments: [] }), accounts, {}, renameMap(publix));
const landed = (href: string) => {
  const parsed = parseLedgerQuery(new URLSearchParams(href.slice(href.indexOf("?") + 1)));
  return ledgerTotal(filterRows(allRows, { ...EMPTY_FILTER, ...parsed.initialFilter }));
};
const showMerchants = () => {
  window.location.hash = "#/reports?tab=spending&group=merchant";
};

describe("Group by Merchant on Spending", () => {
  test("the ranked list is by shown merchant name, and the total is the same as by category", async () => {
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    // By category: Rent 4,500.00 + Groceries 1,175.00 + Shopping -35.01 + Gifts 120.00 = 5,759.99
    expect(text("summary-total")).toBe(formatCents(575999));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Merchant" }));
    expect(text("summary-total")).toBe(formatCents(575999));
    // Purchases by merchant: Landlord 4,500.00; Publix 300.00 + 400.00 (renamed) = 700.00; Whole Foods 500.00;
    // Jane Doe 50.00 + 70.00 = 120.00 (codes left off); Amazon 100.00; Amazon Prime 14.99 (its own merchant).
    expect(rankNames()).toEqual(["Landlord LLC", "Publix", "Whole Foods", "Zelle Payment to Jane Doe", "Amazon", "Amazon Prime", "Refunds and credits"]);
    expect(text("rank-total-Publix")).toBe(formatCents(70000));
    expect(text("rank-total-Zelle Payment to Jane Doe")).toBe(formatCents(12000));
    expect(text("rank-total-Amazon Prime")).toBe(formatCents(1499));
    // 25.00 + 150.00 came back
    expect(text("rank-total-Refunds and credits")).toBe(formatCents(-17500));
    expect(text("rank-grand-total")).toBe(formatCents(575999));
    expect(within(screen.getByTestId("ranked-list")).getByRole("columnheader", { name: "Merchant" })).toBeTruthy();
    // The choice rides in the link, so Back from a ledger returns grouped.
    expect(new URLSearchParams(window.location.hash.split("?")[1]).get("group")).toBe("merchant");
  });

  test("a merchant's figure opens a ledger that adds up to it", async () => {
    showMerchants();
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("rank-total-Publix");
    const href = within(screen.getByTestId("rank-total-Publix")).getByRole("link").getAttribute("href")!;
    expect(landed(href).expenseCents).toBe(70000);
    const parsed = parseLedgerQuery(new URLSearchParams(href.slice(href.indexOf("?") + 1)));
    expect(parsed.ledger?.back).toContain("group=merchant");
    const july = within(screen.getByTestId("cell-Publix-2026-07")).getByRole("link").getAttribute("href")!;
    expect(landed(july).expenseCents).toBe(40000);
  });

  test("a merchant's name opens its page, carrying the period and the way back", async () => {
    showMerchants();
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("rank-total-Publix");
    const links = screen.getAllByRole("link", { name: "Publix" });
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) {
      const href = link.getAttribute("href")!;
      expect(href.startsWith("#/reports/merchant?")).toBe(true);
      const q = new URLSearchParams(href.slice(href.indexOf("?") + 1));
      expect(q.get("name")).toBe("Publix");
      expect(q.get("from")).toBe("2026-06-01");
      expect(q.get("to")).toBe("2026-08-31");
      expect(q.get("back")).toContain("group=merchant");
    }
  });

  test("the chart follows: its columns are split by merchant, not by category", async () => {
    showMerchants();
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(screen.getAllByRole("button", { name: /^Publix / }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /^Groceries / })).toEqual([]);
  });

  test("the category box still narrows: Groceries by merchant", async () => {
    showMerchants();
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={["Groceries"]} />);
    await screen.findByTestId("summary-total");
    expect(rankNames()).toEqual(["Publix", "Whole Foods", "Refunds and credits"]);
    // 700.00 + 500.00 - 25.00 = 1,175.00, the Groceries figure by category.
    expect(text("summary-total")).toBe(formatCents(117500));
  });

  test("with no renames, the bank's two spellings are two merchants", async () => {
    showMerchants();
    render(<ReportsSection dataLayer={layer([])} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(rankNames()).toContain("PUBLIX");
    expect(text("rank-total-Publix")).toBe(formatCents(30000));
    expect(text("rank-total-PUBLIX")).toBe(formatCents(40000));
  });

  test("Other opens a ledger of every merchant outside the top 8, and adds up to it", async () => {
    showMerchants();
    const extra = Array.from({ length: 9 }, (_, i) => t(`x${i}`, "2026-07-01", -(1000 + i), "Shopping", `Shop ${i}`));
    const list = [...txns, ...extra];
    const rowsAll = toRows(prepareTransactions(list, { rules: [], adjustments: [] }), accounts, {}, renameMap(publix));
    render(<ReportsSection dataLayer={{ ...layer(), getTransactions: async () => list }} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("rank-total-Other");
    const href = within(screen.getByTestId("rank-total-Other")).getByRole("link").getAttribute("href")!;
    const parsed = parseLedgerQuery(new URLSearchParams(href.slice(href.indexOf("?") + 1)));
    const total = ledgerTotal(filterRows(rowsAll, { ...EMPTY_FILTER, ...parsed.initialFilter })).expenseCents;
    expect(formatCents(total)).toBe(text("rank-total-Other"));
  });
});

describe("Group by Merchant on Income, and the category grouping is unchanged", () => {
  test("Income by merchant", async () => {
    window.location.hash = "#/reports?tab=income&group=merchant";
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(rankNames()).toEqual(["Employer"]);
    expect(text("summary-total")).toBe(formatCents(800000));
  });

  test("by category, a rename changes nothing", async () => {
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    const withRename = rankNames();
    cleanup();
    render(<ReportsSection dataLayer={layer([])} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(rankNames()).toEqual(withRename);
    expect(withRename).toEqual(["Rent", "Groceries", "Gifts", "Shopping", "Refunds and credits"]);
  });
});
