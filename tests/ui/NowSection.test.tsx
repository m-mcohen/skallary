// @vitest-environment jsdom
// tests/ui/NowSection.test.tsx
//
// Now is the first thing on screen. Two properties matter: the inbox writes a
// rule the same way the review queue does (so the app never asks about a
// merchant twice), and the position statement foots to the drawable figure the
// head shows, with retirement below the line rather than missing.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { Toaster } from "../../src/components/ui/sonner";

import NowSection from "../../src/ui/NowSection";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { Db, SeedStatus } from "../../src/ui/lib/db";

beforeAll(() => {
  // jsdom has no pointer capture; sonner calls it when a toast is pressed.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

afterEach(() => {
  act(() => toast.dismiss());
  cleanup();
});

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
const BALANCES = ACCOUNTS.map((a) => ({ accountId: a.id, balanceCents: a.balanceCents!, asOf: "2026-09-02" }));
const ROW: NormalizedTxn = {
  sourceTransactionId: "sf-1", accountId: "chk", date: "2026-09-01", amountCents: -1800,
  sourceCategory: null, merchant: null, isTransfer: false, sourceUpdatedAt: null,
  payee: "Homestead Renters Mutual", description: "HOMESTEAD RENTERS MUTUAL", memo: "", mcc: null, pending: false,
};

function stub(queue: NormalizedTxn[], seed?: SeedStatus) {
  let q = [...queue];
  const status: SeedStatus = seed ?? { lastSeedAt: "2026-09-02T18:07:00.000Z", windowMonths: 12, reseedDueAt: "2026-12-01", reseedDue: false };
  // One call per filing, with Undo.
  const fileCategorization = vi.fn(async () => { q = []; return { id: 5 }; });
  const undoCategorization = vi.fn(async () => { q = [...queue]; return { undone: true }; });
  const getUncategorized = vi.fn(async () => q);
  const createCategory = vi.fn(async () => {});
  const getSeedStatus = vi.fn(async () => status);
  const dataLayer = {
    loadDb: async () => ({}) as Db,
    getAccounts: async () => ACCOUNTS,
    getAccountBalances: async () => BALANCES,
    getUncategorized,
    getCategories: async () => ["Groceries", "Renter's Insurance"],
    fileCategorization,
    undoCategorization,
    // For This repeats: the rows, rules and choices the recurring finder reads.
    getTransactions: async () => queue,
    getRules: async () => [],
    getAdjustments: async () => [],
    getCategoryMappings: async () => ({}),
    getRecurringChoices: async () => [],
    createCategory,
    getSeedStatus,
  };
  return { dataLayer, fileCategorization, undoCategorization, getUncategorized, createCategory, getSeedStatus };
}

describe("NowSection", () => {
  test("is only Waiting on you now: the balance sheet moved to Accounts, Balances", async () => {
    const { dataLayer } = stub([]);
    render(<NowSection dataLayer={dataLayer} />);
    expect(await screen.findByText(/Every transaction has a home/)).toBeTruthy();
    expect(screen.queryByTestId("position-drawable")).toBeNull();
    expect(screen.queryByText("Position")).toBeNull();
  });

  test("files an inbox row as a rule on its payee, then tells the head to refresh", async () => {
    const { dataLayer, fileCategorization } = stub([ROW]);
    const onChanged = vi.fn();
    const { findByLabelText, findByTestId } = render(<NowSection dataLayer={dataLayer} onChanged={onChanged} />);
    expect((await findByTestId("inbox-count")).textContent).toBe("1");
    const user = userEvent.setup();
    await user.type(await findByLabelText("File Homestead Renters Mutual as"), "Renter");
    await user.click(await screen.findByRole("option", { name: "Renter's Insurance" }));
    await waitFor(() => expect(fileCategorization).toHaveBeenCalledTimes(1));
    const f = (fileCategorization.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(f.rule).toMatchObject({ payeeContains: "homestead renters mutual", action: "categorize", toCategory: "Renter's Insurance", priority: 100 });
    expect(f).toMatchObject({ sourceTransactionId: "sf-1", label: "Homestead Renters Mutual", fromCategory: "Uncategorized", toCategory: "Renter's Insurance", adjustment: null });
    expect(f).not.toHaveProperty("note");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect((await findByTestId("inbox-count")).textContent).toBe("0");
  });

  test("files an inbox row under a category that did not exist: records it, then the rule ", async () => {
    const { dataLayer, fileCategorization, createCategory } = stub([ROW]);
    const { findByLabelText } = render(<NowSection dataLayer={dataLayer} />);
    const user = userEvent.setup();
    await user.type(await findByLabelText("File Homestead Renters Mutual as"), "Pets");
    await user.click(await screen.findByRole("option", { name: 'Create "Pets"' }));
    await waitFor(() => expect(fileCategorization).toHaveBeenCalled());
    expect(createCategory).toHaveBeenCalledWith(expect.anything(), "Pets");
    expect(createCategory.mock.invocationCallOrder[0]).toBeLessThan(fileCategorization.mock.invocationCallOrder[0]);
    expect(((fileCategorization.mock.calls[0] as unknown[])[1] as { rule: unknown }).rule).toMatchObject({ action: "categorize", toCategory: "Pets" });
  });

  test("says so plainly when nothing is waiting", async () => {
    const { dataLayer } = stub([]);
    const { findByText } = render(<NowSection dataLayer={dataLayer} />);
    expect(await findByText(/Every transaction has a home/)).toBeTruthy();
  });

  // Review your budget replaces Re-seed. The row links
  // to Set up budget, where nothing changes until the user applies; Apply restarts the clock.
  test("a review older than ninety days waits on the user and links to Set up budget", async () => {
    const { dataLayer } = stub([], {
      lastSeedAt: "2026-06-01T12:00:00.000Z", windowMonths: 12, reseedDueAt: "2026-08-30", reseedDue: true,
    });
    const { findByTestId, findByText, findByRole, queryByRole } = render(<NowSection dataLayer={dataLayer} planId="plan1" />);
    expect(await findByText(/Budget reviewed Jun 1 · review due/)).toBeTruthy();
    expect((await findByTestId("inbox-count")).textContent).toBe("1");
    const link = await findByRole("link", { name: "Review your budget" });
    expect(link.getAttribute("href")).toBe("#/budget/month?setup=1");
    expect(queryByRole("button", { name: /Re-seed/ })).toBeNull();
  });

  test("a budget never reviewed says so", async () => {
    const { dataLayer } = stub([], { lastSeedAt: null, windowMonths: null, reseedDueAt: null, reseedDue: true });
    const { findByText } = render(<NowSection dataLayer={dataLayer} planId="plan1" />);
    expect(await findByText(/Budget never reviewed · review due/)).toBeTruthy();
  });

  test("stays quiet about the review when it is fresh", async () => {
    const { dataLayer } = stub([]);
    const { findByText, queryByText } = render(<NowSection dataLayer={dataLayer} planId="plan1" />);
    await findByText(/Every transaction has a home/);
    expect(queryByText(/review due/i)).toBeNull();
    expect(queryByText(/re-seed/i)).toBeNull();
  });
});

// The note, This repeats, Undo, and a refused filing.
describe("NowSection filing extras", () => {
  test("a note typed before the pick is filed with it", async () => {
    const { dataLayer, fileCategorization } = stub([ROW]);
    render(<NowSection dataLayer={dataLayer} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("File Homestead Renters Mutual as"), "Renter");
    await user.type(await screen.findByRole("textbox", { name: "Note" }), "Reimbursed by work");
    await user.click(await screen.findByRole("option", { name: "Renter's Insurance" }));
    await waitFor(() => expect(fileCategorization).toHaveBeenCalledTimes(1));
    expect(((fileCategorization.mock.calls[0] as unknown[])[1] as { note: string }).note).toBe("Reimbursed by work");
  });

  test("money going out offers This repeats, and ticking it files the mark", async () => {
    const { dataLayer, fileCategorization } = stub([ROW]);
    render(<NowSection dataLayer={dataLayer} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("File Homestead Renters Mutual as"), "Renter");
    await user.click(await screen.findByRole("checkbox", { name: "This repeats" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "How often" }), "annual");
    await user.click(await screen.findByRole("option", { name: "Renter's Insurance" }));
    await waitFor(() => expect(fileCategorization).toHaveBeenCalledTimes(1));
    expect(((fileCategorization.mock.calls[0] as unknown[])[1] as { recurring: unknown }).recurring).toEqual({
      action: "save",
      choice: { payeeKey: "homestead renters mutual", accountId: "chk", choice: "recurring", cadence: "annual", label: "Homestead Renters Mutual" },
    });
  });

  test("money coming in offers no This repeats", async () => {
    const { dataLayer } = stub([{ ...ROW, amountCents: 50000, payee: "Refund Co" }]);
    render(<NowSection dataLayer={dataLayer} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("File Refund Co as"), "Gro");
    await screen.findByRole("textbox", { name: "Note" });
    expect(screen.queryByRole("checkbox", { name: "This repeats" })).toBeNull();
  });

  test("the toast's Undo calls the server with the filing's id, then re-reads the list and the head", async () => {
    const { dataLayer, undoCategorization, getUncategorized } = stub([ROW]);
    const onChanged = vi.fn();
    render(
      <>
        <NowSection dataLayer={dataLayer} onChanged={onChanged} />
        <Toaster />
      </>
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("File Homestead Renters Mutual as"), "Renter");
    await user.click(await screen.findByRole("option", { name: "Renter's Insurance" }));
    const message = await screen.findByText("Filed Homestead Renters Mutual as Renter's Insurance.");
    const reads = getUncategorized.mock.calls.length;
    await user.click(within(message.closest("[data-sonner-toast]") as HTMLElement).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undoCategorization).toHaveBeenCalledWith(expect.anything(), 5));
    await waitFor(() => expect(getUncategorized.mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    expect((await screen.findByTestId("inbox-count")).textContent).toBe("1");
  });

  test("a refused filing shows the server's words and the row stays", async () => {
    const { dataLayer } = stub([ROW]);
    dataLayer.fileCategorization = vi.fn(async () => {
      throw new Error("This transaction has no merchant name, so it cannot become a rule.");
    });
    render(<NowSection dataLayer={dataLayer} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("File Homestead Renters Mutual as"), "Renter");
    await user.click(await screen.findByRole("option", { name: "Renter's Insurance" }));
    expect(await screen.findByText("This transaction has no merchant name, so it cannot become a rule.")).toBeTruthy();
    expect((await screen.findByTestId("inbox-count")).textContent).toBe("1");
  });
});

// Review fixes, findings 1 and 3.
describe("NowSection filing extras, data that arrives late or already exists", () => {
  test("a merchant already recurring, read after the row is drawn, is filed with its mark left alone", async () => {
    // Three monthly payments make Homestead Renters Mutual a recurring charge the app found.
    // The finder drops a found series that has gone a cycle past its next date (1183b06), so
    // the clock is pinned to just after the last payment; the test then holds on any real day.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-05T12:00:00") });
    try {
      const history = ["2026-06-01", "2026-07-01", "2026-08-01"].map((date, i) => ({ ...ROW, sourceTransactionId: `old-${i}`, date, sourceCategory: "Insurance" }));
      const { dataLayer, fileCategorization } = stub([ROW]);
      let release: () => void = () => {};
      const late = new Promise<void>((r) => (release = r));
      dataLayer.getTransactions = async () => {
        await late;
        return [...history, ROW];
      };
      render(<NowSection dataLayer={dataLayer} />);
      const user = userEvent.setup();
      await screen.findByLabelText("File Homestead Renters Mutual as");
      release();
      await user.type(await screen.findByLabelText("File Homestead Renters Mutual as"), "Renter");
      expect(((await screen.findByRole("checkbox", { name: "This repeats" })) as HTMLInputElement).checked).toBe(true);
      await user.click(await screen.findByRole("option", { name: "Renter's Insurance" }));
      await waitFor(() => expect(fileCategorization).toHaveBeenCalledTimes(1));
      expect((fileCategorization.mock.calls[0] as unknown[])[1]).not.toHaveProperty("recurring");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a note the row already has shows in the box; clearing it deletes it", async () => {
    const { dataLayer, fileCategorization } = stub([ROW]);
    Object.assign(dataLayer, { getNotes: async () => [{ sourceTransactionId: "sf-1", note: "Claim number 4417", updatedAt: "x" }] });
    render(<NowSection dataLayer={dataLayer} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("File Homestead Renters Mutual as"), "Renter");
    const box = (await screen.findByRole("textbox", { name: "Note" })) as HTMLInputElement;
    await waitFor(() => expect(box.value).toBe("Claim number 4417"));
    await user.clear(box);
    await user.click(await screen.findByRole("option", { name: "Renter's Insurance" }));
    await waitFor(() => expect(fileCategorization).toHaveBeenCalledTimes(1));
    expect(((fileCategorization.mock.calls[0] as unknown[])[1] as { note: string }).note).toBe("");
  });

  test("an existing note left as it is is not sent", async () => {
    const { dataLayer, fileCategorization } = stub([ROW]);
    Object.assign(dataLayer, { getNotes: async () => [{ sourceTransactionId: "sf-1", note: "Claim number 4417", updatedAt: "x" }] });
    render(<NowSection dataLayer={dataLayer} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("File Homestead Renters Mutual as"), "Renter");
    await waitFor(async () => expect(((await screen.findByRole("textbox", { name: "Note" })) as HTMLInputElement).value).toBe("Claim number 4417"));
    await user.click(await screen.findByRole("option", { name: "Renter's Insurance" }));
    await waitFor(() => expect(fileCategorization).toHaveBeenCalledTimes(1));
    expect((fileCategorization.mock.calls[0] as unknown[])[1]).not.toHaveProperty("note");
  });
});
