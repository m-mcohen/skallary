// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AppShell from "../../src/ui/shell/AppShell";
import { configurePeriodStore } from "../../src/ui/lib/period-store";

const probe = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("../../src/ui/lib/usePlanState", () => ({ usePlanState: () => ({ summary: null, scenarios: [] }) }));
vi.mock("../../src/ui/shell/SiteHeader", () => ({ default: () => null }));
vi.mock("../../src/ui/shell/EquationBar", () => ({ default: () => null, useEquationBarCollapsed: () => [false, () => {}] }));
vi.mock("../../src/ui/lib/db", async (original) => ({
  ...await original<typeof import("../../src/ui/lib/db")>(),
  loadDb: async () => { throw new Error("Fixture only"); },
}));
vi.mock("../../src/ui/TransactionsSection", async () => {
  const { useState } = await import("react");
  const { usePeriod } = await import("../../src/ui/lib/period-store");
  return { default: () => {
    const [instance] = useState(() => ++probe.mounts);
    const period = usePeriod();
    return <output data-testid="ledger-instance" data-period={period.to}>{instance}</output>;
  } };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("the ledger keeps its instance for dates and replaces it for every other filter or header change", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.localStorage.clear();
  configurePeriodStore({ asOf: () => "2026-09-20" });
  probe.mounts = 0;
  const query = new URLSearchParams("ledger=1&cat=Food&kind=expense&from=2026-08-01&to=2026-08-31");
  const go = () => {
    window.history.replaceState(null, "", `#/transactions?${query}`);
    fireEvent(window, new HashChangeEvent("hashchange"));
  };
  go();
  render(<AppShell />);
  expect((await screen.findByTestId("ledger-instance")).textContent).toBe("1");
  query.set("to", "2026-08-20");
  go();
  expect(screen.getByTestId("ledger-instance").textContent).toBe("1");
  expect(screen.getByTestId("ledger-instance").getAttribute("data-period")).toBe("2026-08-20");
  let instance = 1;
  for (const [key, value] of [["cat", "Food Delivery"], ["kind", "income"], ["account", "checking"], ["counted", "1"], ["payee", "shop"], ["transfers", "include"], ["div", "3"], ["view", "account"], ["label", "Activity"], ["back", "#/accounts"]]) {
    query.set(key, value);
    go();
    expect(screen.getByTestId("ledger-instance").textContent, key).toBe(String(++instance));
  }
});
