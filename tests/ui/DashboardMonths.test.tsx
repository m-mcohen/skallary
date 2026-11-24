// @vitest-environment jsdom
// tests/ui/DashboardMonths.test.tsx
//
// Switching months on the dashboard page.
// Previous and next arrows beside the month name, plus a This month button; a
// past month shows how it ended (spending, budget against actual). Balance
// figures stay today's and say so. No future months. The month lives in the
// Dashboard link. "Today" is pinned to 2026-10-02 through the month source.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import DashboardSection from "../../src/ui/DashboardSection";
import type { HeadState } from "../../src/ui/lib/useMastheadSummary";
import { TOP_CATEGORIES_KEY } from "../../src/ui/dashboard/TopCategories";
import type { MonthSource } from "../../src/domain/dashboard-month";
import type { BudgetLine } from "../../src/domain/plan-types";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const TODAY = "2026-10-02";

const accounts: Account[] = [
  { id: "card", name: "Card", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];
let n = 0;
const t = (date: string, amountCents: number, sourceCategory = "Groceries", over: Partial<NormalizedTxn> = {}): NormalizedTxn =>
  ({ sourceTransactionId: `t${n++}`, accountId: "card", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, payee: "Store", ...over }) as NormalizedTxn;

// By hand (the same months as tests/domain/dashboard-month.test.ts):
//   July:   $25.00 + $100.00 + $50.00 = $175.00 spent, no income
//   August: Rent $200.00; Groceries $30.00 + $70.00 + $15.00 = $315.00 spent
//           income $5,000.00 + $1,000.00 = $6,000.00; left over $5,685.00
//   October so far: $40.00 on the 1st
const txns: NormalizedTxn[] = [
  t("2026-07-01", -2500),
  t("2026-07-05", -10000),
  t("2026-07-31", -5000),
  t("2026-08-01", -20000, "Rent"),
  t("2026-08-02", -3000),
  t("2026-08-25", -7000),
  t("2026-08-31", -1500),
  t("2026-08-15", 500000, "Paychecks", { payee: "Employer" }),
  t("2026-08-30", 100000, "Paychecks", { payee: "Employer" }),
  t("2026-10-01", -4000),
];
const line = (planningCategory: string, amountCents: number, period: string | null = null): BudgetLine => ({ planId: "p", planningCategory, period, amountCents });
// August's budget by hand: Rent $200.00 + Groceries $150.00 (August's own amount) = $350.00.
const budgetLines = [line("Rent", 20000), line("Groceries", 10000), line("Groceries", 15000, "2026-08"), line("Paychecks", 500000)];

const monthSource: MonthSource = { prepared: txns, accounts, mapping: {}, budgetLines, today: TODAY, firstMonth: "2026-07" };

// Today's figures, as the top of the app reads them: Monthly budget is $7,000.00,
// not August's $350.00, so a tile that followed the month would show.
const summary = {
  reading: { drawableCents: 7500000, burnCents: 700000, runwayMonths: 10.7, crossPeriod: "2027-08", series: [] },
  baselineSeries: null,
  scenarioLabel: null,
  heldBackCents: 1800000,
  recurringCents: 600000,
  variableCents: 100000,
  accountCount: 7,
  uncategorizedCount: 0,
  ruleCount: 100,
  lastSyncedAt: "2026-10-02T08:00:00-04:00",
  trailingCents: 650000,
  lastSeedAt: "2026-09-02T14:07:00-04:00",
  reseedDue: false,
  // This month so far, as the Dashboard reads it today: Oct 1 to Oct 2.
  spentThisMonth: {
    period: { preset: "this-month", from: "2026-10-01", to: "2026-10-02" },
    cents: 4000,
    baseline: { range: { from: "2026-09-01", to: "2026-09-02" }, cents: 0, byCategory: { Groceries: 0 } },
    leftOverCents: -4000,
    savingCents: 0,
    topCategories: [{ category: "Groceries", cents: 4000 }],
  },
  incomeThisMonth: {
    period: { preset: "this-month", from: "2026-10-01", to: "2026-10-02" },
    cents: 0,
    baseline: { range: { from: "2026-09-01", to: "2026-09-02" }, cents: 0 },
    investmentIncomeCents: 0,
    topSources: [],
  },
  spendingCurves: null,
} as unknown as HeadState;

const withSource = (over: Partial<MonthSource> = {}) => ({ ...summary, monthSource: { ...monthSource, ...over } }) as HeadState;
const props = { planId: "p1", onChanged: () => {} };

const prev = () => screen.getByRole("button", { name: /^Previous month/ }) as HTMLButtonElement;
const next = () => screen.getByRole("button", { name: /^Next month/ }) as HTMLButtonElement;
/** Markup with React's generated ids blanked: two renders number their info points differently. */
const html = (el: Element) => el.outerHTML.replace(/="[^"]*_r_[0-9a-z]+_[^"]*"/g, '=""');
const ledger = (el: Element) => Object.fromEntries(new URLSearchParams(el.querySelector("a[data-ledger]")!.getAttribute("href")!.split("?")[1]));

// The card's dropdown and its stored choice are gone; both comparisons always show.
beforeEach(() => {
  window.history.replaceState(null, "", "#/dashboard");
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the month bar", () => {
  test("on this month: the month's name, next is off, previous names last month, no This month button", () => {
    render(<DashboardSection {...props} summary={withSource()} />);
    expect(screen.getByTestId("dash-month-name").textContent).toBe("October 2026");
    expect(next().disabled).toBe(true);
    expect(prev().disabled).toBe(false);
    expect(prev().getAttribute("aria-label")).toBe("Previous month: Sep 2026");
    expect(screen.queryByRole("button", { name: "This month" })).toBeNull();
  });

  test("at the first month with transactions, previous is off", () => {
    window.history.replaceState(null, "", "#/dashboard?month=2026-07");
    render(<DashboardSection {...props} summary={withSource()} />);
    expect(screen.getByTestId("dash-month-name").textContent).toBe("July 2026");
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(false);
    expect(next().getAttribute("aria-label")).toBe("Next month: Aug 2026");
    expect(screen.getByRole("button", { name: "This month" })).toBeTruthy();
  });

  test("the arrows have at least a 24 pixel click area", () => {
    render(<DashboardSection {...props} summary={withSource()} />);
    for (const b of [prev(), next()]) expect(b.className).toMatch(/\bsize-8\b/); // 32 px
  });

  test("with no month source yet there is no bar, and the Dashboard reads as before", () => {
    render(<DashboardSection {...props} summary={summary} />);
    expect(screen.queryByTestId("dash-month-name")).toBeNull();
    expect(screen.getByText("This month so far")).toBeTruthy();
  });
});

describe("this month is unchanged", () => {
  test("the spending and income cards and every tile read exactly as they did before the bar", () => {
    render(<DashboardSection {...props} summary={summary} />);
    const before = {
      spend: html(screen.getByLabelText("This month so far")),
      income: html(screen.getByLabelText("Income this month")),
      tiles: ["drawable", "burn", "held-back", "trailing", "recurring", "variable"].map((id) => html(screen.getByTestId(`dash-figure-${id}`).parentElement!)),
    };
    cleanup();
    render(<DashboardSection {...props} summary={withSource()} />);
    expect(html(screen.getByLabelText("This month so far"))).toBe(before.spend);
    expect(html(screen.getByLabelText("Income this month"))).toBe(before.income);
    expect(["drawable", "burn", "held-back", "trailing", "recurring", "variable"].map((id) => html(screen.getByTestId(`dash-figure-${id}`).parentElement!))).toEqual(before.tiles);
    expect(document.body.textContent).not.toMatch(/as of today/i);
    expect(screen.queryByTestId("dash-month-note")).toBeNull();
  });

  test("its ledgers still come back to the plain Dashboard link", () => {
    render(<DashboardSection {...props} summary={withSource()} />);
    expect(ledger(screen.getByTestId("dash-figure-spent-this-month")).back).toBe("#/dashboard");
  });
});

describe("a past month shows how it ended", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "#/dashboard?month=2026-08");
    // Top categories starts folded; these read the open list.
    window.localStorage.setItem(TOP_CATEGORIES_KEY, "open");
  });

  test("spending is August's full total, compared with all of July", () => {
    render(<DashboardSection {...props} summary={withSource()} />);
    const card = screen.getByLabelText("Spending, August 2026");
    expect(card.querySelector("[data-slot=card-title]")!.textContent).toBe("August 2026");
    expect(within(card).getByText("Spent in August")).toBeTruthy();
    const figure = screen.getByTestId("dash-figure-spent-this-month");
    expect(figure.textContent).toBe("$315.00"); // not $230.00 (Aug 1 to Aug 2)
    expect(ledger(figure)).toMatchObject({ label: "Spending, August 2026", from: "2026-08-01", to: "2026-08-31", back: "#/dashboard?month=2026-08" });
    // $315.00 - $175.00 = +$140.00; $140.00 / $175.00 = +80.0%.
    // Both comparisons at once; July is not 12 months back, so no average month.
    expect(screen.getByTestId("dash-spent-note").textContent).toMatch(/^Aug 1 to Aug 31\./);
    expect(screen.getByTestId("dash-spent-vs-last").textContent).toBe("July, whole month: $175.00 +$140.00 (+80.0%)");
    expect(screen.getByTestId("dash-spent-vs-average").textContent).toBe("Not enough history to compare with the 12-month average.");
    // Each top category against all of July: Rent nothing, Groceries $175.00.
    expect(screen.getByTestId("month-top-Rent-before").textContent).toBe("July: $0.00");
    expect(screen.getByTestId("month-top-Groceries-before").textContent).toBe("July: $175.00");
    expect(ledger(screen.getByTestId("month-top-Groceries-before"))).toMatchObject({ cat: "Groceries", from: "2026-07-01", to: "2026-07-31", back: "#/dashboard?month=2026-08" });
    expect(within(card).getByText("Left over")).toBeTruthy();
    expect(screen.getByTestId("month-left-over").textContent).toBe("$5,685.00");
    expect(screen.getByTestId("month-top-Rent").textContent).toContain("$200.00");
    expect(screen.getByTestId("month-top-Groceries").textContent).toContain("$115.00");
    expect(screen.queryByText("This month so far")).toBeNull();
  });

  test("budget against actual: August's budget, what was spent, and the difference", () => {
    render(<DashboardSection {...props} summary={withSource()} />);
    expect(screen.getByTestId("month-budget").textContent).toBe("$350.00");
    expect(screen.getByTestId("month-budget-spent").textContent).toBe("$315.00");
    // $350.00 - $315.00 = $35.00 under: not red.
    const result = screen.getByTestId("month-budget-result");
    expect(result.textContent).toBe("Under budget by $35.00");
    expect(result.className).not.toMatch(/text-destructive/);
  });

  test("over budget is said in red", () => {
    render(<DashboardSection {...props} summary={withSource({ budgetLines: [line("Rent", 20000), line("Groceries", 5000)] })} />);
    // $250.00 budget - $315.00 spent = $65.00 over.
    const result = screen.getByTestId("month-budget-result");
    expect(result.textContent).toBe("Over budget by $65.00");
    expect(result.className).toMatch(/text-destructive/);
  });

  test("income is August's full total", () => {
    render(<DashboardSection {...props} summary={withSource()} />);
    const card = screen.getByLabelText("Income, August 2026");
    expect(within(card).getByText("Income in August 2026")).toBeTruthy();
    expect(within(card).getByText("Income for the month")).toBeTruthy();
    const figure = screen.getByTestId("dash-figure-income-this-month");
    expect(figure.textContent).toBe("$6,000.00");
    expect(ledger(figure)).toMatchObject({ from: "2026-08-01", to: "2026-08-31", back: "#/dashboard?month=2026-08" });
    expect(screen.getByTestId("dash-income-note").textContent).toBe("Aug 1 to Aug 31. July, whole month: $0.00 +$6,000.00 (n/a)");
  });

  test("the day-by-day chart runs the whole month", () => {
    render(<DashboardSection {...props} summary={withSource()} />);
    expect(screen.getByTestId("spend-chart-summary").textContent).toBe("August 2026: $315.00 for the whole month. July, whole month: $175.00.");
  });

  test("balance and today figures keep today's figure and say As of today", () => {
    render(<DashboardSection {...props} summary={withSource()} />);
    expect(screen.getByTestId("dash-figure-drawable").textContent).toBe("$75,000.00");
    expect(screen.getByTestId("dash-figure-burn").textContent).toBe("$7,000.00"); // today's, not August's $350.00
    expect(screen.getByTestId("dash-figure-held-back").textContent).toBe("$18,000.00");
    expect(screen.getByTestId("dash-figure-trailing").textContent).toBe("$6,500.00");
    for (const id of ["drawable", "burn", "held-back", "trailing", "recurring", "variable"]) {
      expect(screen.getByTestId(`dash-asof-${id}`).textContent, id).toBe("As of today");
    }
    expect(within(screen.getByLabelText("Goals")).getByText(/As of today/)).toBeTruthy();
    expect(within(screen.getByLabelText("Waiting on you")).getByText(/as of today/)).toBeTruthy();
    expect(screen.getByTestId("dash-month-note").textContent).toBe(
      "How August 2026 ended. Goals, Waiting on you and the figures below are as of today."
    );
  });

  test("with a what-if on, a past month says the what-if never changes it", () => {
    render(<DashboardSection {...props} whatIfOn summary={withSource()} />);
    expect(screen.getByTestId("dash-month-note").textContent).toMatch(/A what-if never changes a past month: these are what happened\.$/);
    expect(screen.getByTestId("dash-figure-burn").textContent).toBe("$7,000.00");
  });
});

