// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { render, waitFor, fireEvent, cleanup } from "@testing-library/react";

import AccountsSection, { type AccountsDataLayer } from "../../src/ui/AccountsSection";
import type { Account } from "../../src/domain/types";
import type { AccountBalance } from "../../src/domain/plan-types";
import type { Db } from "../../src/ui/lib/db";
import { parseLedgerQuery } from "../../src/ui/lib/ledger-link";
import { configurePeriodStore, pickPeriod, syncPeriodFromHash } from "../../src/ui/lib/period-store";
import { resolvePeriod } from "../../src/domain/period";
import { demoHousehold } from "../demo";

// This repo's convention (see GoalsSection.test.tsx's header comment):
// clean up explicitly since vitest.config.ts has no `globals: true`, so
// @testing-library/react's implicit afterEach(cleanup) doesn't fire.
afterEach(cleanup);

test("account activity uses the hand-picked period after a different ledger was open", async () => {
  window.localStorage.clear();
  configurePeriodStore({ asOf: () => "2026-09-20" });
  window.history.replaceState(null, "", "#/reports");
  syncPeriodFromHash();
  pickPeriod(resolvePeriod("last-3", "2026-09-20"));
  window.history.replaceState(null, "", "#/transactions?ledger=1&from=2026-08-01&to=2026-08-31");
  syncPeriodFromHash();
  window.history.replaceState(null, "", "#/accounts");
  const { dataLayer } = makeStubDataLayer([CHECKING]);
  const { findByText } = render(<AccountsSection dataLayer={dataLayer} />);
  const name = await findByText(CHECKING.name);
  const parsed = parseLedgerQuery(new URLSearchParams(name.closest("a")!.getAttribute("href")!.split("?")[1]));
  expect(parsed.initialFilter.from).toBe("2026-07-01");
  expect(parsed.initialFilter.to).toBe("2026-09-20");
});

const CHECKING: Account = {
  id: "a1",
  name: "Joint Checking",
  type: "depository",
  institution: "Pinecrest Example Bank",
  currency: "USD",
  isOwned: true,
  includeInSpend: true,
  owner: "joint",
};

const IRA: Account = {
  id: "a2",
  name: "Roth IRA",
  type: "brokerage",
  institution: "Ridgeline Example Investments",
  currency: "USD",
  isOwned: true,
  includeInSpend: true,
  owner: "me",
};

const CARD: Account = {
  id: "a3",
  name: "Rewards Card",
  type: "credit",
  institution: "Lakeshore Example Credit Union",
  currency: "USD",
  isOwned: true,
  includeInSpend: true,
  owner: "me",
  // A stored "off" from an earlier version; it must be ignored.
  drawable: false,
};

const BALANCES: AccountBalance[] = [
  { accountId: "a1", balanceCents: 500_000, asOf: "2026-08-31T00:00:00.000Z" },
  { accountId: "a2", balanceCents: 2_000_000, asOf: "2026-08-31T00:00:00.000Z" },
  { accountId: "a3", balanceCents: -135_000, asOf: "2026-08-31T00:00:00.000Z" },
];

function makeStubDataLayer(initialAccounts: Account[], initialIncludePartner = false) {
  let accounts = [...initialAccounts];
  let includePartner = initialIncludePartner;

  const getAccountsManage = vi.fn(async () => accounts);
  const getAccountBalances = vi.fn(async () => BALANCES);
  const getHousehold = vi.fn(async () => demoHousehold());
  const getIncludePartner = vi.fn(async () => includePartner);
  const setIncludePartner = vi.fn(async (_db: Db, next: boolean) => {
    includePartner = next;
  });
  const setAccountOwner = vi.fn(async (_db: Db, id: string, owner: Account["owner"]) => {
    accounts = accounts.map((a) => (a.id === id ? { ...a, owner } : a));
  });
  const setAccountDrawable = vi.fn(async (_db: Db, _id: string, _drawable: boolean | null) => {});
  const setAccountArchived = vi.fn(async (_db: Db, id: string, archived: boolean) => {
    accounts = accounts.map((a) => (a.id === id ? { ...a, archived } : a));
  });
  const setAccountInclude = vi.fn(async (_db: Db, id: string, includeInSpend: boolean) => {
    accounts = accounts.map((a) => (a.id === id ? { ...a, includeInSpend } : a));
  });

  const dataLayer: Partial<AccountsDataLayer> = {
    loadDb: async () => ({}) as Db,
    getAccountsManage,
    getAccountBalances,
    getHousehold,
    getIncludePartner,
    setIncludePartner,
    setAccountOwner,
    setAccountInclude,
    setAccountDrawable,
    setAccountArchived,
  };

  return {
    dataLayer,
    getAccountsManage,
    getAccountBalances,
    getIncludePartner,
    setIncludePartner,
    setAccountOwner,
    setAccountInclude,
    setAccountDrawable,
    setAccountArchived,
  };
}

