// @vitest-environment jsdom
// tests/ui/BankProblems.test.tsx
//
// Sign-in problems fail loudly. After Sync, the button reads in red and a box lists
// each bank with what to do; the page reloads only once the box is closed. A red
// banner under the top bar on every screen, from the saved state, stays until a sync
// comes back clean; the x hides it until the next sync.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SyncButton } from "../../src/ui/shell/SiteHeader";
import BankProblemsBanner from "../../src/ui/shell/BankProblemsBanner";
import { readBankProblems } from "../../src/ui/lib/useBankProblems";
import type { BankProblem } from "../../src/domain/bank-problems";

const TODAY = "2026-03-10";
const TWO: BankProblem[] = [
  { kind: "sign-in", bank: "Ridgeline Example Investments", lastDataDate: "2026-03-08" },
  { kind: "quiet", bank: "Lakeshore Example Credit Union", lastDataDate: "2026-02-25" },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try { window.sessionStorage.clear(); } catch { /* jsdom always has it */ }
});

const okSummary = { inserted: 3, updated: 5, accounts: 16, holdings: 0, errors: [], needsReconnect: false, skipped: 0 };

describe("the Sync button, after a sync with problems", () => {
  test("reads in red, lists each bank with what to do, and reloads only once the box is closed", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, summary: okSummary }))));
    const reload = vi.fn();
    const readProblems = vi.fn(async () => ({ problems: TWO, lastSyncedAt: "2026-03-10T21:00:00.000Z", today: TODAY }));
    render(<SyncButton reload={reload} readProblems={readProblems} />);

    await user.click(screen.getByRole("button", { name: /^Sync$/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("2 banks need you")).toBeTruthy();
    expect(within(dialog).getByText("Ridgeline Example Investments needs a sign-in (no new data since Mar 8)")).toBeTruthy();
    expect(within(dialog).getByText("Sign in to Ridgeline Example Investments on the SimpleFIN Bridge site.")).toBeTruthy();
    expect(within(dialog).getByText("No new data from Lakeshore Example Credit Union since Feb 25")).toBeTruthy();
    expect(within(dialog).getByText("Check its sign-in on the SimpleFIN Bridge site.")).toBeTruthy();
    const link = within(dialog).getByRole("link", { name: "Open SimpleFIN Bridge" });
    expect(link.getAttribute("href")).toBe("https://beta-bridge.simplefin.org/auth/login");
    expect(link.getAttribute("target")).toBe("_blank");

    // The button no longer looks like plain success.
    const status = screen.getByTestId("sync-problems");
    expect(status.textContent).toBe("Synced, 2 banks need you");
    expect(status.className).toMatch(/text-destructive/);

    // The page does not reload the box away before it is read.
    expect(reload).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  test("a clean sync reloads at once, with no box", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, summary: okSummary }))));
    const reload = vi.fn();
    const readProblems = vi.fn(async () => ({ problems: [], lastSyncedAt: "2026-03-10T21:00:00.000Z", today: TODAY }));
    render(<SyncButton reload={reload} readProblems={readProblems} />);
    await user.click(screen.getByRole("button", { name: /^Sync$/ }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByTestId("sync-problems")).toBeNull();
  });

  test("access gone is still the hard error, and nothing reloads", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, summary: { ...okSummary, needsReconnect: true } }))));
    const reload = vi.fn();
    const readProblems = vi.fn(async () => ({ problems: TWO, lastSyncedAt: null, today: TODAY }));
    render(<SyncButton reload={reload} readProblems={readProblems} />);
    await user.click(screen.getByRole("button", { name: /^Sync$/ }));
    expect(await screen.findByText(/Sync failed: SimpleFIN needs reconnecting/)).toBeTruthy();
    expect(readProblems).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the red banner on every screen", () => {
  test("names each bank briefly, with links to the Bridge and to Settings, Bank connection", () => {
    render(<BankProblemsBanner problems={TWO} lastSyncedAt="2026-03-10T21:00:00.000Z" today={TODAY} />);
    const banner = screen.getByTestId("bank-problems-banner");
    expect(banner.textContent).toMatch(/2 banks need you/);
    expect(banner.textContent).toMatch(/Ridgeline Example Investments needs a sign-in \(no new data since Mar 8\)/);
    expect(banner.textContent).toMatch(/No new data from Lakeshore Example Credit Union since Feb 25/);
    expect(banner.className).toMatch(/text-destructive/);
    const bridge = within(banner).getByRole("link", { name: "Open SimpleFIN Bridge" });
    expect(bridge.getAttribute("href")).toBe("https://beta-bridge.simplefin.org/auth/login");
    expect(bridge.getAttribute("target")).toBe("_blank");
    expect(within(banner).getByRole("link", { name: "Settings, Bank connection" }).getAttribute("href")).toBe("#/settings/connection");
  });

  test("shows nothing when no bank needs attention", () => {
    render(<BankProblemsBanner problems={[]} lastSyncedAt="2026-03-10T21:00:00.000Z" today={TODAY} />);
    expect(screen.queryByTestId("bank-problems-banner")).toBeNull();
  });

  test("the x hides it until the next sync; a new sync with problems shows it again", async () => {
    const user = userEvent.setup();
    render(<BankProblemsBanner problems={TWO} lastSyncedAt="2026-03-10T21:00:00.000Z" today={TODAY} />);
    await user.click(screen.getByRole("button", { name: "Hide until the next sync" }));
    expect(screen.queryByTestId("bank-problems-banner")).toBeNull();

    // Another screen, or a reload, in the same sitting: still hidden for this sync.
    cleanup();
    render(<BankProblemsBanner problems={TWO} lastSyncedAt="2026-03-10T21:00:00.000Z" today={TODAY} />);
    expect(screen.queryByTestId("bank-problems-banner")).toBeNull();

    // The next sync still has problems: back it comes.
    cleanup();
    render(<BankProblemsBanner problems={TWO} lastSyncedAt="2026-03-11T09:00:00.000Z" today={TODAY} />);
    expect(screen.getByTestId("bank-problems-banner")).toBeTruthy();
  });

  test("still shows, and still hides, when the browser refuses storage", async () => {
    const user = userEvent.setup();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    vi.stubGlobal("sessionStorage", broken);
    render(<BankProblemsBanner problems={TWO} lastSyncedAt="2026-03-10T21:00:00.000Z" today={TODAY} />);
    expect(screen.getByTestId("bank-problems-banner")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Hide until the next sync" }));
    expect(screen.queryByTestId("bank-problems-banner")).toBeNull();
  });
});

