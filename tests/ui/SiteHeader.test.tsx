// @vitest-environment jsdom
// tests/ui/SiteHeader.test.tsx
//
// The 56px bar. Pins the page title, and pins that the scenario overlay is a GLOBAL
// control, not something buried in one mode, because it changes every number on every screen.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@/components/ui/sidebar";
import SiteHeader from "../../src/ui/shell/SiteHeader";
import { findNav } from "../../src/ui/shell/nav";
import type { Scenario } from "../../src/domain/scenario";

afterEach(cleanup);

const scenarios = [
  { id: "s1", name: "Scenario A" },
  { id: "s2", name: "Scenario B" },
] as unknown as Scenario[];

const base = {
  item: findNav("dashboard")!,
  tab: null,
  planName: "Budget: 2026",
  scenarios,
  scenarioId: null as string | null,
  onPickScenario: () => {},
};

const renderHeader = (props: Partial<typeof base> = {}) =>
  render(
    <SidebarProvider>
      <SiteHeader {...base} {...props} />
    </SidebarProvider>
  );

describe("SiteHeader", () => {
  test("names the current section", () => {
    renderHeader();
    expect(screen.getByTestId("page-title").textContent).toMatch(/Dashboard/);
  });

  test("shows section and tab when the section has tabs", () => {
    const item = findNav("budget")!;
    renderHeader({ item, tab: item.tabs!.find((t) => t.id === "charts")! });
    const title = screen.getByTestId("page-title").textContent ?? "";
    expect(title).toMatch(/Budget/);
    expect(title).toMatch(/Charts/);
  });

  test("shows the plan name", () => {
    renderHeader();
    expect(screen.getByText("Budget: 2026")).toBeTruthy();
  });

  test("with no what-if on, the menu says Real numbers", async () => {
    renderHeader();
    expect(screen.getByTestId("overlay-trigger").textContent).toMatch(/Real numbers/);
    await userEvent.setup().click(screen.getByTestId("overlay-trigger"));
    expect(await screen.findByRole("menuitem", { name: "Real numbers" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Plan" })).toBeNull();
  });

  test("the overlay control is present on every screen, not just what-if", () => {
    renderHeader({ item: findNav("accounts")! });
    expect(screen.getByTestId("overlay-trigger")).toBeTruthy();
  });

  test("reads Real numbers when no what-if is active", () => {
    renderHeader();
    expect(screen.getByTestId("overlay-trigger").textContent).toMatch(/Real numbers/);
  });

  test("names the active overlay", () => {
    renderHeader({ scenarioId: "s2" });
    expect(screen.getByTestId("overlay-trigger").textContent).toMatch(/Scenario B/);
  });

  test("picking a what-if reports the id; picking Real numbers reports null", async () => {
    const user = userEvent.setup();
    const onPickScenario = vi.fn();
    renderHeader({ scenarioId: "s2", onPickScenario });

    await user.click(screen.getByTestId("overlay-trigger"));
    await user.click(await screen.findByRole("menuitem", { name: /Scenario A/ }));
    expect(onPickScenario).toHaveBeenCalledWith("s1");

    await user.click(screen.getByTestId("overlay-trigger"));
    await user.click(await screen.findByRole("menuitem", { name: /^Real numbers$/ }));
    expect(onPickScenario).toHaveBeenCalledWith(null);
  });

  test("offers one Sync, and it pulls the SimpleFIN feed", async () => {
    // The old "Sync" / "Full re-sync" menu was retired: a full re-sync inserted a
    // second copy of the ledger. The one control left must hit the SimpleFIN endpoint
    // and nothing else, and must surface a failure rather than reload past it.
    const user = userEvent.setup();
    const fetchSpy = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      renderHeader();
      expect(screen.queryByRole("menuitem", { name: /Full re-sync/ })).toBeNull();
      await user.click(screen.getByRole("button", { name: /^Sync$/ }));
      expect(await screen.findByText(/Sync failed: offline/)).toBeTruthy();
      expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toEqual(["/api/simplefin/sync"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("SiteHeader period picker", () => {
  test("shows on the screens that look back at history, and nowhere else", () => {
    for (const id of ["reports", "transactions"]) {
      renderHeader({ item: findNav(id)! });
      expect(screen.queryByTestId("period-trigger"), id).not.toBeNull();
      cleanup();
    }
    for (const id of ["dashboard", "budget", "recurring", "goals", "whatif", "forecast", "notes", "settings", "help"]) {
      renderHeader({ item: findNav(id)! });
      expect(screen.queryByTestId("period-trigger"), id).toBeNull();
      cleanup();
    }
  });
});

describe("SiteHeader period picker on Accounts", () => {
  // Accounts is one page, and its net worth line takes the period.
  test("shows on Accounts", () => {
    renderHeader({ item: findNav("accounts")! });
    expect(screen.queryByTestId("period-trigger")).not.toBeNull();
  });
});

describe("SiteHeader compare picker", () => {
  test("shows on Reports only", () => {
    renderHeader({ item: findNav("reports")! });
    expect(screen.queryByTestId("compare-trigger")).not.toBeNull();
    cleanup();
    for (const id of ["accounts", "transactions", "dashboard", "budget", "forecast"]) {
      renderHeader({ item: findNav(id)! });
      expect(screen.queryByTestId("compare-trigger"), id).toBeNull();
      cleanup();
    }
  });
});
