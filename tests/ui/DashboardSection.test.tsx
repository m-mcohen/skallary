// @vitest-environment jsdom
// tests/ui/DashboardSection.test.tsx
//
// The landing screen. It inherits every figure the masthead carried -- the
// point of retiring the masthead was its 480px height, not its numbers -- so
// the headline test is that nothing was dropped on the way across.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DashboardSection from "../../src/ui/DashboardSection";
import type { HeadState } from "../../src/ui/lib/useMastheadSummary";
import { TOP_CATEGORIES_KEY } from "../../src/ui/dashboard/TopCategories";

afterEach(cleanup);

const summary = {
  reading: {
    drawableCents: 7500000,
    burnCents: 700000,
    runwayMonths: 10.7,
    crossPeriod: "2027-08",
    series: [
      { period: "2026-09", cents: 7500000 },
      { period: "2026-10", cents: 6900000 },
    ],
  },
  baselineSeries: null,
  scenarioLabel: null,
  heldBackCents: 1800000,
  recurringCents: 600000,
  variableCents: 100000,
  accountCount: 7,
  uncategorizedCount: 0,
  ruleCount: 100,
  lastSyncedAt: "2026-09-02T14:07:00-04:00",
  trailingCents: 650000,
  lastSeedAt: "2026-09-02T14:07:00-04:00",
  reseedDue: false,
} as unknown as HeadState;

const props = { summary, planId: "p1", onChanged: () => {} };

describe("DashboardSection", () => {
  // A bank needing a sign-in lets the sync carry
  // on, so the one place to look after a Sync has to say so.
  // The line reads the shared bank-problems list, so a quiet bank
  // (no new data for more than 3 days, and no error) is named here too.
  test("names each bank that needs attention, a sign-in or a quiet bank, beside Synced", () => {
    const bankProblems = [
      { kind: "sign-in" as const, bank: "Example Brokerage", lastDataDate: null },
      { kind: "quiet" as const, bank: "Sample Card Bank", lastDataDate: "2026-09-22" },
    ];
    render(<DashboardSection {...props} summary={{ ...summary, bankProblems } as HeadState} />);
    const line = screen.getByTestId("dash-sign-in");
    expect(line.textContent).toMatch(/^Example Brokerage needs a sign-in\. No new data from Sample Card Bank since Sep 22(, 2026)?$/);
    expect(line.className).toMatch(/text-destructive/);
  });

  test("says nothing about banks when none needs attention", () => {
    render(<DashboardSection {...props} summary={{ ...summary, bankProblems: [] } as HeadState} />);
    expect(screen.queryByTestId("dash-sign-in")).toBeNull();
  });

  // Monthly budget follows a what-if, Fixed and Variable do
  // not, so while one is on their labels say so (they summed to the old budget).
  test("while a what-if is on, Fixed and Variable say they are before it", () => {
    render(<DashboardSection {...props} whatIfOn />);
    expect(screen.getByText("Fixed costs (budget, before the what-if)")).toBeTruthy();
    expect(screen.getByText("Variable costs (budget, before the what-if)")).toBeTruthy();
  });

  test("with real numbers, Fixed and Variable keep their plain labels", () => {
    render(<DashboardSection {...props} />);
    expect(screen.getByText("Fixed costs (budget)")).toBeTruthy();
    expect(screen.queryByText(/before the what-if/)).toBeNull();
  });

  test("says nothing about sign-ins when every bank is fine", () => {
    render(<DashboardSection {...props} />);
    expect(screen.queryByTestId("dash-sign-in")).toBeNull();
  });

  // The runway has its own screen, so
  // the Dashboard stops repeating it. Its hero, floor badge, overlay badge and
  // Runs out tile are gone; This month so far and a Goals card take their place.
  test("the Dashboard no longer repeats the runway", () => {
    render(<DashboardSection {...props} />);
    expect(screen.queryByTestId("dash-runway")).toBeNull();
    expect(screen.queryByText("Runs out")).toBeNull();
    expect(screen.queryByText(/Below 12-month floor/)).toBeNull();
    expect(screen.queryByTestId("dash-figure-runs-out")).toBeNull();
  });

  test("shows the Goals card, which links to Goals", () => {
    render(<DashboardSection {...props} />);
    expect(screen.getByRole("link", { name: "Open Goals" }).getAttribute("href")).toBe("#/goals/goals");
  });

  test("carries every figure the masthead did", () => {
    render(<DashboardSection {...props} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/\$75,000\.00/); // drawable
    expect(text).toMatch(/\$7,000\.00/); // burn
    expect(text).toMatch(/\$18,000\.00/); // held back
    expect(text).toMatch(/\$6,500\.00/); // trailing 12mo
    expect(text).toMatch(/\$6,000\.00/); // recurring
    expect(text).toMatch(/\$1,000\.00/); // variable
    expect(screen.getByText("100 rules")).toBeTruthy(); // rules
    expect(screen.getByText("7 accounts")).toBeTruthy(); // account count
  });

  test("the tiles say Monthly budget and Average spent, last 12 months", () => {
    render(<DashboardSection {...props} />);
    expect(screen.getByText("Monthly budget")).toBeTruthy();
    expect(screen.getByText("Average spent, last 12 months")).toBeTruthy();
    expect(screen.queryByText("Budget / month")).toBeNull();
    expect(screen.queryByText("Trailing 12mo")).toBeNull();
  });

  // Budget figures are plain positive amounts.
  test("Monthly budget, Fixed and Variable read as plain positive amounts", () => {
    render(<DashboardSection {...props} />);
    for (const id of ["burn", "recurring", "variable"]) {
      const el = screen.getByTestId(`dash-figure-${id}`);
      expect(el.className).not.toMatch(/text-destructive/);
      expect(el.textContent).toMatch(/^\$[\d,]+\.\d\d$/);
    }
  });

  test("every figure is mono with tabular numerals", () => {
    render(<DashboardSection {...props} />);
    for (const el of screen.getAllByTestId(/^dash-figure-/)) {
      expect(el.className).toMatch(/font-mono/);
      expect(el.className).toMatch(/tabular-nums/);
    }
  });

  test("marks a due review in the outflow colour", () => {
    render(
      <DashboardSection {...props} summary={{ ...summary, reseedDue: true } as HeadState} />
    );
    expect(screen.getByTestId("dash-seed").className).toMatch(/text-destructive/);
    expect(screen.getByTestId("dash-seed").textContent).toMatch(/Review due/);
  });

  test("renders skeletons rather than zeros before the read lands", () => {
    render(<DashboardSection {...props} summary={null} />);
    expect(document.body.textContent).not.toMatch(/\$0\.00/);
  });
});

