// @vitest-environment jsdom
// tests/ui/goals-wishlist-whole-dollars.test.tsx
//
// The request: "remove decimals from goals and wish list". Every money
// figure shown on the Goals screen, the Wish List screen and the Dashboard's
// Goals card reads in whole dollars, rounded to the nearest dollar
// ($12,346, not $12,345.67). The boxes you type into keep their cents.
//
// The fixtures use odd cents on purpose so rounding is exercised both ways:
// .49 rounds down, .50 and .51 round up.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import GoalsSection, { type GoalsDataLayer } from "../../src/ui/GoalsSection";
import WishlistSection, { type WishlistDataLayer } from "../../src/ui/WishlistSection";
import GoalCard from "../../src/ui/goals/GoalCard";
import GoalPaymentHelper from "../../src/ui/goals/GoalPaymentHelper";
import GoalsCard from "../../src/ui/dashboard/GoalsCard";
import { goalFunding, goalStatus, goalTargetText } from "../../src/domain/goals";
import { formatPeriodLabel, localDateIso } from "../../src/domain/period";
import type { AccountBalance, Goal, GoalAccountLink, WishlistItem } from "../../src/domain/plan-types";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { Db } from "../../src/ui/lib/db";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A dollar sign followed by a figure with cents, such as "$12,345.67" or "-$0.49". */
const CENTS = /\$[\d,]+\.\d{2}/;

