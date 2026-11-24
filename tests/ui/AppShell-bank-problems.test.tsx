// @vitest-environment jsdom
// tests/ui/AppShell-bank-problems.test.tsx
//
// A red banner under the top bar on EVERY screen whenever a bank needs the user,
// read from the saved state, so it also shows after the app's own start-up sync,
// before anything is pressed.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AppShell from "../../src/ui/shell/AppShell";

let clean = false;

beforeEach(() => {
  clean = false;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u === "/api/simplefin/status") {
      return new Response(JSON.stringify({
        connected: true,
        lastSyncedAt: "2026-03-10T21:20:00.000Z",
        lastErrors: clean ? [] : [{ code: "con.auth", message: "Connection to Ridgeline Example Investments may need attention. Auth required", accountId: null, connectionId: "MBR-1" }],
        accountsNeedingType: [],
        setupTokenPath: "x",
        earliestBackfilled: null,
        accessLost: false,
      }));
    }
    if (u === "/api/accounts") return new Response(JSON.stringify([]));
    return new Response("{}", { status: 500 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
  window.sessionStorage.clear();
});

describe("the bank-problems banner in the shell", () => {
  test.each(["#/budget/table", "#/settings/salary", "#/transactions"])("shows on %s", async (hash) => {
    window.location.hash = hash;
    render(<AppShell />);
    const banner = await screen.findByTestId("bank-problems-banner");
    expect(banner.textContent).toMatch(/Ridgeline Example Investments needs a sign-in/);
  });

  test("is not there once a sync comes back clean", async () => {
    clean = true;
    window.location.hash = "#/budget/table";
    render(<AppShell />);
    await screen.findByTestId("page-title");
    // Give the reads a turn to land.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("bank-problems-banner")).toBeNull();
  });
});