// A summed figure opens the ledger behind it. "Trailing 12mo" is an
// average, the total of twelve complete months divided by 12, so its ledger
// spans those months and carries the divisor; the ledger then shows both numbers.
describe("DashboardSection trailing figure click-through", () => {
  const window = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

  test("links to spending over its twelve months, divided by 12, with Back to the Dashboard", () => {
    render(<DashboardSection {...props} summary={{ ...summary, trailingWindow: window } as HeadState} />);
    const link = screen.getByTestId("dash-figure-trailing").querySelector("a[data-ledger]")!;
    expect(link.textContent).toBe("$6,500.00");
    const q = new URLSearchParams(link.getAttribute("href")!.split("?")[1]);
    expect(Object.fromEntries(q)).toEqual({
      ledger: "1",
      label: "Spending, trailing 12 months",
      kind: "expense",
      from: "2025-09-01",
      to: "2026-08-31",
      counted: "1",
      div: "12",
      back: "#/dashboard",
    });
  });

  test("with no window known yet, or nothing spent, it is plain text", () => {
    render(<DashboardSection {...props} />);
    expect(screen.getByTestId("dash-figure-trailing").querySelector("a")).toBeNull();
    cleanup();
    render(<DashboardSection {...props} summary={{ ...summary, trailingCents: 0, trailingWindow: window } as HeadState} />);
    expect(screen.getByTestId("dash-figure-trailing").querySelector("a")).toBeNull();
  });

  test("the figures that are balances, plan lines, or projections do not open anything", () => {
    render(<DashboardSection {...props} summary={{ ...summary, trailingWindow: window } as HeadState} />);
    for (const id of ["drawable", "burn", "held-back", "recurring", "variable"]) {
      expect(screen.getByTestId(`dash-figure-${id}`).querySelector("a"), id).toBeNull();
    }
  });
});

