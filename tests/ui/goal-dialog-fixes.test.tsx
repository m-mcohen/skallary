// @vitest-environment jsdom
// Goal dialog defects. Each expected
// value is worked by hand in the comment beside it.
import { afterEach, expect, test, vi } from "vitest";
import { render, waitFor, fireEvent, cleanup } from "@testing-library/react";

import GoalsSection, { type GoalsDataLayer } from "../../src/ui/GoalsSection";
import type { Goal, GoalAccountLink, AccountBalance } from "../../src/domain/plan-types";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { Db } from "../../src/ui/lib/db";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function goal(id: string, name: string, over: Partial<Goal> = {}): Goal {
  return {
    id, name, goalType: "savings", targetAmountCents: 1_000_000, targetDate: null, priority: 1,
    currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null, ...over,
  };
}
function acct(id: string, name: string, over: Partial<Account> = {}): Account {
  return { id, name, type: "savings", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me", ...over };
}
function txn(accountId: string, date: string, amountCents: number): NormalizedTxn {
  return { sourceTransactionId: `t-${date}`, accountId, date, amountCents, sourceCategory: null, merchant: null, isTransfer: true, sourceUpdatedAt: null };
}

function layer(opts: { goals: Goal[]; accounts: Account[]; balances: AccountBalance[]; links: GoalAccountLink[]; txns?: NormalizedTxn[] }) {
  let links = [...opts.links];
  const replaceGoalAccountLinks = vi.fn(async (_db: Db, goalId: string, next: GoalAccountLink[]) => {
    links = [...links.filter((l) => l.goalId !== goalId), ...next];
  });
  const dataLayer: Partial<GoalsDataLayer> = {
    loadDb: async () => ({}) as Db,
    listGoals: async () => opts.goals,
    upsertGoal: vi.fn(async () => {}),
    deleteGoal: vi.fn(async () => {}),
    listWishlistItems: async () => [],
    getAccounts: async () => opts.accounts,
    getAccountBalances: async () => opts.balances,
    getTransactions: async () => opts.txns ?? [],
    listGoalAccountLinks: async () => links,
    replaceGoalAccountLinks,
  };
  return { dataLayer, replaceGoalAccountLinks };
}

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled");
}

test("the goal editor's needed-per-month matches the card once money has landed this month", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
  // $10,000 by Oct 31, all of Savings ($1,000) linked, and $500 landed in Savings on Sep 5.
  // $9,000 left. September and October remain, but September already had a
  // contribution, so only October counts: $9,000 / 1 = $9,000. Ignoring this
  // month's deposit gives $9,000 / 2 = $4,500, which misses the deadline.
  const { dataLayer } = layer({
    goals: [goal("g1", "Trip", { targetDate: "2026-10-31" })],
    accounts: [acct("sav", "Savings")],
    balances: [{ accountId: "sav", balanceCents: 100_000, asOf: "2026-09-18T00:00:00Z" }],
    links: [{ goalId: "g1", accountId: "sav", mode: "entire", amountCents: null }],
    txns: [txn("sav", "2026-09-05", 50_000)],
  });
  const { findByText, getByRole } = render(<GoalsSection dataLayer={dataLayer} />);
  await findByText("Trip");
  fireEvent.click(getByRole("button", { name: "Edit Trip" }));
  await findByText("Needed to finish on time: $9,000 per month");
});

test("saving the accounts dialog keeps a link to an account with Counted off", async () => {
  // Old savings has Counted off, so the dialog does not list it. Its $300 slice must survive a save.
  const { dataLayer, replaceGoalAccountLinks } = layer({
    goals: [goal("g1", "Trip")],
    accounts: [acct("sav", "Savings"), acct("old", "Old savings", { includeInSpend: false })],
    balances: [
      { accountId: "sav", balanceCents: 100_000, asOf: "2026-09-18T00:00:00Z" },
      { accountId: "old", balanceCents: 50_000, asOf: "2026-09-18T00:00:00Z" },
    ],
    links: [
      { goalId: "g1", accountId: "sav", mode: "entire", amountCents: null },
      { goalId: "g1", accountId: "old", mode: "fixed", amountCents: 30_000 },
    ],
  });
  const { findByText, getByRole } = render(<GoalsSection dataLayer={dataLayer} />);
  await findByText("Trip");
  fireEvent.click(getByRole("button", { name: "Accounts for Trip" }));
  await findByText(/also linked to 1 account that cannot fund goals right now/);
  fireEvent.click(getByRole("button", { name: "Save accounts" }));
  await waitFor(() => expect(replaceGoalAccountLinks).toHaveBeenCalled());
  const saved = replaceGoalAccountLinks.mock.calls[0][2];
  expect(saved).toHaveLength(2);
  expect(saved).toEqual(
    expect.arrayContaining([
      { goalId: "g1", accountId: "sav", mode: "entire", amountCents: null },
      { goalId: "g1", accountId: "old", mode: "fixed", amountCents: 30_000 },
    ])
  );
});

test("a slice left on an account another goal holds entirely can still be set to Not linked", async () => {
  // Trip holds a $300 slice of Savings; Car holds Savings entirely (a state saved before the server refused it).
  const { dataLayer, replaceGoalAccountLinks } = layer({
    goals: [goal("g1", "Trip"), goal("g2", "Car")],
    accounts: [acct("sav", "Savings")],
    balances: [{ accountId: "sav", balanceCents: 100_000, asOf: "2026-09-18T00:00:00Z" }],
    links: [
      { goalId: "g1", accountId: "sav", mode: "fixed", amountCents: 30_000 },
      { goalId: "g2", accountId: "sav", mode: "entire", amountCents: null },
    ],
  });
  const { findByText, getByRole } = render(<GoalsSection dataLayer={dataLayer} />);
  await findByText("Trip");
  fireEvent.click(getByRole("button", { name: "Accounts for Trip" }));
  await findByText("Accounts for Trip");

  const notLinked = getByRole("button", { name: "Savings: not linked" });
  expect(isDisabled(notLinked)).toBe(false);
  expect(isDisabled(getByRole("button", { name: "Savings: entire balance" }))).toBe(true);
  expect(isDisabled(getByRole("button", { name: "Savings: fixed amount" }))).toBe(true);

  fireEvent.click(notLinked);
  fireEvent.click(getByRole("button", { name: "Save accounts" }));
  await waitFor(() => expect(replaceGoalAccountLinks).toHaveBeenCalledWith(expect.anything(), "g1", []));
});
