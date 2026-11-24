// @vitest-environment jsdom
// tests/ui/charity-off.test.tsx -- with the charity pot off, no pot ledger and no pot marks; with a
// set-amount pot, no per-row income marks. Values invented.
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetMonth from "../../src/ui/budget/BudgetMonth";
import TransactionsSection from "../../src/ui/TransactionsSection";
import { makeBudgetLayer, PLAN, TODAY } from "./budget-fixtures";
import type { Period } from "../../src/domain/period";
import type { CharityPot } from "../../src/domain/charity-pot";
import type { Account, NormalizedTxn } from "../../src/domain/types";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = RO;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => cleanup());

const ALL_TIME: Period = { preset: "all", from: null, to: null };

const pot: CharityPot = {
  on: true, name: "Giving", kind: "percent", rateBps: 500, fixedCents: null, fixedFrom: null,
  counts: { me: true, partner: true, joint: true }, floorCents: 0,
};

const accounts: Account[] = [
  { id: "a1", name: "Checking", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];
const row = (id: string, amountCents: number, sourceCategory: string, payee: string): NormalizedTxn =>
  ({ sourceTransactionId: id, accountId: "a1", date: "2026-08-20", amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, payee }) as NormalizedTxn;

function transactionsLayer(charityPot: Pick<CharityPot, "on" | "name" | "kind" | "counts"> | null, txns: NormalizedTxn[]) {
  return {
    loadDb: async () => ({ base: "" }),
    getTransactions: async () => txns,
    getAccounts: async () => accounts,
    getRules: async () => [],
    getAdjustments: async () => [],
    getCategoryMappings: async () => ({ Paychecks: "Paychecks", Charity: "Charity" }),
    getCategories: async () => ["Charity"],
    getRecentCategorizations: async () => [],
    getNotes: async () => [],
    getMaaserMarks: async () => [],
    getCharityPot: async () => charityPot,
    saveMaaserMark: vi.fn(async () => {}),
    deleteMaaserMark: vi.fn(async () => {}),
  };
}

test("with the pot off, the Charity line's panel has no pot ledger and transactions have no pot marks", async () => {
  const user = userEvent.setup();
  const made = makeBudgetLayer({ lines: [{ planId: PLAN.id, planningCategory: "Charity", period: null, amountCents: 90000, source: "suggested" as const }] });
  const salary = await made.layer.getSalarySettings({} as never);
  made.layer.getSalarySettings = async () => ({ ...salary, maaserRate: 0, pot: null });
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today={TODAY} />);
  const line = await screen.findByRole("row", { name: /^Charity\b/ });
  await user.click(within(line).getByRole("button", { name: "Charity" }));
  await screen.findByRole("region", { name: "Charity" });
  expect(screen.queryByTestId("pot-ledger")).toBeNull();
  cleanup();

  render(<TransactionsSection period={ALL_TIME} dataLayer={transactionsLayer(null, [row("g", -5000, "Charity", "A Gift"), row("p", 400000, "Paychecks", "Payroll")])} />);
  await screen.findByText("A Gift");
  expect(screen.queryAllByTestId("pot-mark-cell")).toHaveLength(0);
});

test("with a fixed-amount pot, the per-row income marks are hidden", async () => {
  const monthly = { ...pot, kind: "monthly" as const };
  render(<TransactionsSection period={ALL_TIME} dataLayer={transactionsLayer(monthly, [row("p", 400000, "Paychecks", "Payroll")])} />);
  await screen.findByText("Payroll");
  expect(screen.queryAllByTestId("pot-mark-cell")).toHaveLength(0);
});
