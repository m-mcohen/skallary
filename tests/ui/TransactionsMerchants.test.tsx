// @vitest-environment jsdom
// tests/ui/TransactionsMerchants.test.tsx
//
// On Transactions the Merchant column shows the shown name and opens the
// merchant's page; the bank's own name stays in reach. A rename changes no
// category and no recurring result: the rules and the recurring finder keep
// reading the bank's name.
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TransactionsSection from "../../src/ui/TransactionsSection";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { CategorizationRule } from "../../src/domain/rules";
import type { RecurringChoice } from "../../src/domain/recurring-choices";
import type { MerchantRename } from "../../src/domain/merchants";

const ALL_TIME = { preset: "all", from: null, to: null } as const;

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
  { id: "a1", name: "REWARDS CARD (0303)", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
] as Account[];
const t = (id: string, date: string, amountCents: number, payee: string, over: Partial<NormalizedTxn> = {}) =>
  ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory: null, merchant: payee, isTransfer: false, sourceUpdatedAt: null, payee, ...over }) as NormalizedTxn;

// SimpleFIN-style rows: no category; a rule on the bank's name files them.
const txns = [
  t("n1", "2026-06-15", -1500, "Netflix.com"),
  t("n2", "2026-07-15", -1500, "Netflix.com"),
  t("n3", "2026-08-15", -1500, "Netflix.com"),
  t("g1", "2026-06-20", -3000, "Gym Club", { sourceCategory: "Fitness" }),
  t("g2", "2026-07-20", -3000, "Gym Club", { sourceCategory: "Fitness" }),
  t("g3", "2026-08-20", -3000, "Gym Club", { sourceCategory: "Fitness" }),
];
const rule: CategorizationRule = { id: 1, priority: 100, payeeContains: "netflix.com", action: "categorize", toCategory: "Streaming" };
// Gym Club is hidden from Recurring, on the bank's name (the merchant key).
const hidden: RecurringChoice = { payeeKey: "gym club", accountId: "a1", choice: "not_recurring", cadence: null, label: "Gym Club", createdAt: "2026-03-01T12:00:00.000Z" };
const renames: MerchantRename[] = [
  { sourceName: "Netflix.com", displayName: "Netflix", createdAt: "2026-03-02T12:00:00.000Z" },
  { sourceName: "Gym Club", displayName: "The Gym", createdAt: "2026-03-02T12:00:00.000Z" },
];

const layer = (list: MerchantRename[]) => ({
  loadDb: async () => ({ base: "" }),
  getTransactions: async () => txns,
  getMaaserMarks: async () => [],
  getAccounts: async () => accounts,
  getRules: async () => [rule],
  getAdjustments: async () => [],
  getCategoryMappings: async () => ({}),
  getCategories: async () => ["Streaming", "Fitness"],
  createCategory: async () => {},
  addRule: async () => 1,
  addAdjustment: async () => {},
  getRecurringChoices: async () => [hidden],
  saveRecurringChoice: async () => {},
  getMerchantRenames: async () => list,
});

const show = (list: MerchantRename[]) =>
  render(<TransactionsSection dataLayer={layer(list)} period={ALL_TIME} asOfDate="2026-09-01" />);

describe("the Merchant column", () => {
  test("shows the shown name, opening the merchant's page, with the bank's name in its title", async () => {
    show(renames);
    const links = await screen.findAllByRole("link", { name: "Netflix" });
    expect(links).toHaveLength(3);
    const href = links[0].getAttribute("href")!;
    expect(href.startsWith("#/reports/merchant?")).toBe(true);
    expect(new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("name")).toBe("Netflix");
    expect(links[0].getAttribute("title")).toBe("Bank name: Netflix.com");
    expect(screen.getByRole("columnheader", { name: "Merchant" })).toBeTruthy();
  });
});

describe("a rename changes no category and no recurring result", () => {
  const categories = () => ["n1", "n2", "n3", "g1"].map((id) => screen.getByTestId(`txn-category-${id}`).textContent);
  const recurringButtons = () => screen.queryAllByRole("button", { name: /recurring/ }).map((b) => b.getAttribute("aria-label"));

  test("the same categories and the same recurring buttons, with and without the renames", async () => {
    show([]);
    await screen.findByTestId("txn-category-n1");
    const before = { categories: categories(), recurring: recurringButtons() };
    // The rule on the bank's name files Netflix; Gym Club stays hidden from Recurring.
    expect(before.categories).toEqual(["Streaming", "Streaming", "Streaming", "Fitness"]);
    expect(before.recurring.filter((l) => /is recurring/.test(l ?? ""))).toEqual([
      "Netflix.com is recurring",
      "Netflix.com is recurring",
      "Netflix.com is recurring",
    ]);
    cleanup();
    show(renames);
    await screen.findByTestId("txn-category-n1");
    expect(categories()).toEqual(before.categories);
    expect(recurringButtons()).toEqual(before.recurring);
  });
});
