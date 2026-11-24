// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, waitFor, fireEvent, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ConnectorSection, { type ConnectorDataLayer } from "../../src/ui/ConnectorSection";
import type { ConnectorStatus, Db, SyncSummary } from "../../src/ui/lib/db";
import type { NormalizedTxn } from "../../src/domain/types";
import type { CategorizationRule } from "../../src/domain/rules";

// This repo's convention (see GoalsSection.test.tsx): clean up explicitly,
// since vitest.config.ts has no `globals: true`.
afterEach(cleanup);

const DB = {} as Db;

const baseStatus: ConnectorStatus = {
  connected: false,
  lastSyncedAt: null,
  earliestBackfilled: null,
  lastErrors: [],
  accountsNeedingType: [],
  setupTokenPath: "C:\\Users\\test\\AppData\\Local\\finance\\simplefin-token.txt",
};

function makeStub(over: Partial<ConnectorStatus> = {}, queue: NormalizedTxn[] = [], rules: CategorizationRule[] = []) {
  const status = { ...baseStatus, ...over };
  const connect = vi.fn(async () => ({ connected: true, alreadyConnected: false }));
  const reconnect = vi.fn(async () => ({ reconnected: true as const }));
  const disconnect = vi.fn(async () => { status.connected = false; });
  const sync = vi.fn(async (): Promise<SyncSummary> => ({
    inserted: 12, updated: 3, accounts: 4, holdings: 1, errors: [], needsReconnect: false, skipped: 0,
  }));
  const setAccountType = vi.fn(async () => {});
  const bootstrapRules = vi.fn(async () => ({ created: 7 }));
  const rederiveRules = vi.fn(async () => ({ removed: 100, created: 400 }));
  const deleteRule = vi.fn(async () => {});
  const addRule = vi.fn(async () => 1);
  const dataLayer: ConnectorDataLayer = {
    loadDb: async () => DB,
    getConnectorStatus: async () => status,
    connect,
    reconnect,
    disconnect,
    sync,
    setAccountType,
    getUncategorized: async () => queue,
    getRules: async () => rules,
    addRule,
    deleteRule,
    bootstrapRules,
    rederiveRules,
  };
  return { dataLayer, connect, reconnect, disconnect, sync, setAccountType, bootstrapRules, rederiveRules, deleteRule, addRule };
}