function acct(id: string, name: string, type: string, over: Partial<Account> = {}): Account {
  return { id, name, type, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me", ...over };
}

// $12,345.67 by Jan 2030; $1,500.49 saved outside, all of Savings ($2,500.51) linked,
// $500.50 a month planned. Saved: $1,500.49 + $2,500.51 = $4,001.00.
const GOAL: Goal = {
  id: "g1",
  name: "House down payment",
  goalType: "home_down_payment",
  targetAmountCents: 1_234_567,
  targetDate: "2030-01-01",
  priority: 1,
  currentAmountCents: 150_049,
  plannedMonthlyCents: 50_050,
  notes: "",
  archivedAt: null,
};
const ACCOUNTS: Account[] = [acct("acc-sav", "Savings", "savings"), acct("acc-brok", "Brokerage", "brokerage"), acct("acc-ira", "Roth IRA", "brokerage")];
const BALANCES: AccountBalance[] = [
  { accountId: "acc-sav", balanceCents: 250_051, asOf: "2026-09-16T00:00:00Z" },
  { accountId: "acc-brok", balanceCents: 900_049, asOf: "2026-09-16T00:00:00Z" },
  { accountId: "acc-ira", balanceCents: 2_346_827, asOf: "2026-09-16T00:00:00Z" },
];
const LINKS: GoalAccountLink[] = [{ goalId: "g1", accountId: "acc-sav", mode: "entire", amountCents: null }];
// $2,000.50 + $5,000.49 = $7,000.99.
const WISH: WishlistItem[] = [
  { id: "w1", name: "New couch", costCents: 200_050, kind: "wish", targetDate: null, priority: 1, planningCategory: null },
  { id: "w2", name: "Roof repair", costCents: 500_049, kind: "wish", targetDate: null, priority: 2, planningCategory: null },
];

function goalsLayer(opts: { goals: Goal[]; balances?: AccountBalance[]; links?: GoalAccountLink[]; txns?: NormalizedTxn[]; wish?: WishlistItem[] }) {
  const dataLayer: Partial<GoalsDataLayer> = {
    loadDb: async () => ({}) as Db,
    listGoals: async () => opts.goals,
    upsertGoal: vi.fn(async () => {}),
    deleteGoal: vi.fn(async () => {}),
    listWishlistItems: async () => opts.wish ?? [],
    getAccounts: async () => ACCOUNTS,
    getAccountBalances: async () => opts.balances ?? BALANCES,
    getTransactions: async () => opts.txns ?? [],
    listGoalAccountLinks: async () => opts.links ?? LINKS,
    replaceGoalAccountLinks: vi.fn(async () => {}),
  };
  return dataLayer;
}

describe("Goals screen", () => {
  test("the overview cards and the goal card read in whole dollars", async () => {
    const { container } = render(<GoalsSection dataLayer={goalsLayer({ goals: [GOAL], wish: WISH })} />);
    await screen.findByText("House down payment");
    await screen.findByTestId("goals-retirement-available");
    await screen.findByText("2 items");
    const text = container.textContent ?? "";

    // Saved toward goals: $4,001.00 of $12,345.67.
    expect(screen.getAllByText("$4,001").length).toBeGreaterThan(0);
    expect(screen.getByText("of $12,346 targeted")).toBeTruthy();
    // Available for goals: Brokerage's $9,000.49 (Savings is claimed, the IRA is on its own line).
    expect(screen.getByText("$9,000")).toBeTruthy();
    expect(screen.getByTestId("goals-retirement-available").textContent).toBe("Retirement accounts $23,468");
    // Personal Wish List: $7,000.99.
    expect(screen.getByText("$7,001")).toBeTruthy();

    // The card.
    expect(screen.getByTestId("goal-target-line-g1").textContent).toBe("Save $12,346 by Jan 2030");
    expect(text).toMatch(/\$4,001 saved, \d+% of \$12,346/);
    expect(screen.getByText("$501")).toBeTruthy(); // planned per month, $500.50
    expect(screen.getByText("$2,501")).toBeTruthy(); // Savings funding line, $2,500.51
    expect(screen.getByText("$1,500")).toBeTruthy(); // saved outside, $1,500.49
    expect(screen.getByTestId("goal-monthly-line-g1").textContent).toMatch(/^About \$[\d,]+ a month to get there$/);

    expect(text).not.toMatch(CENTS);
  });

  test("the accounts dialog shows balances and what is available in whole dollars", async () => {
    render(<GoalsSection dataLayer={goalsLayer({ goals: [GOAL] })} />);
    await screen.findByText("House down payment");
    fireEvent.click(screen.getByRole("button", { name: "Accounts for House down payment" }));
    const dialog = await screen.findByRole("dialog");
    const text = dialog.textContent ?? "";
    expect(text).toContain("Balance $2,501");
    expect(text).toContain("Balance $9,000 · $9,000 available to this goal");
    expect(text).not.toMatch(CENTS);
  });

  test("the goal editor shows the monthly need in whole dollars, and its boxes keep their cents", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
    // $10,000.50 by Oct 31, all of Savings ($1,000) linked, $500 landed on Sep 5, so only
    // October counts: $9,000.50 left / 1 month = $9,000.50 a month, which reads $9,001.
    const goal: Goal = { ...GOAL, id: "g2", name: "Trip", targetAmountCents: 1_000_050, targetDate: "2026-10-31", currentAmountCents: 0, plannedMonthlyCents: 50_050 };
    const dataLayer = goalsLayer({
      goals: [goal],
      balances: [{ accountId: "acc-sav", balanceCents: 100_000, asOf: "2026-09-18T00:00:00Z" }],
      links: [{ goalId: "g2", accountId: "acc-sav", mode: "entire", amountCents: null }],
      txns: [{ sourceTransactionId: "t1", accountId: "acc-sav", date: "2026-09-05", amountCents: 50_000, sourceCategory: null, merchant: null, isTransfer: true, sourceUpdatedAt: null }],
    });
    render(<GoalsSection dataLayer={dataLayer} />);
    await screen.findByText("Trip");
    fireEvent.click(screen.getByRole("button", { name: "Edit Trip" }));
    await screen.findByText("Needed to finish on time: $9,001 per month");
    expect((screen.getByLabelText("Target amount") as HTMLInputElement).value).toBe("10000.50");
    expect((screen.getByLabelText("Planned per month") as HTMLInputElement).value).toBe("500.50");
    // Use this still hands over the exact figure, cents and all.
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect((screen.getByLabelText("Planned per month") as HTMLInputElement).value).toBe("9000.50");
  });

  test("Start this cost asks in whole dollars", async () => {
    const ma = { id: "ma", name: "Martial arts", goalType: "savings", targetAmountCents: 22_500, targetDate: null, priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null, ongoingMonthlyCents: 20_049, ongoingStartedPeriod: null, ongoingBudgetLine: null, completedAt: null } as Goal;
    const lines = [{ planId: "p", planningCategory: "Fitness", period: null, amountCents: 5000 }];
    const dataLayer = { ...goalsLayer({ goals: [ma] }), setGoalState: vi.fn(async () => {}), getBudgetLines: async () => lines };
    const user = userEvent.setup();
    render(<GoalsSection dataLayer={dataLayer} planId="p" />);
    expect((await screen.findByTestId("goal-cost-line-ma")).textContent).toBe("Then $200 a month");
    await user.click(screen.getByRole("button", { name: "Start this cost for Martial arts" }));
    const thisMonth = formatPeriodLabel(localDateIso().slice(0, 7));
    expect(await screen.findByText(`Add Martial arts $200 a month to your budget, starting ${thisMonth}?`)).toBeTruthy();
  });
});

