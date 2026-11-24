// @vitest-environment jsdom
// tests/ui/RecurringPanel.test.tsx
//
// The Dashboard's Recurring panel: "$X remaining due"
// for this month or next, each charge with its rhythm, account, amount and when.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import RecurringPanel from "../../src/ui/dashboard/RecurringPanel";
import type { NormalizedTxn } from "../../src/domain/types";

afterEach(cleanup);

const monthly = (payee: string, dates: string[], amountCents: number): NormalizedTxn[] =>
  dates.map((date, i) => ({
    sourceTransactionId: `${payee}-${i}`,
    accountId: "a1",
    date,
    amountCents,
    sourceCategory: "Subscriptions",
    merchant: null,
    isTransfer: false,
    sourceUpdatedAt: null,
    payee,
  })) as NormalizedTxn[];

const txns = [
  ...monthly("Netflix", ["2026-07-15", "2026-08-15", "2026-09-15"], -1500),
  ...monthly("City Gym", ["2026-07-02", "2026-08-02", "2026-09-02", "2026-10-02"], -4500),
  ...monthly("Sunbelt Power & Light", ["2026-07-05", "2026-08-05", "2026-09-05"], -20000),
];

const layer = (over: Record<string, unknown> = {}) => ({
  loadDb: async () => ({ base: "" }),
  getAccounts: async () => [{ id: "a1", name: "REWARDS CARD (0303)", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }],
  getTransactions: async () => txns,
  getRules: async () => [],
  getAdjustments: async () => [],
  getCategoryMappings: async () => ({}),
  getCategorySettings: async () => [],
  getRecurringChoices: async () => [],
  ...over,
});

describe("RecurringPanel", () => {
  test("says what is still due this month, still-to-come rows first, then what was paid", async () => {
    render(<RecurringPanel dataLayer={layer()} asOfDate="2026-10-10" />);
    expect((await screen.findByTestId("recurring-remaining")).textContent).toBe("$215.00 remaining due");
    // The figure typeface is for the amount, not the words.
    const remaining = screen.getByTestId("recurring-remaining");
    expect(remaining.className).not.toMatch(/font-mono/);
    expect(remaining.querySelector(".font-mono")!.textContent).toBe("$215.00");
    const rows = screen.getAllByTestId(/^recurring-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "recurring-row-Sunbelt Power & Light",
      "recurring-row-Netflix",
      "recurring-row-City Gym",
    ]);
    expect(rows[0].textContent).toContain("Not charged yet, due Oct 5");
    expect(rows[0].textContent).toContain("$200.00");
    expect(rows[1].textContent).toContain("In 5 days");
    expect(rows[1].textContent).toContain("Every month");
    expect(rows[1].textContent).toContain("Rewards Card (0303)");
    expect(rows[2].textContent).toContain("Paid Oct 2");
  });

  test("a charge's name opens its payments", async () => {
    render(<RecurringPanel dataLayer={layer()} asOfDate="2026-10-10" />);
    const row = await screen.findByTestId("recurring-row-Netflix");
    const link = within(row).getByRole("link", { name: "Netflix" });
    expect(link.getAttribute("href")).toContain("payee=netflix");
    expect(link.getAttribute("href")).toContain("view=series");
  });

  test("Next month shows next month's charges, all still to come", async () => {
    render(<RecurringPanel dataLayer={layer()} asOfDate="2026-10-10" />);
    await screen.findByTestId("recurring-remaining");
    fireEvent.change(screen.getByLabelText("Which month"), { target: { value: "next" } });
    expect(screen.getByTestId("recurring-remaining").textContent).toBe("$260.00 remaining due");
    expect(screen.queryByText(/^Paid /)).toBeNull();
  });

  test("shows at most 8 charges, and always links to the full list", async () => {
    const many = Array.from({ length: 11 }, (_, i) => monthly(`Service ${i + 10}`, ["2026-07-20", "2026-08-20", "2026-09-20"], -100 - i)).flat();
    render(<RecurringPanel dataLayer={layer({ getTransactions: async () => many })} asOfDate="2026-10-10" />);
    await screen.findByTestId("recurring-remaining");
    expect(screen.getAllByTestId(/^recurring-row-/)).toHaveLength(8);
    expect(screen.getByRole("link", { name: "See all recurring" }).getAttribute("href")).toBe("#/recurring");
  });

  test("says so when nothing is due", async () => {
    render(<RecurringPanel dataLayer={layer({ getTransactions: async () => [] })} asOfDate="2026-10-10" />);
    expect(await screen.findByText("Nothing recurring is due this month.")).toBeTruthy();
  });

  test("a failed read says so in the panel only", async () => {
    render(<RecurringPanel dataLayer={layer({ loadDb: async () => { throw new Error("offline"); } })} asOfDate="2026-10-10" />);
    expect(await screen.findByText("Recurring charges could not be loaded.")).toBeTruthy();
  });

  test("a hidden charge is left out, and a failed read of the choices is said plainly", async () => {
    const hidden = [{ payeeKey: "netflix", accountId: "a1", choice: "not_recurring", cadence: null, label: "Netflix", createdAt: "2026-10-01T00:00:00.000Z" }];
    render(<RecurringPanel dataLayer={layer({ getRecurringChoices: async () => hidden })} asOfDate="2026-10-10" />);
    expect((await screen.findByTestId("recurring-remaining")).textContent).toBe("$200.00 remaining due");
    cleanup();
    render(<RecurringPanel dataLayer={layer({ getRecurringChoices: async () => { throw new Error("no route"); } })} asOfDate="2026-10-10" />);
    expect(await screen.findByText("Your Not recurring and Mark as recurring choices could not be read, so this is the app's own list.")).toBeTruthy();
  });
});

