// @vitest-environment jsdom
// tests/ui/AppShell-overlay.test.tsx
// The shell hands the top-bar menu the
// what-ifs only, shows the banner on every screen while one is on, and Turn off
// returns to Real numbers. usePlanState is mocked: under jsdom the server is
// unreachable, so the real hook never gets a plan.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setScenarioId = vi.fn();
const offerA = { id: "w1", planId: "p1", name: "Offer A $120k", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" };
const older = { id: "old", planId: "p1", name: "Offer A $130k (counter)", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" };
let active: string | null = null;
let goalCostsMissing = false;

vi.mock("../../src/ui/lib/usePlanState", () => ({
  usePlanState: () => ({
    planId: "p1",
    planName: "Budget: 2026",
    setPlanId: () => {},
    scenarios: [older, offerA],
    savedScenarios: [older, offerA],
    scenarioId: active,
    setScenarioId,
    whatIfs: [{ scenarioId: "w1", salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: "2026-07", changes: [], rows: [] }],
    whatIfScenarios: [offerA],
    activeWhatIf: active ? { scenarioId: "w1", salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: "2026-07", changes: [], rows: [] } : null,
    scenario: active ? offerA : null,
    goalCostsMissing,
    summary: null,
    salaryAssumptions: { premiumMonthlyCents: 0, maaserRate: 0.1, children: 1 },
    refresh: () => {},
  }),
}));

beforeEach(() => {
  window.location.hash = "#/bills";
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setScenarioId.mockReset();
  active = null;
  goalCostsMissing = false;
  window.location.hash = "";
});

test("the menu offers Real numbers and the what-ifs only", async () => {
  const { default: AppShell } = await import("../../src/ui/shell/AppShell");
  render(<AppShell />);
  await userEvent.setup().click(await screen.findByTestId("overlay-trigger"));
  const items = (await screen.findAllByRole("menuitem")).map((i) => i.textContent);
  expect(items).toEqual(["Real numbers", "Offer A $120k"]);
});

test("with Real numbers there is no banner", async () => {
  const { default: AppShell } = await import("../../src/ui/shell/AppShell");
  render(<AppShell />);
  await screen.findByTestId("overlay-trigger");
  expect(screen.queryByText(/What-if on/)).toBeNull();
});

test("while a what-if is on, the banner shows on any screen, and Turn off returns to Real numbers", async () => {
  active = "w1";
  const { default: AppShell } = await import("../../src/ui/shell/AppShell");
  render(<AppShell />);
  // Recurring (#/bills) ignores the what-if, so its banner says so.
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/What-if on: Offer A \$120k\. This screen does not use the what-if\./));
  await userEvent.setup().click(screen.getByRole("button", { name: "Turn off" }));
  expect(setScenarioId).toHaveBeenCalledWith(null);
});

// the shell hands the banner the plan's "goal costs missing" flag.
test("when goal costs could not be read, the banner under the top bar says so", async () => {
  active = "w1";
  goalCostsMissing = true;
  const { default: AppShell } = await import("../../src/ui/shell/AppShell");
  render(<AppShell />);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Goals could not be read, so their rows are left out of these figures."));
});
