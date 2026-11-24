// @vitest-environment jsdom
// tests/ui/AppShell.test.tsx
//
// The shell's own contract, which nothing tested before now. The three
// assertions that matter are the three reported defects: navigation is
// visible, the URL is the source of truth, and changing screens returns you
// to the top of it.
//
// The server is unreachable under jsdom, so every panel's load fails into its
// own "not connected" branch. That is the point: the shell must render
// regardless, which is exactly what it failed to guarantee before.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "../../src/ui/shell/AppShell";
import { NAV } from "../../src/ui/shell/nav";

beforeEach(() => {
  window.location.hash = "";
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("AppShell", () => {
  test("renders with the server unreachable", async () => {
    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    });
  });

  test("every destination is reachable without opening a menu first", async () => {
    render(<AppShell />);
    await waitFor(() => {
      for (const item of NAV) {
        expect(screen.getByRole("link", { name: item.label })).toBeTruthy();
      }
    });
  });

  test("the URL drives the section", async () => {
    window.location.hash = "#/forecast";
    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByTestId("page-title").textContent).toBe("Forecast");
    });
  });

  // The two screens What if replaced still have bookmarks.
  test.each(["#/scenarios", "#/lifestyle/compare"])("an old %s link opens What if", async (hash) => {
    window.location.hash = hash;
    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByTestId("page-title").textContent).toBe("What if");
    });
  });

  // Long-term became Wealth, and then Wealth is retired and
  // Runway became Forecast, so every old Runway, Wealth or Long-term link opens Forecast.
  test.each(["#/runway", "#/wealth", "#/long-term", "#/long-term/acquisition", "#/long-term/wealth"])("an old %s link opens Forecast", async (hash) => {
    window.location.hash = hash;
    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByTestId("page-title").textContent).toBe("Forecast");
    });
    expect(screen.queryByRole("tab", { name: "Acquisition" })).toBeNull();
    for (const gone of ["Acquisition", "Long-term", "Wealth", "Runway"]) {
      expect(screen.queryByRole("link", { name: gone }), gone).toBeNull();
    }
    expect(screen.getByRole("link", { name: "Forecast" })).toBeTruthy();
  });

  test("an unknown hash lands on the dashboard rather than a blank body", async () => {
    window.location.hash = "#/does-not-exist";
    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByTestId("page-title").textContent).toMatch(/Dashboard/);
    });
  });

  test("navigating scrolls back to the top", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await waitFor(() => screen.getByRole("link", { name: "Budget" }));
    (window.scrollTo as ReturnType<typeof vi.fn>).mockClear();
    await user.click(screen.getByRole("link", { name: "Budget" }));
    await waitFor(() => {
      expect(window.scrollTo).toHaveBeenCalled();
    });
  });

  test("a tabbed section shows its tab strip and the tab is in the URL", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/budget";
    render(<AppShell />);
    await user.click(await screen.findByRole("tab", { name: "Charts" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#/budget/charts");
    });
  });

  test("transactions is reachable and titled", async () => {
    window.location.hash = "#/transactions";
    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByTestId("page-title").textContent).toMatch(/Transactions/);
    });
  });

  for (const [section, match] of [
    ["reports", /Reports/],
    ["recurring", /Recurring/],
    // Bills became Recurring; an old link still lands on it.
    ["bills", /Recurring/],
    // One Accounts page; the old tab links and the
    // older Net worth link all land on it.
    ["accounts", /^Accounts$/],
    ["accounts/balances", /^Accounts$/],
    ["accounts/networth", /^Accounts$/],
    ["networth", /^Accounts$/],
    ["settings/accounts", /Settings · Accounts/],
  ] as const) {
    test(`${section} is reachable and titled`, async () => {
      window.location.hash = `#/${section}`;
      render(<AppShell />);
      await waitFor(() => {
        expect(screen.getByTestId("page-title").textContent).toMatch(match);
      });
    });
  }

  test("Accounts shows the net worth line and the account groups on one page, with no tab strip", async () => {
    window.location.hash = "#/accounts";
    render(<AppShell />);
    // Unreachable server: each of the two parts says so, which shows both are on the page.
    await waitFor(() => {
      expect(screen.getAllByText("The local server is not reachable. Restart the app.")).toHaveLength(2);
    });
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  // Settings has six tabs, and on a phone (390 px) the row ran
  // 521 px wide and pushed the page sideways. The tabs wrap onto a second line instead (rejected:
  // a row that scrolls on its own). gap-1 sets the gap between rows as well as between tabs, so
  // wrapped rows do not touch. jsdom has no layout, so the wrap is pinned by its class.
  test("the tab strip wraps onto a second line on a narrow screen, with a gap between rows", async () => {
    window.location.hash = "#/settings/salary";
    render(<AppShell />);
    const strip = await screen.findByRole("tablist");
    expect(screen.getAllByRole("tab")).toHaveLength(9);
    const classes = strip.className.split(/\s+/);
    expect(classes).toContain("flex-wrap");
    expect(classes).toContain("gap-1");
    expect(classes).not.toContain("overflow-x-auto");
  });

  test("a section with no tabs shows no tab strip", async () => {
    window.location.hash = "#/forecast";
    render(<AppShell />);
    await waitFor(() => screen.getByTestId("page-title"));
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