// A past month on the Dashboard shows what recurring charges
// took that month. Nothing is still to come, so no This month or Next month pick.
describe("RecurringPanel on a past month", () => {
  test("says what was paid, lists only paid rows, and opens payments with Back to that month", async () => {
    render(<RecurringPanel dataLayer={layer()} asOfDate="2026-10-10" pastMonth="2026-08" back="#/dashboard?month=2026-08" />);
    // Paid in August by hand: City Gym $45.00 (2nd) + Sunbelt Power & Light $200.00 (5th) + Netflix $15.00 (15th) = $260.00.
    const paid = await screen.findByTestId("recurring-paid");
    expect(paid.textContent).toBe("$260.00 paid in August 2026");
    expect(screen.queryByTestId("recurring-remaining")).toBeNull();
    expect(screen.queryByLabelText("Which month")).toBeNull();
    const rows = screen.getAllByTestId(/^recurring-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "recurring-row-City Gym",
      "recurring-row-Sunbelt Power & Light",
      "recurring-row-Netflix",
    ]);
    for (const r of rows) expect(r.textContent).toMatch(/Paid Aug \d+/);
    const link = within(rows[2]).getByRole("link", { name: "Netflix" });
    expect(new URLSearchParams(link.getAttribute("href")!.split("?")[1]).get("back")).toBe("#/dashboard?month=2026-08");
  });

  test("a past month with nothing charged says so", async () => {
    render(<RecurringPanel dataLayer={layer()} asOfDate="2026-10-10" pastMonth="2026-05" back="#/dashboard?month=2026-05" />);
    expect(await screen.findByText("Nothing recurring was charged in May 2026.")).toBeTruthy();
  });
});

// Netflix skipped September: its Sep 15 date is still predicted (within a month's
// grace it has not stopped). September is over, so the panel lists only what was
// paid in it, never that date as still to come.
test("a past month lists only what was paid, never a date the charge skipped", async () => {
  const skipped = [
    ...monthly("Netflix", ["2026-06-15", "2026-07-15", "2026-08-15"], -1500),
    ...monthly("City Gym", ["2026-07-02", "2026-08-02", "2026-09-02", "2026-10-02"], -4500),
    ...monthly("Sunbelt Power & Light", ["2026-07-05", "2026-08-05", "2026-09-05"], -20000),
  ];
  render(<RecurringPanel dataLayer={layer({ getTransactions: async () => skipped })} asOfDate="2026-10-10" pastMonth="2026-09" back="#/dashboard?month=2026-09" />);
  // By hand: City Gym $45.00 (Sep 2) + Sunbelt Power & Light $200.00 (Sep 5) = $245.00.
  expect((await screen.findByTestId("recurring-paid")).textContent).toBe("$245.00 paid in September 2026");
  expect(screen.queryByText(/Not charged yet/)).toBeNull();
  expect(screen.queryByTestId("recurring-row-Netflix")).toBeNull();
});