// The short name leads; the bank's own name sits under it
// so each row can still be matched to the bank.
test("shows the short name, with the bank's name under it when they differ", async () => {
  const caps: Account = { ...CHECKING, id: "caps", name: "PERSONAL CHECKING (0101)" };
  const { dataLayer } = makeStubDataLayer([caps, CHECKING]);
  const view = render(<AccountsSection dataLayer={dataLayer} />);
  expect(await view.findByText("Personal Checking (0101)")).toBeTruthy();
  expect(view.getByText("PERSONAL CHECKING (0101)").className).toMatch(/text-xs/);
  expect(view.getAllByText("Joint Checking").length).toBe(1);
});

test("renders accounts with owner + balance; the include switch reflects the setting and flipping it saves it", async () => {
  const { dataLayer, setIncludePartner } = makeStubDataLayer([CHECKING, IRA], false);
  const { findByText, getAllByText, getByText, getByLabelText } = render(<AccountsSection dataLayer={dataLayer} />);

  await findByText("Joint Checking");
  await findByText("Roth IRA");
  // $5,000.00 (Joint Checking's balance) appears twice: once in the summary
  // card's drawable reading (the Roth IRA is a retirement account, so it's
  // excluded from drawable liquid either way) and once in the account row.
  expect(getAllByText("$5,000.00").length).toBeGreaterThanOrEqual(2);
  expect(getByText("$20,000.00")).toBeTruthy();

  // includePartner starts false -> the "partner excluded" reading is the highlighted/current one.
  await findByText("Drawable, without Sam's accounts");
  await findByText("Drawable, with Sam's accounts");
  expect(document.body.textContent).not.toMatch(/drawable liquid/i);

  fireEvent.click(getByLabelText("Include Sam's accounts"));

  await waitFor(() => {
    expect(setIncludePartner).toHaveBeenCalledWith(expect.anything(), true);
  });
});

test("changing an account's owner calls setAccountOwnerUI, and toggling Counted? calls setAccountIncludeUI", async () => {
  const { dataLayer, setAccountOwner, setAccountInclude } = makeStubDataLayer([CHECKING, IRA]);
  const { findByText, getByLabelText } = render(<AccountsSection dataLayer={dataLayer} />);

  await findByText("Joint Checking");

  // The owner choice reads the partner's name from the household.
  const choice = getByLabelText("Set Joint Checking owner to Sam");
  expect(choice.textContent).toBe("Sam");
  expect(getByLabelText("Set Joint Checking owner to Alex").textContent).toBe("Alex");
  fireEvent.click(getByLabelText("Set Joint Checking owner to Sam"));
  await waitFor(() => {
    expect(setAccountOwner).toHaveBeenCalledWith(expect.anything(), "a1", "partner");
  });

  fireEvent.click(getByLabelText("Counted: Joint Checking"));
  await waitFor(() => {
    expect(setAccountInclude).toHaveBeenCalledWith(expect.anything(), "a1", false);
  });
});

test("an account that isn't counted as cash says so, and a retirement account starts that way", async () => {
  const { dataLayer } = makeStubDataLayer([CHECKING, IRA]);
  const { findByText } = render(<AccountsSection dataLayer={dataLayer} />);

  await findByText("Roth IRA");
  // The badge now reports the EFFECTIVE state rather than asserting a fixed
  // rule about retirement: whether an IRA is spendable is the user's call, and
  // the switch beside it can change the answer.
  await findByText(/Not counted as cash/);
});

