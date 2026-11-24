// @vitest-environment jsdom
// tests/ui/defect-fixes.test.tsx -- screen fixes.
// Each block names the defect it pins and how the expected value was worked.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import RunwayOverview, { type RunwayDataLayer } from "../../src/ui/RunwayOverview";
import DashboardSection from "../../src/ui/DashboardSection";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import type { Scenario } from "../../src/domain/scenario";
import { composeWhatIf, whatIfPeriods, type WhatIf } from "../../src/domain/what-if";
import type { Account } from "../../src/domain/types";
import type { AccountBalance, BudgetLine, Plan, WishlistItem } from "../../src/domain/plan-types";
import type { HeadState } from "../../src/ui/lib/useMastheadSummary";
import type { Db } from "../../src/ui/lib/db";

afterEach(cleanup);

const PLAN: Plan = { id: "plan1", name: "2026 Plan", startDate: "2026-01-01", endDate: "2026-12-31", createdAt: "" };
const ACCOUNTS: Account[] = [{ id: "demo-checking", name: "Pinecrest Checking", type: "checking", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }];
const BALANCES: AccountBalance[] = [{ accountId: "demo-checking", balanceCents: 6_300_000, asOf: "2026-08-31T00:00:00Z" }];
const line = (planningCategory: string, amountCents: number): BudgetLine => ({ planId: "plan1", planningCategory, period: null, amountCents });

function runwayLayer(lines: BudgetLine[]): Partial<RunwayDataLayer> {
  return {
    loadDb: async () => ({}) as Db,
    getAccounts: async () => ACCOUNTS,
    getAccountBalances: async () => BALANCES,
    getPlan: async () => PLAN,
    getBudgetLines: async () => lines,
    getBudgetExtras: async () => ({ changes: [], bigMonths: [], notes: [] }),
    listWishlistItems: async () => [] as WishlistItem[],
  };
}