describe("reading the saved state", () => {
  // The saved bank grace the stand-in server returns; null answers 404, as when none can be read.
  let grace: Record<string, number> | null = null;
  beforeEach(() => {
    grace = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/simplefin/status")) {
        return new Response(JSON.stringify({
          connected: true,
          lastSyncedAt: "2026-03-10T21:20:00.000Z",
          lastErrors: [{ code: "con.auth", message: "Connection to Ridgeline Example Investments may need attention. Auth required", accountId: null, connectionId: "MBR-1", connectionName: null }],
        }));
      }
      if (String(url).endsWith("/settings/bank-grace")) {
        return grace ? new Response(JSON.stringify(grace)) : new Response("{}", { status: 404 });
      }
      if (String(url).endsWith("/accounts")) {
        return new Response(JSON.stringify([
          { id: "a", institution: "Ridgeline Example Investments", balanceDate: "2026-03-08", archived: false },
          { id: "b", institution: "Lakeshore - Credit Cards", balanceDate: "2026-02-25", archived: false },
          { id: "c", institution: "Pinecrest Example Bank", balanceDate: null, archived: true },
          { id: "d", institution: "Pinecrest Example Bank Online", balanceDate: "2026-03-10", archived: false },
        ]));
      }
      return new Response("{}", { status: 404 });
    }));
  });

  test("reads the last sync's warnings and every account's balance date, and nothing that writes", async () => {
    const state = await readBankProblems(TODAY);
    expect(state.lastSyncedAt).toBe("2026-03-10T21:20:00.000Z");
    expect(state.problems).toEqual([
      { kind: "sign-in", bank: "Ridgeline Example Investments", lastDataDate: "2026-03-08" },
      { kind: "quiet", bank: "Lakeshore - Credit Cards", lastDataDate: "2026-02-25" },
    ]);
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;
    expect(calls.map((c) => c[0]).sort()).toEqual(["/api/accounts", "/api/settings/bank-grace", "/api/simplefin/status"]);
    for (const c of calls) expect(c[1]?.method ?? "GET").toBe("GET");
  });

  test("a bank given grace in the saved settings waits its own days", async () => {
    grace = { "lakeshore - credit cards": 30 };
    const state = await readBankProblems(TODAY);
    expect(state.problems.map((p) => p.bank)).toEqual(["Ridgeline Example Investments"]);
  });
});
