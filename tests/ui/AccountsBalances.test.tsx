// @vitest-environment jsdom
// tests/ui/AccountsBalances.test.tsx
//
// Accounts, Balances: the balance sheet that used to be the
// Dashboard's Position card. It foots to the same Drawable the top bar shows, with
// retirement held back below the line, and it carries no switches: those live in
// Settings, Accounts. The positionGroups cases moved here from NowSection.test.tsx.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AccountsBalances from "../../src/ui/AccountsBalances";
import { positionGroups } from "../../src/ui/PositionCard";
import type { Account } from "../../src/domain/types";
import type { AccountBalance } from "../../src/domain/plan-types";
import { drawableLiquidCents } from "../../src/domain/runway";

afterEach(cleanup);

const acct = (id: string, name: string, type: string, balanceCents: number, extra: Partial<Account> = {}): Account => ({
  id, name, type, institution: "B", currency: "USD", isOwned: true, includeInSpend: true, owner: "me", balanceCents, ...extra,
});
const ACCOUNTS: Account[] = [
  acct("chk", "Joint Checking (0101)", "depository", 600000),
  acct("bro", "Brokerage (0606)", "brokerage", 1950000),
  acct("card", "Rewards Card (0303)", "credit", -120000),
  acct("ira", "Roth IRA (0707)", "retirement", 1200000),
  // The archived twin carries the SAME balance as its live row on purpose: a
  // feed can put a balance on a superseded record, and the head must not
  // count it twice.
  acct("old", "Joint Checking (...0101)", "depository", 600000, { archived: true }),
  // An account that is live, has a balance, and is deliberately not counted.
  acct("cl", "Partner Savings (0404)", "depository", 4500000, { includeInSpend: false, owner: "partner" }),
];
const BALANCES: AccountBalance[] = ACCOUNTS.map((a) => ({ accountId: a.id, balanceCents: a.balanceCents!, asOf: "2026-09-02" }));

const layer = (accounts: Account[], balances: AccountBalance[]) => ({
  loadDb: async () => ({}) as never,
  getAccounts: async () => accounts,
  getAccountBalances: async () => balances,
});

describe("AccountsBalances", () => {
  test("shows what you have: drawable groups, held back, and both totals", async () => {
    // Balances come only from the synced balance list, so the screen must pass it through.
    const bare = ACCOUNTS.map(({ balanceCents: _drop, ...a }) => a as Account);
    render(<AccountsBalances dataLayer={layer(bare, BALANCES)} />);
    // $ always and a minus sign for what is owed.
    expect((await screen.findByTestId("position-drawable")).textContent).toBe("$24,300.00");
    // Held back is its own folding group, below the drawable ones.
    const held = screen.getByRole("button", { name: /Held back/ }).closest("[data-slot=card]")!;
    expect(within(held as HTMLElement).getByText("Roth IRA (0707)")).toBeTruthy();
    expect(screen.getByText("All holdings")).toBeTruthy();
  });

  test("each group folds shut and opens again from its name", async () => {
    const user = userEvent.setup();
    render(<AccountsBalances dataLayer={layer(ACCOUNTS, BALANCES)} />);
    await screen.findByTestId("position-drawable");
    const trigger = screen.getByRole("button", { name: /Held back/ });
    expect(screen.getByText("Roth IRA (0707)")).toBeTruthy();
    await user.click(trigger);
    await waitFor(() => expect(screen.queryByText("Roth IRA (0707)")).toBeNull());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(await screen.findByText("Roth IRA (0707)")).toBeTruthy();
  });

  // "Balances" was stacked three times (tab, page heading, card).
  test("names the list once", async () => {
    render(<AccountsBalances dataLayer={layer(ACCOUNTS, BALANCES)} />);
    await screen.findByTestId("position-drawable");
    expect(screen.queryAllByRole("heading", { name: "Balances" }).length).toBeLessThanOrEqual(1);
    expect(screen.queryAllByText("Balances").length).toBeLessThanOrEqual(1);
  });

  test("has no switches: which accounts count is set in Settings, Accounts", async () => {
    render(<AccountsBalances dataLayer={layer(ACCOUNTS, BALANCES)} />);
    await screen.findByTestId("position-drawable");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("link", { name: /Settings, Accounts/ }).getAttribute("href")).toBe("#/settings/accounts");
  });

  test("says so plainly when the local server cannot be reached", async () => {
    render(<AccountsBalances dataLayer={{ loadDb: async () => { throw new Error("down"); } }} />);
    expect(await screen.findByText("The local server is not reachable. Restart the app.")).toBeTruthy();
  });
});

describe("positionGroups", () => {
  test("foots to exactly what the head shows, whatever the gate excludes", () => {
    // The head uses drawableLiquidCents. If the statement ever foots to a
    // different number the app shows two drawables at once -- which is what
    // happened on first render: one total below a head saying another.
    const p = positionGroups(ACCOUNTS, BALANCES);
    expect(p.drawableTotal).toBe(drawableLiquidCents(ACCOUNTS, BALANCES));
    expect(p.drawableTotal).toBe(600000 + 1950000 - 120000);
  });

  test("shows what the gate left out, below the line, so exclusion reads as a decision", () => {
    const p = positionGroups(ACCOUNTS, BALANCES);
    expect(p.held.rows.map((r) => r.name)).toEqual(["Roth IRA (0707)"]);
    expect(p.excluded.rows.map((r) => r.name)).toEqual(["Partner Savings (0404)"]);
    expect(p.allTotal).toBe(p.drawableTotal + 1200000);
  });

  test("a card nets against cash whatever its switch says", () => {
    // Card debt is always subtracted. A card switched
    // off used to drop to "Not counted", which made drawable go UP.
    const off = ACCOUNTS.map((a) => (a.id === "card" ? { ...a, drawable: false } : a));
    const p = positionGroups(off, BALANCES);
    expect(p.drawable.find((g) => g.key === "cards")?.rows.map((r) => r.name)).toEqual(["Rewards Card (0303)"]);
    expect(p.excluded.rows.map((r) => r.name)).not.toContain("Rewards Card (0303)");
    expect(p.drawableTotal).toBe(drawableLiquidCents(off, BALANCES));
  });

  test("names in the statement drop the bank's doubled closing bracket", () => {
    const doubled = [acct("x", "Rewards Savings (0202))", "depository", 1000)];
    const p = positionGroups(doubled, [{ accountId: "x", balanceCents: 1000, asOf: "2026-09-02" }]);
    const names = p.drawable.flatMap((g) => g.rows.map((r) => r.name));
    expect(names).toEqual(["Rewards Savings (0202)"]);
  });

  test("leaves archived records out of the statement", () => {
    const names = positionGroups(ACCOUNTS, BALANCES).drawable.flatMap((g) => g.rows.map((r) => r.name));
    expect(names).not.toContain("Joint Checking (...0101)");
  });
});

// Moved from the Net worth table when Accounts became one page.
describe("AccountsBalances account wording", () => {
  test("drops the bank's doubled bracket from an account name", async () => {
    const odd = ACCOUNTS.map((a, i) => (i === 0 ? { ...a, name: "Rewards Savings (0202))" } : a));
    render(<AccountsBalances dataLayer={layer(odd, BALANCES)} />);
    expect(await screen.findByText("Rewards Savings (0202)")).toBeTruthy();
    expect(screen.queryByText("Rewards Savings (0202))")).toBeNull();
  });
});