// Comparisons on the Dashboard too. One new
// tile, "Spent this month", against the same days of last month.
describe("DashboardSection Spent this month", () => {
  // Top categories starts folded; these read the open list.
  beforeEach(() => window.localStorage.setItem(TOP_CATEGORIES_KEY, "open"));
  afterEach(() => window.localStorage.clear());
  const spent = {
    period: { preset: "this-month" as const, from: "2026-09-01", to: "2026-09-20" },
    cents: 312000,
    // Each top category on the same days of last month.
    baseline: { range: { from: "2026-08-01", to: "2026-08-20" }, cents: 280000, byCategory: { Rent: 200000, Groceries: 45000 } },
    leftOverCents: 110000,
    topCategories: [
      { category: "Rent", cents: 200000 },
      { category: "Groceries", cents: 50000 },
    ],
  };
  const withTile = (over: Partial<typeof spent> | null = {}) =>
    ({ ...summary, spentThisMonth: over === null ? null : { ...spent, ...over } }) as HeadState;

  test("shows the figure, links it to this month's spending, and compares on the same days", () => {
    render(<DashboardSection {...props} summary={withTile()} />);
    const figure = screen.getByTestId("dash-figure-spent-this-month");
    expect(figure.textContent).toBe("$3,120.00");
    const link = figure.querySelector("a[data-ledger]")!;
    const q = new URLSearchParams(link.getAttribute("href")!.split("?")[1]);
    expect(Object.fromEntries(q)).toEqual({ ledger: "1", label: "Spending, this month", kind: "expense", from: "2026-09-01", to: "2026-09-20", counted: "1", back: "#/dashboard" });

    const note = screen.getByTestId("dash-spent-note");
    // The dates are named, and the average month's line sits beside it (no chart data here).
    expect(note.textContent).toMatch(/^Through Sep 20\./);
    expect(screen.getByTestId("dash-spent-vs-last").textContent).toBe("Last month, same days (Aug 1 to Aug 20): $2,800.00 +$320.00 (+11.4%)");
    const baseline = note.querySelector("a[data-ledger]")!;
    const bq = new URLSearchParams(baseline.getAttribute("href")!.split("?")[1]);
    expect(bq.get("from")).toBe("2026-08-01");
    expect(bq.get("to")).toBe("2026-08-20");
    const change = screen.getByTestId("dash-spent-change");
    expect(change.getAttribute("data-favorable")).toBe("false"); // more spending
    expect(change.getAttribute("title")).toBe("Up, unfavorable");
  });

  test("less spending is favorable; a zero baseline gives dollars but no percent", () => {
    render(<DashboardSection {...props} summary={withTile({ cents: 100000 })} />);
    expect(screen.getByTestId("dash-spent-change").getAttribute("data-favorable")).toBe("true");
    cleanup();
    render(<DashboardSection {...props} summary={withTile({ baseline: { range: { from: "2026-08-01", to: "2026-08-20" }, cents: 0, byCategory: { Rent: 0, Groceries: 0 } } })} />);
    expect(screen.getByTestId("dash-spent-change").textContent).toBe("+$3,120.00 (n/a)");
  });

  test("with no history to compare, it says so; before the figure is ready, the card shows it is loading", () => {
    render(<DashboardSection {...props} summary={withTile({ baseline: null })} />);
    expect(screen.getByTestId("dash-spent-vs-last").textContent).toBe("Not enough history to compare with last month.");
    cleanup();
    render(<DashboardSection {...props} summary={withTile(null)} />);
    expect(screen.getByText("This month so far")).toBeTruthy();
    expect(screen.queryByTestId("dash-figure-spent-this-month")).toBeNull();
    expect(screen.getByTestId("month-loading")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\u2014/);
  });

  test("This month so far shows spending, what is left over, and the top categories", () => {
    render(<DashboardSection {...props} summary={withTile()} />);
    expect(screen.getByText("This month so far")).toBeTruthy();
    expect(screen.getByTestId("month-left-over").textContent).toBe("$1,100.00");
    const rent = screen.getByTestId("month-top-Rent");
    expect(rent.textContent).toContain("$2,000.00");
    expect(screen.getByTestId("month-top-Groceries").textContent).toContain("$500.00");
  });

  test("each top category and Left over open ledgers of this month's rows", () => {
    render(<DashboardSection {...props} summary={withTile()} />);
    const rent = screen.getByTestId("month-top-Rent").querySelector("a[data-ledger]")!;
    const q = Object.fromEntries(new URLSearchParams(rent.getAttribute("href")!.split("?")[1]));
    expect(q).toMatchObject({ kind: "expense", from: "2026-09-01", to: "2026-09-20", back: "#/dashboard" });
    expect(q.cat).toBe("Rent");
    const left = screen.getByTestId("month-left-over").querySelector("a[data-ledger]")!;
    const lq = Object.fromEntries(new URLSearchParams(left.getAttribute("href")!.split("?")[1]));
    expect(lq).toMatchObject({ from: "2026-09-01", to: "2026-09-20", back: "#/dashboard" });
    expect(lq.kind).toBeUndefined();
  });

  // Left over is earned minus spent, and a move into
  // or out of savings is named on its own line under it, opening its own ledger.
  test("money taken from investments is its own line under Left over, not part of it", () => {
    render(<DashboardSection {...props} summary={withTile({ leftOverCents: 110000, savingCents: -500000 })} />);
    expect(screen.getByTestId("month-left-over").textContent).toBe("$1,100.00");
    const moved = screen.getByTestId("month-saving");
    expect(moved.textContent).toBe("Taken from investments $5,000.00");
    const q = Object.fromEntries(new URLSearchParams(moved.querySelector("a[data-ledger]")!.getAttribute("href")!.split("?")[1]));
    expect(q).toMatchObject({ kind: "saving", from: "2026-09-01", to: "2026-09-20" });
  });

  test("money put into investments reads that way; no move, no line", () => {
    render(<DashboardSection {...props} summary={withTile({ savingCents: 400000 })} />);
    expect(screen.getByTestId("month-saving").textContent).toBe("Put into investments $4,000.00");
    cleanup();
    render(<DashboardSection {...props} summary={withTile({ savingCents: 0 })} />);
    expect(screen.queryByTestId("month-saving")).toBeNull();
  });

  test("a month with nothing spent yet says so instead of an empty list", () => {
    render(<DashboardSection {...props} summary={withTile({ cents: 0, baseline: null, leftOverCents: 0, topCategories: [] })} />);
    expect(screen.getByText("Nothing spent yet this month.")).toBeTruthy();
    expect(screen.getByTestId("month-left-over").textContent).toBe("$0.00");
  });
});