describe("the month lives in the link", () => {
  test("previous writes the month into the link; This month takes it out again", () => {
    render(<DashboardSection {...props} summary={withSource()} />);
    fireEvent.click(prev());
    expect(window.location.hash).toBe("#/dashboard?month=2026-09");
    expect(screen.getByTestId("dash-month-name").textContent).toBe("September 2026");
    fireEvent.click(prev());
    expect(window.location.hash).toBe("#/dashboard?month=2026-08");
    expect(screen.getByTestId("dash-figure-spent-this-month").textContent).toBe("$315.00");
    fireEvent.click(screen.getByRole("button", { name: "This month" }));
    expect(window.location.hash).toBe("#/dashboard");
    expect(screen.getByTestId("dash-month-name").textContent).toBe("October 2026");
    expect(screen.getByText("This month so far")).toBeTruthy();
  });

  test("next from last month lands on this month with a clean link", () => {
    window.history.replaceState(null, "", "#/dashboard?month=2026-09");
    render(<DashboardSection {...props} summary={withSource()} />);
    fireEvent.click(next());
    expect(window.location.hash).toBe("#/dashboard");
    expect(next().disabled).toBe(true);
  });

  test("Back (a hash change) brings the month in the link back", () => {
    render(<DashboardSection {...props} summary={withSource()} />);
    window.history.replaceState(null, "", "#/dashboard?month=2026-08");
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(screen.getByTestId("dash-month-name").textContent).toBe("August 2026");
  });

  test("a future month in the link is this month", () => {
    window.history.replaceState(null, "", "#/dashboard?month=2026-12");
    render(<DashboardSection {...props} summary={withSource()} />);
    expect(screen.getByTestId("dash-month-name").textContent).toBe("October 2026");
    expect(screen.getByText("This month so far")).toBeTruthy();
  });
});
