// @vitest-environment jsdom
// tests/ui/ui-look.test.tsx
//
// The Monarch-style round (the look round): cards that fold and
// remember it, the spending chart's Cumulative and Daily views, and its date ranges
// (This month by day; 3 months, 6 months, year to date and 12 months by week, where
// Daily reads Weekly).
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SpendingChartCard from "../../src/ui/dashboard/SpendingChartCard";
import { dailyRows } from "../../src/ui/dashboard/SpendingChart";
import { spendingCurves } from "../../src/domain/spending-curve";
import type { MonthSource } from "../../src/domain/dashboard-month";
import type { Account, NormalizedTxn } from "../../src/domain/types";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error -- jsdom polyfill for tests only
  global.ResizeObserver = ResizeObserverStub;
});

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function Folding() {
  return (
    <Card foldId="thing" aria-label="Thing">
      <CardHeader>
        <CardTitle>Thing</CardTitle>
        <CardAction>
          <button type="button">Act</button>
        </CardAction>
      </CardHeader>
      <CardContent>Body text</CardContent>
    </Card>
  );
}

describe("a card that folds", () => {
  test("its title folds it shut and opens it again, and the button names the card", async () => {
    const user = userEvent.setup();
    render(<Folding />);
    expect(screen.getByText("Body text")).toBeTruthy();
    await user.click(screen.getByText("Thing"));
    await waitFor(() => expect(screen.queryByText("Body text")).toBeNull());
    expect(screen.getByRole("button", { name: "Open Thing" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open Thing" }));
    expect(await screen.findByText("Body text")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fold Thing" })).toBeTruthy();
  });

  test("a control in the header does its own job and does not fold the card", async () => {
    const user = userEvent.setup();
    render(<Folding />);
    await user.click(screen.getByRole("button", { name: "Act" }));
    expect(screen.getByText("Body text")).toBeTruthy();
  });

  test("the choice is remembered in this browser", async () => {
    const user = userEvent.setup();
    render(<Folding />);
    await user.click(screen.getByText("Thing"));
    expect(window.localStorage.getItem("ff.fold.thing")).toBe("0");
    cleanup();
    render(<Folding />);
    expect(screen.queryByText("Body text")).toBeNull();
  });

  test("a card with no fold name has no fold button", () => {
    render(
      <Card aria-label="Plain">
        <CardHeader>
          <CardTitle>Plain</CardTitle>
        </CardHeader>
        <CardContent>Always here</CardContent>
      </Card>
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Always here")).toBeTruthy();
  });
});

describe("the Daily view's numbers", () => {
  test("each day is that day's own spending, read off the running totals", () => {
    const daily = dailyRows([
      { day: 1, thisMonth: 10_000, lastMonth: 5_000 },
      { day: 2, thisMonth: 25_000, lastMonth: 5_000 },
      { day: 3, thisMonth: 20_000, lastMonth: 9_000 },
    ]);
    expect(daily.map((r) => r.thisMonth)).toEqual([10_000, 15_000, -5_000]);
    expect(daily.map((r) => r.lastMonth)).toEqual([5_000, 0, 4_000]);
  });
});

const accounts: Account[] = [
  { id: "card", name: "Card", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];
const txn = (date: string, amountCents: number) =>
  ({ sourceTransactionId: date, accountId: "card", date, amountCents, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null, payee: "Store" }) as NormalizedTxn;
const prepared = ["2026-01-05", "2026-04-09", "2026-07-14", "2026-09-03", "2026-10-02"].map((d) => txn(d, -12_345));
const asOf = "2026-10-18";
const curves = spendingCurves(prepared, accounts, {}, asOf);
const source: MonthSource = { prepared, accounts, mapping: {}, budgetLines: [], today: asOf, firstMonth: "2026-01" };

describe("the spending chart's views and ranges", () => {
  test("starts on Cumulative; Daily is remembered", async () => {
    const user = userEvent.setup();
    render(<SpendingChartCard curves={curves} endedLabel={null} source={source} asOf={asOf} />);
    expect(screen.getByText(/added up day by day/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Daily" }));
    expect(screen.getByText(/what each day cost/)).toBeTruthy();
    expect(window.localStorage.getItem("ff.spending-chart.view")).toBe("daily");
  });

  test("a longer range plots by week, and Daily reads Weekly there", () => {
    render(<SpendingChartCard curves={curves} endedLabel={null} source={source} asOf={asOf} />);
    expect(screen.getByText("Spending by day")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Date range"), { target: { value: "3m" } });
    expect(screen.getByText("Spending by week")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Weekly" })).toBeTruthy();
    expect(screen.getByText(/Last 3 months against the 3 months before/)).toBeTruthy();
    expect(window.localStorage.getItem("ff.spending-chart.range")).toBe("3m");
  });

  test("the range list, with This month named for the month shown", () => {
    render(<SpendingChartCard curves={curves} endedLabel="August 2026" source={source} asOf="2026-08-31" />);
    const options = [...(screen.getByLabelText("Date range") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(["August 2026", "3 months", "6 months", "Year to date", "12 months"]);
  });

  test("without the Dashboard's rows there is no range to pick, and the month is drawn", () => {
    window.localStorage.setItem("ff.spending-chart.range", "6m");
    render(<SpendingChartCard curves={curves} endedLabel={null} />);
    expect(screen.queryByLabelText("Date range")).toBeNull();
    expect(screen.getByText("Spending by day")).toBeTruthy();
  });
});