// An Income card, the spending card's
// twin, directly under This month so far.
describe("DashboardSection Income card", () => {
  const income = {
    period: { preset: "this-month" as const, from: "2026-09-01", to: "2026-09-30" },
    cents: 700000,
    baseline: { range: { from: "2026-08-01", to: "2026-08-31" }, cents: 500000 },
    investmentIncomeCents: 7000,
    topSources: [
      { payeeKey: "acme consulting", label: "Acme Consulting", cents: 500000 },
      { payeeKey: "online deposit check #1", label: "Online Deposit Check #1", cents: 200000 },
    ],
  };
  const withIncome = (over: Partial<typeof income> | null = {}) =>
    ({ ...summary, incomeThisMonth: over === null ? null : { ...income, ...over } }) as unknown as HeadState;

  test("shows income so far, opening this month's income ledger", () => {
    render(<DashboardSection {...props} summary={withIncome()} />);
    const figure = screen.getByTestId("dash-figure-income-this-month");
    expect(figure.textContent).toBe("$7,000.00");
    const q = Object.fromEntries(new URLSearchParams(figure.querySelector("a[data-ledger]")!.getAttribute("href")!.split("?")[1]));
    expect(q).toMatchObject({ kind: "income", from: "2026-09-01", to: "2026-09-30", back: "#/dashboard" });
  });

  test("more income than last month is favorable", () => {
    render(<DashboardSection {...props} summary={withIncome()} />);
    expect(screen.getByTestId("dash-income-note").textContent).toBe("Through Sep 30. Last month: $5,000.00 +$2,000.00 (+40.0%)");
    expect(screen.getByTestId("dash-income-change").getAttribute("data-favorable")).toBe("true");
  });

  test("each source opens its payer's deposits, and investments paid is its own line", () => {
    render(<DashboardSection {...props} summary={withIncome()} />);
    const st = screen.getByTestId("income-source-acme consulting");
    expect(st.textContent).toContain("Acme Consulting");
    expect(st.textContent).toContain("$5,000.00");
    const q = Object.fromEntries(new URLSearchParams(st.querySelector("a[data-ledger]")!.getAttribute("href")!.split("?")[1]));
    expect(q).toMatchObject({ kind: "income", payee: "acme consulting", from: "2026-09-01", to: "2026-09-30" });
    const inv = screen.getByTestId("income-investments");
    expect(inv.textContent).toBe("Investments paid $70.00");
    const iq = Object.fromEntries(new URLSearchParams(inv.querySelector("a[data-ledger]")!.getAttribute("href")!.split("?")[1]));
    expect(iq.kind).toBe("investment_income");
  });

  test("no investment income, no line; no income yet says so; not loaded yet shows loading", () => {
    render(<DashboardSection {...props} summary={withIncome({ cents: 0, baseline: null, investmentIncomeCents: 0, topSources: [] })} />);
    expect(screen.queryByTestId("income-investments")).toBeNull();
    expect(screen.getByText("No income yet this month.")).toBeTruthy();
    expect(screen.getByTestId("dash-income-note").textContent).toBe("Through Sep 30. Not enough history to compare with last month.");
    cleanup();
    render(<DashboardSection {...props} summary={withIncome(null)} />);
    expect(screen.getByTestId("income-loading")).toBeTruthy();
  });

  test("it sits directly under This month so far", () => {
    render(<DashboardSection {...props} summary={withIncome()} />);
    const cards = [...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label"));
    expect(cards.indexOf("Income this month")).toBe(cards.indexOf("This month so far") + 1);
  });
});

// A deposit with no payer name has no payer to
// filter on, so a link would open all income; it is listed but not clickable.
test("an unnamed income source is listed without a ledger link", () => {
  const income = {
    period: { preset: "this-month" as const, from: "2026-09-01", to: "2026-09-30" },
    cents: 100000, baseline: null, investmentIncomeCents: 0,
    topSources: [{ payeeKey: "", label: "Unnamed deposit", cents: 10000 }, { payeeKey: "employer", label: "Employer", cents: 90000 }],
  };
  render(<DashboardSection {...props} summary={{ ...summary, incomeThisMonth: income } as unknown as HeadState} />);
  const unnamed = screen.getByTestId("income-source-unnamed");
  expect(unnamed.textContent).toContain("$100.00");
  expect(unnamed.querySelector("a[data-ledger]")).toBeNull();
  expect(screen.getByTestId("income-source-employer").querySelector("a[data-ledger]")).toBeTruthy();
});

// The Recurring panel follows the spending and income cards. The Income
// card keeps its 9-30 place (Placement A: directly under This month so far).
// The Recurring below Waiting on you and the tiles; the
// whole order is pinned in tests/ui/DashboardOrder.test.tsx.
test("Income sits beside This month so far, and Recurring comes after Waiting on you", () => {
  render(<DashboardSection {...props} />);
  const cards = [...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label"));
  const month = cards.indexOf("This month so far");
  expect(cards[month + 1]).toBe("Income this month");
  expect(cards.indexOf("Recurring")).toBeGreaterThan(cards.indexOf("Waiting on you"));
});

// "Recurring" now names charges, so the budget's two tiles say what they are.
test("the budget tiles read Fixed costs (budget) and Variable costs (budget)", () => {
  render(<DashboardSection {...props} />);
  const label = (id: string) => screen.getByTestId(`dash-figure-${id}`).parentElement!.firstElementChild!.textContent;
  expect(label("recurring")).toBe("Fixed costs (budget)");
  expect(label("variable")).toBe("Variable costs (budget)");
});