describe("connection state", () => {
  test("disconnect asks first and disappears when the bank is no longer connected", async () => {
    const { dataLayer, disconnect } = makeStub({ connected: true });
    render(<ConnectorSection dataLayer={dataLayer} />);
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Disconnect" });
    await user.click(button);
    const dialog = within(await screen.findByRole("alertdialog", { name: "Stop syncing your banks?" }));
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(disconnect).not.toHaveBeenCalled();
    await user.click(button);
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Disconnect" }));
    await screen.findByText("Not connected");
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.getByText(/Save a setup token/)).toBeTruthy();
  });

  test("tells you where to put the setup token when not connected", async () => {
    const { dataLayer } = makeStub();
    const { findByText, getByText } = render(<ConnectorSection dataLayer={dataLayer} />);
    await findByText("Not connected");
    // The token is credentials for every linked bank, so the UI points at a
    // file on disk rather than offering a paste box.
    expect(getByText(/simplefin-token\.txt/)).toBeTruthy();
  });

  test("is honest that syncing can't fetch anything newer than the daily refresh", async () => {
    const { dataLayer } = makeStub({ connected: true, lastSyncedAt: "2026-09-02T12:00:00.000Z" });
    const { findByText } = render(<ConnectorSection dataLayer={dataLayer} />);
    // The Bridge pulls from banks once a day on its own schedule; implying a
    // click fetches live data would be a lie the feed can't back up.
    await findByText(/about once a day/i);
  });

  test("reports what a sync actually did", async () => {
    const { dataLayer, sync } = makeStub({ connected: true });
    const { findByText, getByRole } = render(<ConnectorSection dataLayer={dataLayer} />);
    await findByText("Connected");
    fireEvent.click(getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(sync).toHaveBeenCalled());
    await findByText(/Synced 4 accounts: 12 new, 3 updated\./);
  });

  test("says to reconnect when credentials are dead rather than claiming success", async () => {
    const { dataLayer } = makeStub({ connected: true });
    dataLayer.sync = async () => ({ inserted: 0, updated: 0, accounts: 0, holdings: 0, errors: [], needsReconnect: true, skipped: 0 });
    const { findByText, getByRole } = render(<ConnectorSection dataLayer={dataLayer} />);
    await findByText("Connected");
    fireEvent.click(getByRole("button", { name: "Sync now" }));
    await findByText(/needs reconnecting/i);
  });

  // The dead end gets a way out.
  describe("Reconnect", () => {
    const lostErrors = [{ code: "gen.auth", message: "SimpleFIN access was revoked or expired.", accountId: null, connectionId: null }];

    test("is not there while the connection works, nor before anything is connected", async () => {
      const a = makeStub({ connected: true });
      render(<ConnectorSection dataLayer={a.dataLayer} />);
      await screen.findByText("Connected");
      expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
      cleanup();
      const b = makeStub({ connected: false });
      render(<ConnectorSection dataLayer={b.dataLayer} />);
      await screen.findByText("Not connected");
      expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    });

    test("one bank needing a sign-in does not offer it", async () => {
      const { dataLayer } = makeStub({
        connected: true,
        lastErrors: [{ code: "con.auth", message: "Connection to Ridgeline Example Investments may need attention. Auth required", accountId: null, connectionId: "MBR-1" }],
      });
      render(<ConnectorSection dataLayer={dataLayer} />);
      // The words are the shared bank-problems list's.
      await screen.findByText("Sign in to Ridgeline Example Investments on the SimpleFIN Bridge site.");
      expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    });

    test("appears when access is really gone, says the steps, and keeps Connect off", async () => {
      const { dataLayer } = makeStub({ connected: true, accessLost: true, lastErrors: lostErrors });
      render(<ConnectorSection dataLayer={dataLayer} />);
      const button = await screen.findByRole("button", { name: "Reconnect" });
      expect((button as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(/simplefin-token\.txt/)).toBeTruthy();
      expect(screen.getByText(/Your data is kept/)).toBeTruthy();
    });

    test("pressing it reconnects, then says so and that nothing was lost", async () => {
      const { dataLayer, reconnect } = makeStub({ connected: true, accessLost: true, lastErrors: lostErrors });
      render(<ConnectorSection dataLayer={dataLayer} />);
      await userEvent.setup().click(await screen.findByRole("button", { name: "Reconnect" }));
      await waitFor(() => expect(reconnect).toHaveBeenCalledTimes(1));
      await screen.findByText("Reconnected to SimpleFIN. All your data is kept. Press Sync now to catch up.");
    });

    test("a refusal is shown in the server's words", async () => {
      const { dataLayer } = makeStub({ connected: true, accessLost: true, lastErrors: lostErrors });
      dataLayer.reconnect = async () => { throw new Error("No setup token found. Generate a new one on the SimpleFIN Bridge and save it to the file."); };
      render(<ConnectorSection dataLayer={dataLayer} />);
      await userEvent.setup().click(await screen.findByRole("button", { name: "Reconnect" }));
      await screen.findByText(/No setup token found/);
    });

    test("a sync that finds access gone now points at Reconnect, not at the disabled Connect", async () => {
      const { dataLayer } = makeStub({ connected: true });
      dataLayer.sync = async () => ({ inserted: 0, updated: 0, accounts: 0, holdings: 0, errors: [], needsReconnect: true, skipped: 0 });
      render(<ConnectorSection dataLayer={dataLayer} />);
      await screen.findByText("Connected");
      fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
      await screen.findByText(/save a new setup token.*press Reconnect/i);
    });
  });

  // Settings reads the same bank-problems list as the Sync button's box,
  // the banner and the Dashboard line, so the words are the same everywhere.
  test("a sync where one bank needs a sign-in says which bank, and still reports what came in", async () => {
    const { dataLayer } = makeStub({
      connected: true,
      lastErrors: [{ code: "con.auth", message: "Connection to Ridgeline Example Investments may need attention. Auth required", accountId: null, connectionId: "MBR-1" }],
    });
    dataLayer.sync = async () => ({
      inserted: 11, updated: 37, accounts: 16, holdings: 0, errors: [], needsReconnect: false, skipped: 0,
      signInNeeded: ["Ridgeline Example Investments"],
    });
    const { findByText, getByRole } = render(<ConnectorSection dataLayer={dataLayer} />);
    await findByText("Connected");
    fireEvent.click(getByRole("button", { name: "Sync now" }));
    await findByText("Synced 16 accounts: 11 new, 37 updated. Ridgeline Example Investments needs a sign-in.");
  });

  test("a saved sign-in warning is spelled out as the step to take, with the Bridge one click away", async () => {
    const { dataLayer } = makeStub({
      connected: true,
      lastErrors: [{
        code: "con.auth", message: "Connection to Ridgeline Example Investments may need attention. Auth required",
        accountId: null, connectionId: "MBR-1",
      }],
    });
    render(<ConnectorSection dataLayer={dataLayer} />);
    const block = await screen.findByTestId("connector-bank-problems");
    expect(block.textContent).toMatch(/1 bank needs you/);
    expect(block.textContent).toMatch(/Ridgeline Example Investments needs a sign-in\. Sign in to Ridgeline Example Investments on the SimpleFIN Bridge site\./);
    const link = within(block).getByRole("link", { name: "Open SimpleFIN Bridge" });
    expect(link.getAttribute("href")).toBe("https://beta-bridge.simplefin.org/auth/login");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  test("a quiet bank, with no warning from SimpleFIN at all, is named with its last data date", async () => {
    const { dataLayer } = makeStub({ connected: true });
    // A balance date years old is quiet whatever today is; the archived one is skipped.
    dataLayer.getAccounts = async () => [
      { id: "s1", name: "Card", type: "credit", institution: "Lakeshore Example Credit Union", currency: "USD", isOwned: true, includeInSpend: true, owner: "me", balanceDate: "2020-03-08" },
      { id: "o1", name: "Old", type: "credit", institution: "Old Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "me", balanceDate: "2020-01-01", archived: true },
    ];
    render(<ConnectorSection dataLayer={dataLayer} />);
    const block = await screen.findByTestId("connector-bank-problems");
    expect(block.textContent).toMatch(/No new data from Lakeshore Example Credit Union since Mar 8, 2020\. Check its sign-in on the SimpleFIN Bridge site\./);
    expect(block.textContent).not.toMatch(/Old Bank/);
  });

  test("no bank needs attention: no list", async () => {
    const { dataLayer } = makeStub({ connected: true });
    render(<ConnectorSection dataLayer={dataLayer} />);
    await screen.findByText("Connected");
    expect(screen.queryByTestId("connector-bank-problems")).toBeNull();
  });

  test("surfaces the feed's own warnings", async () => {
    const { dataLayer } = makeStub({
      connected: true,
      lastErrors: [{ code: "act.failed", message: "bank timeout", accountId: "a1", connectionId: null }],
    });
    const { findByText } = render(<ConnectorSection dataLayer={dataLayer} />);
    await findByText("bank timeout");
  });
});

describe("account typing", () => {
  test("lists untyped accounts with the guess, and confirming one calls through", async () => {
    const { dataLayer, setAccountType } = makeStub({
      connected: true,
      accountsNeedingType: [
        { id: "a1", name: "Rewards Card", type: null, institution: "Lakeshore Example Credit Union", currency: "USD",
          isOwned: true, includeInSpend: true, owner: "me", typeSource: "feed", suggestedType: "credit" },
      ],
    });
    const { findByText, getByLabelText } = render(<ConnectorSection dataLayer={dataLayer} />);
    await findByText("Rewards Card");
    // The guess is shown as a suggestion to confirm, never applied on its own.
    await findByText(/looks like credit/);

    fireEvent.click(getByLabelText("Card"));
    await waitFor(() => expect(setAccountType).toHaveBeenCalledWith(DB, "a1", "credit"));
  });

  test("explains why typing matters rather than just demanding it", async () => {
    const { dataLayer } = makeStub({ connected: true });
    const { findByText } = render(<ConnectorSection dataLayer={dataLayer} />);
    await findByText(/adds to or subtracts from your drawable cash/i);
  });

  test("says so when nothing needs typing", async () => {
    const { dataLayer } = makeStub({ connected: true });
    const { findByText } = render(<ConnectorSection dataLayer={dataLayer} />);
    await findByText("All accounts are typed.");
  });
});

// The review queue lives on Transactions, Needs a category. This
// screen keeps a link to it, plus the two buttons that build rules from history.
describe("review queue", () => {
  const uncategorized: NormalizedTxn[] = [
    { sourceTransactionId: "t1", accountId: "a1", date: "2026-09-01", amountCents: -90000,
      sourceCategory: null, merchant: null, isTransfer: false, sourceUpdatedAt: null,
      description: "Zelle payment", memo: "ZELLE TO SAM EXAMPLE", payee: null, mcc: null, pending: false },
  ];

  test("is one link to Transactions, Needs a category, with the count waiting", async () => {
    const { dataLayer } = makeStub({ connected: true }, uncategorized);
    render(<ConnectorSection dataLayer={dataLayer} />);
    const link = await screen.findByRole("link", { name: "Transactions, Needs a category" });
    expect(link.getAttribute("href")).toBe("#/transactions/needs-category");
    expect(await screen.findByText(/1 transaction no rule covers yet/)).toBeTruthy();
    // The queue itself (a picker per row) is gone from this screen.
    expect(screen.queryByLabelText("Category for Zelle payment")).toBeNull();
    expect(screen.queryByText("ZELLE TO SAM EXAMPLE")).toBeNull();
  });

  test("learns rules from history and reports how many, from the rules card", async () => {
    const { dataLayer, bootstrapRules } = makeStub({ connected: true }, uncategorized);
    render(<ConnectorSection dataLayer={dataLayer} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create rules from past categories" }));
    await waitFor(() => expect(bootstrapRules).toHaveBeenCalled());
    await screen.findByText(/Learned 7 rules/);
    expect(screen.getByRole("button", { name: "Rebuild learned rules" })).toBeTruthy();
  });
});

describe("rules", () => {
  const rules: CategorizationRule[] = [
    { id: 1, priority: 100, memoContains: "example", amountCents: -90000, action: "categorize", toCategory: "Rent" },
  ];

  test("describes a rule in words rather than showing raw columns", async () => {
    const { dataLayer } = makeStub({ connected: true }, [], rules);
    const { findByText } = render(<ConnectorSection dataLayer={dataLayer} />);
    await findByText(/memo contains "example" and amount -\$900\.00/);
    await findByText("Rent");
  });

  test("deletes a rule", async () => {
    const { dataLayer, deleteRule } = makeStub({ connected: true }, [], rules);
    const { findByLabelText, findByRole } = render(<ConnectorSection dataLayer={dataLayer} />);
    fireEvent.click(await findByLabelText("Delete rule 1"));
    // This action asks first; nothing happens until it is confirmed.
    expect(deleteRule).not.toHaveBeenCalled();
    fireEvent.click(await findByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(deleteRule).toHaveBeenCalledWith(DB, 1));
  });
});

describe("rules search", () => {
  const rules: CategorizationRule[] = [
    { id: 1, priority: 100, memoContains: "example", amountCents: -90000, action: "categorize", toCategory: "Rent" },
    { id: 2, priority: 400, payeeContains: "costco", action: "categorize", toCategory: "Groceries" },
    { id: 3, priority: 400, payeeContains: "shell", action: "categorize", toCategory: "Gas" },
  ];

  test("typing narrows the rules by what they match or their category", async () => {
    const { dataLayer } = makeStub({ connected: true }, [], rules);
    render(<ConnectorSection dataLayer={dataLayer} />);
    const user = userEvent.setup();
    const box = await screen.findByRole("searchbox", { name: "Search rules" });
    await user.type(box, "costco");
    expect(screen.getAllByTestId(/^rule-row-/).map((r) => r.getAttribute("data-testid"))).toEqual(["rule-row-2"]);
    await user.clear(box);
    await user.type(box, "rent");
    expect(screen.getAllByTestId(/^rule-row-/).map((r) => r.getAttribute("data-testid"))).toEqual(["rule-row-1"]);
  });

  test("no match says so", async () => {
    const { dataLayer } = makeStub({ connected: true }, [], rules);
    render(<ConnectorSection dataLayer={dataLayer} />);
    await userEvent.setup().type(await screen.findByRole("searchbox", { name: "Search rules" }), "zzz");
    expect(screen.getByText("No rule matches.")).toBeTruthy();
    expect(screen.queryAllByTestId(/^rule-row-/)).toHaveLength(0);
  });
});
