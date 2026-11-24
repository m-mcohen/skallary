// @vitest-environment jsdom
// tests/ui/money-rule.test.tsx
//
// One way to write money: $ always, a minus sign
// for money out, red only for a real shortfall or overspend. Before it, the
// Balances card printed "(1,200.00)" in red with no $, and Waiting on you
// printed "(18.00)".
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { Db } from "../../src/ui/lib/db";
import { PositionCard } from "../../src/ui/PositionCard";
import NowSection from "../../src/ui/NowSection";

afterEach(cleanup);

const acct = (id: string, name: string, type: string, balanceCents: number): Account => ({
  id, name, type, institution: "B", currency: "USD", isOwned: true, includeInSpend: true, owner: "me", balanceCents,
});
const ACCOUNTS: Account[] = [
  acct("chk", "Everyday Checking (1111)", "depository", 600000),
  acct("card", "Sample Card (2222)", "credit", -120000),
];
const BALANCES = ACCOUNTS.map((a) => ({ accountId: a.id, balanceCents: a.balanceCents!, asOf: "2026-09-02" }));

test("Balances writes a card balance with $ and a minus sign, not red parentheses", () => {
  render(<PositionCard accounts={ACCOUNTS} balances={BALANCES} />);
  const card = screen.getByText("Sample Card (2222)").closest("li")!;
  const amount = card.querySelector("span:last-child")!;
  expect(amount.textContent).toBe("-$1,200.00");
  expect(amount.className).not.toMatch(/text-destructive/);
  expect(screen.getByTestId("position-drawable").textContent).toBe("$4,800.00");
  expect(document.body.textContent).not.toMatch(/\(1,222\.89\)/);
});

test("Waiting on you writes money out with $ and a minus sign, in the plain color", async () => {
  const row: NormalizedTxn = {
    sourceTransactionId: "sf-1", accountId: "chk", date: "2026-09-01", amountCents: -1800,
    sourceCategory: null, merchant: null, isTransfer: false, sourceUpdatedAt: null,
    payee: "Example Insurance", description: "EXAMPLE INSURANCE", memo: "", mcc: null, pending: false,
  };
  const dataLayer = {
    loadDb: async () => ({}) as Db,
    getAccounts: async () => ACCOUNTS,
    getAccountBalances: async () => BALANCES,
    getUncategorized: async () => [row],
    getCategories: async () => ["Groceries"],
    addRule: vi.fn(async () => 1),
    createCategory: vi.fn(async () => {}),
    seedBudget: vi.fn(async () => ({ window: [], seededCategories: 0, skippedPinned: [] })),
    getSeedStatus: vi.fn(async () => ({ lastSeedAt: "2026-09-02T18:07:00.000Z", windowMonths: 12, reseedDueAt: "2026-12-01", reseedDue: false })),
  };
  render(<NowSection dataLayer={dataLayer} />);
  const amount = await screen.findByText("-$18.00");
  // The date reads "Sep 1", not "09-01".
  expect(screen.getByText("Sep 1")).toBeTruthy();
  expect(amount.className).not.toMatch(/text-destructive/);
});

// The "File as" picker's open button had no name a screen
// reader could read; it now names the row it files.
test("the File as picker's open button is named after its row", async () => {
  const row: NormalizedTxn = {
    sourceTransactionId: "sf-2", accountId: "chk", date: "2026-09-01", amountCents: -1800,
    sourceCategory: null, merchant: null, isTransfer: false, sourceUpdatedAt: null,
    payee: "Corner Cafe", description: "CORNER CAFE", memo: "", mcc: null, pending: false,
  };
  const dataLayer = {
    loadDb: async () => ({}) as Db,
    getAccounts: async () => ACCOUNTS,
    getAccountBalances: async () => BALANCES,
    getUncategorized: async () => [row],
    getCategories: async () => ["Groceries"],
    addRule: vi.fn(async () => 1),
    createCategory: vi.fn(async () => {}),
    seedBudget: vi.fn(async () => ({ window: [], seededCategories: 0, skippedPinned: [] })),
    getSeedStatus: vi.fn(async () => ({ lastSeedAt: "2026-09-02T18:07:00.000Z", windowMonths: 12, reseedDueAt: "2026-12-01", reseedDue: false })),
  };
  render(<NowSection dataLayer={dataLayer} />);
  expect(await screen.findByRole("button", { name: "Show categories for Corner Cafe" })).toBeTruthy();
});