test("switching an account's Drawable flag calls through and updates the row immediately", async () => {
  const { dataLayer, setAccountDrawable } = makeStubDataLayer([CHECKING, IRA]);
  const { findByLabelText, queryByText } = render(<AccountsSection dataLayer={dataLayer} />);

  const toggle = await findByLabelText("Drawable: Roth IRA");
  expect(toggle.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(toggle);
  await waitFor(() => expect(setAccountDrawable).toHaveBeenCalledWith(expect.anything(), IRA.id, true));
  // Turning it on removes the "not counted" badge without a reload.
  await waitFor(() => expect(queryByText(/Not counted as cash/)).toBeNull());
});

test("a card has no Drawable switch: its balance is always subtracted", async () => {
  // The switch let a card be turned off, which stopped
  // subtracting its debt and made drawable go up. A stored "off" is ignored.
  const { dataLayer } = makeStubDataLayer([CHECKING, CARD]);
  const { findByText, queryByLabelText, queryByText, getAllByText } = render(<AccountsSection dataLayer={dataLayer} />);

  await findByText("Rewards Card");
  expect(queryByLabelText("Drawable: Rewards Card")).toBeNull();
  await findByText("Always subtracted");
  expect(queryByText(/Not counted as cash/)).toBeNull();
  // $5,000.00 less the $1,350.00 owed, in both summary readings.
  expect(getAllByText("$3,650.00").length).toBe(2);
});

test("renders a neutral not-connected state headlessly when the db is unreachable", async () => {
  const dataLayer: Partial<AccountsDataLayer> = {
    loadDb: async () => {
      throw new Error("no server connection");
    },
  };
  const { findByText } = render(<AccountsSection dataLayer={dataLayer} />);
  await findByText("Not connected");
});

const LEGACY: Account = {
  id: "legacy-a1",
  name: "Joint Checking (...0101)",
  type: "depository",
  institution: "Pinecrest Example Bank",
  currency: "USD",
  isOwned: true,
  includeInSpend: true,
  owner: "joint",
  archived: true,
};

test("hides archived accounts so the list shows one row per real account", async () => {
  // The SimpleFIN cutover left a legacy row beside each live account
  // -- roughly twice the rows as real accounts. The legacy row still owns its history,
  // so it is hidden rather than deleted.
  const { dataLayer } = makeStubDataLayer([CHECKING, LEGACY]);
  const { findByText, queryByText } = render(<AccountsSection dataLayer={dataLayer} />);
  await findByText("Joint Checking");
  expect(queryByText("Joint Checking (...0101)")).toBeNull();
});

test("can reveal archived accounts, and says how many are hidden", async () => {
  const { dataLayer } = makeStubDataLayer([CHECKING, LEGACY]);
  const { findByText, findByLabelText } = render(<AccountsSection dataLayer={dataLayer} />);
  await findByText("Joint Checking");
  fireEvent.click(await findByLabelText("Show archived accounts"));
  await findByText("Joint Checking (...0101)");
});

test("archiving an account calls through and does not change whether it is counted", async () => {
  // Archiving is presentational. If it silently dropped the account from
  // spending, every total would move and nothing would say so.
  const { dataLayer, setAccountArchived, setAccountInclude } = makeStubDataLayer([CHECKING]);
  const { findByLabelText } = render(<AccountsSection dataLayer={dataLayer} />);
  fireEvent.click(await findByLabelText("Archive Joint Checking"));
  await waitFor(() => expect(setAccountArchived).toHaveBeenCalledWith(expect.anything(), "a1", true));
  expect(setAccountInclude).not.toHaveBeenCalled();
});

// An account's figure here is a BALANCE, not a sum of transactions,
// so its name opens the account's activity and the ledger says it is not the balance.
test("an account name opens that account's activity over the period, transfers included, claiming no total", async () => {
  const { dataLayer } = makeStubDataLayer([CHECKING, IRA], false);
  const { findByText } = render(
    <AccountsSection dataLayer={dataLayer} period={{ preset: "custom", from: "2026-08-01", to: "2026-08-31" }} />
  );
  const name = await findByText(CHECKING.name);
  const link = name.closest("a[data-ledger]")!;
  expect(link).not.toBeNull();
  const parsed = parseLedgerQuery(new URLSearchParams(link.getAttribute("href")!.split("?")[1]));
  expect(parsed.initialFilter).toEqual({ accountIds: [CHECKING.id], transfers: "include", from: "2026-08-01", to: "2026-08-31" });
  expect(parsed.initialFilter.countedAccountsOnly).toBeUndefined();
  expect(parsed.ledger).toEqual({ label: CHECKING.name, back: "#/settings/accounts", view: "account" });
});

test("the settings screen says what it sets", async () => {
  const { dataLayer } = makeStubDataLayer([CHECKING]);
  const { findByText } = render(<AccountsSection dataLayer={dataLayer} />);
  expect(await findByText(/^Which accounts count toward spending, and toward the cash you can use\./)).toBeTruthy();
});

test("an account row reads its type in words and drops the bank's doubled bracket", async () => {
  const doubled: Account = { ...IRA, id: "a9", name: "Rewards Savings (0202))", type: "depository", owner: "me" };
  const { dataLayer } = makeStubDataLayer([CHECKING, doubled]);
  const { findByText, getAllByText, queryByText } = render(<AccountsSection dataLayer={dataLayer} />);
  await findByText("Rewards Savings (0202)");
  expect(await findByText("Grouped by owner: you, shared, then Sam.")).toBeTruthy();
  expect(queryByText("Rewards Savings (0202))")).toBeNull();
  expect(getAllByText("Cash").length).toBeGreaterThan(0);
  expect(queryByText("depository")).toBeNull();
});

// The charity pot: a "Charity account" switch on each row, one
// at a time, and on the flagged row a box for the floor kept in it.
function makePotLayer(initial: Account[], floorCents = 0) {
  const base = makeStubDataLayer(initial);
  let accounts = [...initial];
  base.getAccountsManage.mockImplementation(async () => accounts);
  const setAccountMaaserPot = vi.fn(async (_db: Db, id: string, on: boolean) => {
    accounts = accounts.map((a) => ({ ...a, maaserPot: a.id === id ? on : on ? false : a.maaserPot }));
  });
  const getMaaserFloor = vi.fn(async () => floorCents);
  const setMaaserFloor = vi.fn(async (_db: Db, cents: number) => {
    floorCents = cents;
  });
  return { dataLayer: { ...base.dataLayer, setAccountMaaserPot, getMaaserFloor, setMaaserFloor }, setAccountMaaserPot, setMaaserFloor };
}
const POT: Account = { ...CHECKING, id: "pot", name: "Giving", owner: "me", includeInSpend: false };

test("switching Charity account on marks that row alone and shows the floor box", async () => {
  const { dataLayer, setAccountMaaserPot } = makePotLayer([CHECKING, POT]);
  const view = render(<AccountsSection dataLayer={dataLayer} />);
  await view.findByText("Giving");
  expect(view.queryByLabelText("Keep at least in Giving")).toBeNull();
  fireEvent.click(view.getByLabelText("Charity account: Giving"));
  await waitFor(() => expect(setAccountMaaserPot).toHaveBeenCalledWith(expect.anything(), "pot", true));
  expect(await view.findByLabelText("Keep at least in Giving")).toBeTruthy();
  expect((view.getByLabelText("Charity account: Giving") as HTMLInputElement).checked ?? view.getByLabelText("Charity account: Giving").getAttribute("aria-checked")).toBeTruthy();
  fireEvent.click(view.getByLabelText("Charity account: Joint Checking"));
  await waitFor(() => expect(setAccountMaaserPot).toHaveBeenCalledWith(expect.anything(), "a1", true));
  await waitFor(() => expect(view.queryByLabelText("Keep at least in Giving")).toBeNull());
  expect(view.getByLabelText("Keep at least in Joint Checking")).toBeTruthy();
});

test("the floor box saves whole dollars on Enter and refuses anything else in words", async () => {
  const { dataLayer, setMaaserFloor } = makePotLayer([CHECKING, { ...POT, maaserPot: true }], 100000);
  const view = render(<AccountsSection dataLayer={dataLayer} />);
  const box = (await view.findByLabelText("Keep at least in Giving")) as HTMLInputElement;
  expect(box.value).toBe("1000.00");
  fireEvent.change(box, { target: { value: "1500" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(setMaaserFloor).toHaveBeenCalledWith(expect.anything(), 150000));
  expect(await view.findByText("Saved.")).toBeTruthy();
  fireEvent.change(box, { target: { value: "lots" } });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(await view.findByText(/Type dollars/)).toBeTruthy();
  expect(setMaaserFloor).toHaveBeenCalledTimes(1);
});

test("an archived row keeps its Charity account switch when a live row is switched on, and has no floor box", async () => {
  const OLD: Account = { ...POT, id: "old", name: "Giving (...0505)", archived: true, maaserPot: true };
  const { dataLayer, setAccountMaaserPot } = makePotLayer([CHECKING, POT, OLD], 150000);
  const view = render(<AccountsSection dataLayer={dataLayer} />);
  await view.findByText("Giving");
  fireEvent.click(await view.findByLabelText("Show archived accounts"));
  const oldSwitch = await view.findByLabelText(/^Charity account: Giving \(/);
  expect(oldSwitch.getAttribute("aria-checked")).toBe("true");
  expect(view.queryByLabelText("Keep at least in Giving (...0505)")).toBeNull();
  fireEvent.click(view.getByLabelText("Charity account: Giving"));
  await waitFor(() => expect(setAccountMaaserPot).toHaveBeenCalledWith(expect.anything(), "pot", true));
  expect(view.getByLabelText(/^Charity account: Giving \(/).getAttribute("aria-checked")).toBe("true");
  expect(await view.findByLabelText("Keep at least in Giving")).toBeTruthy();
});