describe("GoalCard", () => {
  const base: Goal = { id: "g1", name: "House", goalType: "savings", targetAmountCents: 23_400_000, targetDate: "2030-09-01", priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null };
  const renderCard = (over: Partial<Goal> = {}) =>
    render(
      <GoalCard
        status={goalStatus({ ...base, ...over }, 0, "2026-09-30")}
        funding={goalFunding({ ...base, ...over }, [], [], [])}
        accountsAvailable
        busy={false}
        onEdit={vi.fn()}
        onAccounts={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDelete={vi.fn()}
        onStartCost={vi.fn()}
      />
    );

  test("the target, the monthly need and a planned cost read in whole dollars", () => {
    const { container } = renderCard({ ongoingMonthlyCents: 544_524 });
    expect(screen.getByTestId("goal-target-line-g1").textContent).toBe("Save $234,000 by Sep 2030");
    // $234,000 / 49 months = $4,775.52, which reads $4,776.
    expect(screen.getByTestId("goal-monthly-line-g1").textContent).toBe("About $4,776 a month to get there");
    expect(screen.getByTestId("goal-cost-line-g1").textContent).toBe("Then $5,445 a month");
    expect(container.textContent).not.toMatch(CENTS);
  });

  test("a started cost reads in whole dollars", () => {
    renderCard({ ongoingMonthlyCents: 544_524, ongoingStartedPeriod: "2026-10", ongoingBudgetLine: "Mortgage" });
    expect(screen.getByTestId("goal-cost-line-g1").textContent).toBe("$5,445 a month, in your budget as Mortgage since Oct 2026");
  });

  test("money out of the goal this month keeps its minus sign", () => {
    // A negative month reads -$123 ($123.49 moved out), never ($123) or a bare 123.
    const status = { ...goalStatus(base, 0, "2026-09-30"), thisMonthCents: -12_349 };
    render(
      <GoalCard status={status} funding={goalFunding(base, [], [], [])} accountsAvailable busy={false} onEdit={vi.fn()} onAccounts={vi.fn()} onArchive={vi.fn()} onUnarchive={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("-$123")).toBeTruthy();
  });
});

describe("Payment helper", () => {
  test("the breakdown reads in whole dollars, and Use this hands over the exact cents", async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    const rates = { thirtyYear: { ratePct: 7.03, weekOf: "2026-09-24" }, fifteenYear: { ratePct: 6.42, weekOf: "2026-09-24" } };
    render(<GoalPaymentHelper targetCents={23_400_049} getRates={async () => rates} onUse={onUse} />);
    await screen.findByDisplayValue("7.03");
    expect(screen.getByText(/Goal target: \$234,000(?![.\d])/)).toBeTruthy();
    await user.type(screen.getByLabelText("Price"), "800000");
    await user.type(screen.getByLabelText("Down payment"), "160000");
    await user.clear(screen.getByLabelText("Rate (%)"));
    await user.type(screen.getByLabelText("Rate (%)"), "6.5");
    await user.type(screen.getByLabelText("Property tax a year"), "12000");
    await user.type(screen.getByLabelText("Insurance a year"), "4800");
    await user.type(screen.getByLabelText("HOA a month"), "200");
    // $4,045.24 + $1,000 + $400 + $200 = $5,645.24.
    expect(screen.getByTestId("helper-total").textContent).toBe("Payment $4,045 + tax $1,000 + insurance $400 + HOA $200 = $5,645 a month");
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(onUse).toHaveBeenCalledWith(564_524);
  });
});

describe("Dashboard Goals card", () => {
  test("the target and the monthly need read in whole dollars", async () => {
    const layer = {
      loadDb: async () => ({}) as never,
      listGoals: async () => [{ ...GOAL, targetAmountCents: 1_000_000, currentAmountCents: 150_000 }],
      getAccounts: async () => ACCOUNTS,
      getAccountBalances: async () => [{ accountId: "acc-sav", balanceCents: 250_000, asOf: "2026-09-16T00:00:00Z" }],
      listGoalAccountLinks: async () => LINKS,
      getTransactions: async () => [],
    };
    const { container } = render(<GoalsCard dataLayer={layer} asOf="2026-09-23" />);
    await screen.findByText("House down payment");
    // $6,000 left over 41 months = $146.35, which reads $146.
    expect(screen.getByTestId("goal-need-g1").textContent).toBe("About $146 a month");
    expect(screen.getByTestId("goal-target-g1").textContent).toBe("Save $10,000 by Jan 2030");
    expect(container.textContent).not.toMatch(CENTS);
  });
});

describe("goalTargetText", () => {
  test("rounds the target to the nearest dollar", () => {
    expect(goalTargetText({ ...GOAL, targetAmountCents: 23_400_000, targetDate: "2030-09-01" })).toBe("Save $234,000 by Sep 2030");
    expect(goalTargetText({ ...GOAL, targetAmountCents: 550_049, targetDate: null })).toBe("Save $5,500");
    expect(goalTargetText({ ...GOAL, targetAmountCents: 550_050, targetDate: null })).toBe("Save $5,501");
  });
});

describe("Wish List screen", () => {
  function wishLayer(items: WishlistItem[]): Partial<WishlistDataLayer> {
    return {
      loadDb: async () => ({}) as Db,
      listWishlistItems: async () => items,
      upsertWishlistItem: vi.fn(async () => {}),
      deleteWishlistItem: vi.fn(async () => {}),
      getTransactions: async () => [],
      getAccounts: async () => [],
      getCategoryMappings: async () => ({}),
      getPlan: async () => null,
      getBudgetLines: async () => [],
      getTransactionAdjustments: async () => [],
    };
  }

  test("each cost and the total read in whole dollars", async () => {
    const { container } = render(<WishlistSection dataLayer={wishLayer(WISH)} planId={null} />);
    await screen.findByText("Roof repair");
    const rows = screen.getAllByTestId("wish-row");
    expect(within(rows[0]).getByText("$2,001")).toBeTruthy(); // $2,000.50
    expect(within(rows[1]).getByText("$5,000")).toBeTruthy(); // $5,000.49
    const footer = container.querySelector("tfoot") as HTMLElement;
    expect(within(footer).getByText("$7,001")).toBeTruthy(); // $7,000.99
    expect(container.textContent).not.toMatch(CENTS);
  });

  test("the edit box keeps the exact cost, cents and all", async () => {
    render(<WishlistSection dataLayer={wishLayer(WISH)} planId={null} />);
    await screen.findByText("New couch");
    fireEvent.click(screen.getByRole("button", { name: "Edit New couch" }));
    await waitFor(() => expect((screen.getByLabelText("Cost") as HTMLInputElement).value).toBe("2000.50"));
  });
});
