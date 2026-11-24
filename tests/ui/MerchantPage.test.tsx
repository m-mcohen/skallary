// @vitest-environment jsdom
// tests/ui/MerchantPage.test.tsx
//
// A page per merchant. Spending by month (chart),
// the total, the monthly average over COMPLETE months only (counting partial months would
// change the average every day), and
// its transactions. Its own link: #/reports/merchant?name=...
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import MerchantPage from "../../src/ui/reports/MerchantPage";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import { customPeriod } from "../../src/domain/period";
import { formatCents } from "../../src/domain/money";
import type { MerchantRename } from "../../src/domain/merchants";
import { merchantHref, parseMerchantQuery } from "../../src/ui/lib/merchant-link";
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
  window.localStorage.clear();
  configurePeriodStore({ asOf: () => "2026-10-02" });
});
beforeEach(() => charts.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const accounts = [
  { id: "a1", name: "JOINT", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
] as Account[];
const t = (id: string, date: string, amountCents: number, payee: string, over: Partial<NormalizedTxn> = {}) =>
  ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory: "Shopping", merchant: payee, payee, isTransfer: false, sourceUpdatedAt: null, ...over }) as NormalizedTxn;

const txns: NormalizedTxn[] = [
  t("before", "2026-07-01", -99900, "Shop"),
  t("jul", "2026-07-20", -4000, "Shop"),
  t("aug-1", "2026-08-03", -10000, "SHOP INC"),
  t("aug-2", "2026-08-20", -2000, "Shop"),
  t("aug-back", "2026-08-25", 1000, "Shop"),
  t("sep", "2026-09-10", -6000, "Shop"),
  t("sep-in", "2026-09-12", 2500, "Shop", { sourceCategory: "Other Income" }),
  t("sep-move", "2026-09-15", -30000, "Shop", { isTransfer: true }),
  t("oct", "2026-10-01", -50000, "Shop"),
  t("elsewhere", "2026-08-05", -4500, "Other Store"),
];
const renames: MerchantRename[] = [{ sourceName: "SHOP INC", displayName: "Shop", createdAt: "2026-10-02T12:00:00.000Z" }];
const layer = {
  loadDb: async () => ({ base: "" }),
  getTransactions: async () => txns,
  getAccounts: async () => accounts,
  getRules: async () => [],
  getAdjustments: async () => [],
  getCategoryMappings: async () => ({}),
  getMerchantRenames: async () => renames,
};
const period = customPeriod("2026-07-15", "2026-10-02");
const text = (id: string) => screen.getByTestId(id).textContent ?? "";
const show = (name = "Shop") =>
  render(<MerchantPage dataLayer={layer} name={name} period={period} today="2026-10-02" back="#/reports?tab=spending&group=merchant" />);

describe("the merchant page", () => {
  test("the total spent, with the purchases and refunds behind it, worked by hand", async () => {
    show();
    await screen.findByTestId("merchant-spent");
    expect(screen.getByRole("heading", { name: "Shop" })).toBeTruthy();
    // 40.00 + 100.00 (SHOP INC, renamed) + 20.00 - 10.00 + 60.00 + 500.00 = 710.00
    expect(text("merchant-spent")).toBe(formatCents(71000));
    expect(text("merchant-purchases")).toBe(formatCents(72000));
    expect(text("merchant-refunds")).toBe(formatCents(1000));
    expect(text("merchant-received")).toBe(formatCents(2500));
  });

  test("the monthly average covers complete months only: August and September", async () => {
    show();
    await screen.findByTestId("merchant-average");
    // (110.00 + 60.00) / 2 = 85.00. With October (not over) it would read 223.33; with July (cut short), 70.00.
    expect(text("merchant-average")).toBe(formatCents(8500));
    expect(text("merchant-average-note")).toMatch(/2 complete months/);
    expect(text("merchant-average-note")).toMatch(/Aug 2026 to Sep 2026/);
  });

  test("with no complete month there is no average, and it says why", async () => {
    render(<MerchantPage dataLayer={layer} name="Shop" period={customPeriod("2026-10-01", "2026-10-02")} today="2026-10-02" back="#/reports" />);
    await screen.findByTestId("merchant-spent");
    expect(screen.queryByTestId("merchant-average")).toBeNull();
    expect(text("merchant-average-note")).toMatch(/No complete month/);
  });

  test("the chart is spending by month; a month's bar opens that month's ledger", async () => {
    show();
    await screen.findByTestId("merchant-spent");
    expect(screen.getByRole("button", { name: "Spent 2026-08" }).textContent).toBe("11000");
    expect(screen.getByRole("button", { name: "Spent 2026-10" }).textContent).toBe("50000");
    screen.getByRole("button", { name: "Spent 2026-08" }).click();
    const parsed = parseLedgerQuery(new URLSearchParams(window.location.hash.split("?")[1]));
    expect(parsed.initialFilter.merchants).toEqual(["Shop"]);
    expect(parsed.initialFilter.from).toBe("2026-08-01");
    expect(parsed.initialFilter.to).toBe("2026-08-31");
  });

  test("its transactions: the rows behind the figures, newest first; transfers left out and counted in a note", async () => {
    show();
    await screen.findByTestId("merchant-spent");
    const rows = within(screen.getByTestId("merchant-transactions")).getAllByTestId(/^merchant-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "merchant-row-oct",
      "merchant-row-sep-in",
      "merchant-row-sep",
      "merchant-row-aug-back",
      "merchant-row-aug-2",
      "merchant-row-aug-1",
      "merchant-row-jul",
    ]);
    // The bank's own name is kept beside the row, so a rename can be traced.
    expect(within(screen.getByTestId("merchant-row-aug-1")).getByText("SHOP INC")).toBeTruthy();
    expect(text("merchant-left-out")).toMatch(/1 more transaction/);
    expect(text("merchant-bank-names")).toMatch(/SHOP INC/);
  });

  test("Back returns where it came from", async () => {
    show();
    await screen.findByTestId("merchant-spent");
    expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("#/reports?tab=spending&group=merchant");
  });

  test("a name with no transactions in the period says so", async () => {
    show("Nobody");
    expect(await screen.findByText(/No transactions named Nobody/)).toBeTruthy();
  });
});

describe("its own link", () => {
  test("the name, the period and the way back survive the round trip", () => {
    const href = merchantHref("Zelle Payment to Jane Doe", "#/transactions", period);
    expect(href.startsWith("#/reports/merchant?")).toBe(true);
    const q = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(parseMerchantQuery(q)).toEqual({ name: "Zelle Payment to Jane Doe", back: "#/transactions" });
    expect(q.get("from")).toBe("2026-07-15");
    // Back stays inside the app.
    expect(parseMerchantQuery(new URLSearchParams("name=Shop&back=https://example.com")).back).toBe("#/reports");
  });

  test("the page reads its name from the link when none is given", async () => {
    window.location.hash = merchantHref("Shop", "#/reports", period);
    render(<MerchantPage dataLayer={layer} period={period} today="2026-10-02" />);
    expect(await screen.findByRole("heading", { name: "Shop" })).toBeTruthy();
  });
});