describe("Runway screen", () => {
  // The Wish List is one-time items and never reaches the runway.
  test("the runway never reads the Wish List", async () => {
    const listWishlistItems = vi.fn(async () => [{ id: "w", name: "Roof", costCents: 5_000_000, kind: "planned", targetDate: "2026-10-01", priority: 1, planningCategory: null }] as WishlistItem[]);
    const { findByText } = render(
      <RunwayOverview dataLayer={{ ...runwayLayer([line("Living", 760_000), line("Income", 0)]), listWishlistItems } as never} planId="plan1" asOfDate="2026-08-31" />
    );
    await findByText("9 months");
    expect(listWishlistItems).not.toHaveBeenCalled();
  });

  // $63,000 drawable, $7,600 a month out, no income: 63,000 / 7,600 = 8.29, so
  // the ninth month is the one that ends at or below zero.
  const BURNING = [line("Living", 760_000), line("Income", 0)];
  const RAISE: Scenario = {
    id: "s1", planId: "plan1", name: "New job", isDefault: false,
    income: { kind: "custom", netMonthlyCents: 1_000_000, startPeriod: "2026-09" },
    expenseDeltas: [], createdAt: "",
  };

  test("it follows the scenario laid over the plan, as the top bar does, and says so", async () => {
    const { findByText, findByTestId, rerender, queryByTestId } = render(
      <RunwayOverview dataLayer={runwayLayer(BURNING)} planId="plan1" asOfDate="2026-08-31" />
    );
    await findByText("9 months");
    expect(queryByTestId("runway-overlay")).toBeNull();

    // $10,000 a month in against $7,600 out: the balance rises, so there is no crossing.
    rerender(<RunwayOverview dataLayer={runwayLayer(BURNING)} planId="plan1" asOfDate="2026-08-31" scenario={RAISE} />);
    await findByText("Cash-flow positive");
    expect((await findByTestId("runway-overlay")).textContent).toBe("Under New job: modeled, not recorded.");
  });

  test("a balance that is still falling but outlasts the window is not called cash-flow positive", async () => {
    // $2,000 a month out for 24 months is $48,000, under the $63,000 on hand.
    const { findByText, queryByText } = render(
      <RunwayOverview dataLayer={runwayLayer([line("Living", 200_000)])} planId="plan1" asOfDate="2026-08-31" />
    );
    await findByText("Lasts past 24 months");
    await findByText(/still falling, but it does not reach zero/);
    expect(queryByText("Cash-flow positive")).toBeNull();
  });

  // A what-if composed when the app loaded must
  // not be applied as a stale difference after the budget was edited.
  test("a what-if's Change a cost sets the line on the budget as it is now, not as it was when the app loaded", async () => {
    const whatIf: WhatIf = {
      scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, rows: [],
      changes: [{ id: "c", position: 1, kind: "change", label: "Living", planningCategory: "Living", amountCents: 200_000, fromPeriod: "2026-09", untilPeriod: null, loan: null }],
    };
    const row: Scenario = { id: "w1", planId: "plan1", name: "Leaner", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" };
    // Composed against the budget as it was (Living $3,000): a $1,000 cut, as a difference.
    const stale = composeWhatIf(row, whatIf, [line("Living", 300_000)], whatIfPeriods("2026-08"), DEFAULT_SALARY_ASSUMPTIONS);
    const { findByText, queryByText } = render(
      <RunwayOverview dataLayer={runwayLayer(BURNING)} planId="plan1" asOfDate="2026-08-31" scenario={stale} whatIf={whatIf} salaryAssumptions={DEFAULT_SALARY_ASSUMPTIONS} />
    );
    // Living is $2,000 a month on today's budget: $48,000 over 24 months, under the $63,000 on hand.
    await findByText("Lasts past 24 months");
    expect(queryByText("10 months")).toBeNull();
  });

  // The Runway
  // screen rebuilt the what-if from its raw record and dropped a ticked goal's cost.
  test("a what-if with a ticked goal's ongoing cost shortens the Runway screen too", async () => {
    const whatIf: WhatIf = { scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [{ kind: "goal-cost", refId: "House", position: 1, on: true }, { kind: "goal-saving", refId: "House", position: 2, on: true }] };
    const row: Scenario = { id: "w1", planId: "plan1", name: "What if I had a house", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" };
    const house = { id: "House", name: "House", goalType: "savings", targetAmountCents: 100, targetDate: null, priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null, ongoingMonthlyCents: 300_000, ongoingStartedPeriod: null } as never;
    // Living $2,000 a month lasts past 24 months on $63,000; with a $3,000 house cost it does not.
    const without = render(
      <RunwayOverview dataLayer={runwayLayer([line("Living", 200_000), line("Income", 0)])} planId="plan1" asOfDate="2026-08-31" scenario={row} whatIf={whatIf} salaryAssumptions={DEFAULT_SALARY_ASSUMPTIONS} />
    );
    await without.findByText("Lasts past 24 months");
    without.unmount();
    const withGoal = render(
      <RunwayOverview dataLayer={runwayLayer([line("Living", 200_000), line("Income", 0)])} planId="plan1" asOfDate="2026-08-31" scenario={row} whatIf={whatIf} goals={[house]} salaryAssumptions={DEFAULT_SALARY_ASSUMPTIONS} />
    );
    await withGoal.findByText(/^\d+ months?$/);
    expect(withGoal.queryByText("Lasts past 24 months")).toBeNull();
  });

  test("income budgeted under another income name is not reported as zero modeled income", async () => {
    const { findByText, queryByText } = render(
      <RunwayOverview dataLayer={runwayLayer([line("Living", 760_000), line("Paychecks", 50_000)])} planId="plan1" asOfDate="2026-08-31" />
    );
    // $7,100 a month net out: 63,000 / 7,100 = 8.87, so month 9 again.
    await findByText("9 months");
    await findByText(/Crosses zero in/);
    expect(queryByText(/\$0 modeled income/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bank connection rules
// ---------------------------------------------------------------------------
import ConnectorSection, { type ConnectorDataLayer } from "../../src/ui/ConnectorSection";

describe("Bank connection rules", () => {
  test("Rebuild learned rules asks first", async () => {
    const rederiveRules = vi.fn(async () => ({ removed: 1, created: 2 }));
    const dataLayer: ConnectorDataLayer = {
      loadDb: async () => ({}) as Db,
      getConnectorStatus: async () => ({ connected: true, lastSyncedAt: null, tokenPath: "x", accountsNeedingType: [], lastErrors: [] }) as never,
      connect: async () => ({ connected: true, alreadyConnected: false }),
      disconnect: async () => {},
      sync: async () => ({ inserted: 0, updated: 0, accounts: 0, holdings: 0, errors: [], needsReconnect: false, skipped: 0 }) as never,
      setAccountType: async () => {},
      getUncategorized: async () => [],
      getRules: async () => [],
      addRule: async () => 1,
      deleteRule: async () => {},
      bootstrapRules: async () => ({ created: 0 }),
      rederiveRules,
    };
    const { findByRole, findByText } = render(<ConnectorSection dataLayer={dataLayer} />);
    fireEvent.click(await findByRole("button", { name: "Rebuild learned rules" }));
    await findByText("Rebuild learned rules?");
    expect(rederiveRules).not.toHaveBeenCalled();
    fireEvent.click(await findByRole("button", { name: "Rebuild rules" }));
    await waitFor(() => expect(rederiveRules).toHaveBeenCalled());
  });
});
