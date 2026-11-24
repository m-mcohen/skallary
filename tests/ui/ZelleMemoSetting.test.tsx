// @vitest-environment jsdom
// tests/ui/ZelleMemoSetting.test.tsx
//
// Settings, Merchants carries "Name old Zelle payments
// by the person in the note", which starts off. Off, every screen shows the old rows
// as "Zelle"; on, as the person in the note. Every memo here is made up.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MerchantSettings from "../../src/ui/MerchantSettings";
import ReportsSection from "../../src/ui/ReportsSection";
import { customPeriod } from "../../src/domain/period";
import { configurePeriodStore } from "../../src/ui/lib/period-store";
import type { Account, NormalizedTxn } from "../../src/domain/types";

vi.mock("../../src/ui/charts/ChartBase", () => ({ default: () => null }));

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
  { id: "a1", name: "JOINT", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
] as Account[];
const z = (id: string, memo: string, amountCents = -5000) =>
  ({ sourceTransactionId: id, accountId: "a1", date: "2025-03-10", amountCents, sourceCategory: "Babysitting", merchant: "Zelle", isTransfer: false, sourceUpdatedAt: null, memo }) as NormalizedTxn;
const txns = [z("1", "Zelle payment to Jane Doe JPM99abc1def"), z("2", "Zelle payment to Jane Doe 12345678901"), z("3", "Zelle payment to SAM ROE Conf# q1w2e3r4t"), z("4", "Online transfer")];

function settingsLayer(on: boolean) {
  const calls: boolean[] = [];
  let state = on;
  return {
    calls,
    loadDb: async () => ({ base: "" }),
    getTransactions: async () => txns,
    getMerchantRenames: async () => [],
    saveMerchantRename: async () => {},
    deleteMerchantRename: async () => {},
    getSuggestionDismissals: async () => [],
    dismissSuggestion: async () => {},
    showSuggestionAgain: async () => {},
    getZelleMemoNames: async () => state,
    setZelleMemoNames: async (_db: unknown, next: boolean) => {
      calls.push(next);
      state = next;
    },
  };
}

describe("Settings, Merchants: the switch", () => {
  test("starts off, says what it would do, and turning it on saves it", async () => {
    const user = userEvent.setup();
    const layer = settingsLayer(false);
    render(<MerchantSettings dataLayer={layer} />);
    const sw = await screen.findByRole("switch", { name: "Show names from Zelle payment notes" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    // 4 rows named just Zelle: 3 notes name a person (2 people), 1 could not be read.
    expect(screen.getByTestId("zelle-memo-summary").textContent).toMatch(/4 payments are named just Zelle/);
    expect(screen.getByTestId("zelle-memo-summary").textContent).toMatch(/2 people/);
    expect(screen.getByTestId("zelle-memo-summary").textContent).toMatch(/1 note could not be read/);
    await user.click(sw);
    await waitFor(() => expect(layer.calls).toEqual([true]));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Show names from Zelle payment notes" }).getAttribute("aria-checked")).toBe("true"));
  });
});

describe("Reports, grouped by merchant, follows the switch", () => {
  const reportsLayer = (on: boolean) => ({
    loadDb: async () => ({ base: "" }),
    getTransactions: async () => txns,
    getAccounts: async () => accounts,
    getRules: async () => [],
    getAdjustments: async () => [],
    getCategoryMappings: async () => ({}),
    getMerchantRenames: async () => [],
    getZelleMemoNames: async () => on,
  });
  const names = () => [...document.querySelectorAll("[data-rank-row]")].map((r) => r.getAttribute("data-rank-row"));

  test("off: one merchant, Zelle", async () => {
    configurePeriodStore({ asOf: () => "2026-10-02" });
    window.location.hash = "#/reports?tab=spending&group=merchant";
    render(<ReportsSection dataLayer={reportsLayer(false)} period={customPeriod("2025-03-01", "2025-03-31")} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(names()).toEqual(["Zelle"]);
  });

  test("on: each person in the note, and a note it cannot read stays Zelle", async () => {
    configurePeriodStore({ asOf: () => "2026-10-02" });
    window.location.hash = "#/reports?tab=spending&group=merchant";
    render(<ReportsSection dataLayer={reportsLayer(true)} period={customPeriod("2025-03-01", "2025-03-31")} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(names()).toEqual(["Zelle payment to Jane Doe", "Zelle", "Zelle payment to SAM ROE"]);
  });
});
