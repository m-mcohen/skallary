// @vitest-environment jsdom
// tests/ui/DashboardCompareTicks.test.tsx
//
// The Dashboard's Compare with: one shared set of ticks (last month, the same month last
// year, the 3-month and the 12-month average) decides the lines under Spent this month
// and the chart's lines. Invented figures throughout.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
const charts = mockChartBase();

import { mockChartBase } from "./charts/mock-chart-base";
import ThisMonthCard, { reportsHref } from "../../src/ui/dashboard/ThisMonthCard";
import SpendingChartCard from "../../src/ui/dashboard/SpendingChartCard";
import { TICKS_KEY, readTicks, setTick } from "../../src/ui/dashboard/compare-ticks";
import { resolvePeriod } from "../../src/domain/period";
import type { MonthToDate } from "../../src/domain/compare";
import type { SpendingCurves } from "../../src/domain/spending-curve";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error -- jsdom polyfill for tests only
  global.ResizeObserver = ResizeObserverStub;
});
beforeEach(() => {
  window.localStorage.clear();
  charts.reset();
});
afterEach(cleanup);

const ramp = (length: number, end: number) => Array.from({ length }, (_, i) => Math.round((end * (i + 1)) / length));

const spent: MonthToDate = {
  period: resolvePeriod("this-month", "2026-10-20"),
  cents: 150000,
  baseline: { range: { from: "2026-09-01", to: "2026-09-20" }, cents: 120000, byCategory: {} },
  leftOverCents: 0,
  savingCents: 0,
  topCategories: [],
};

const curves: SpendingCurves = {
  month: "2026-10",
  today: 20,
  days: 31,
  thisMonth: ramp(20, 150000),
  lastMonth: ramp(31, 186000), // Day 20 = 120000
  averageMonth: ramp(31, 310000), // Day 20 = 200000
  lastMonthLabel: "September",
  lastYear: ramp(31, 155000), // Day 20 = 100000
  averageThree: ramp(31, 248000), // Day 20 = 160000
  lastYearLabel: "October 2025",
};

function Dash() {
  return (
    <>
      <SpendingChartCard curves={curves} endedLabel={null} />
      <ThisMonthCard spent={spent} curves={curves} />
    </>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent ?? "";
const chartIds = () => charts.calls[charts.calls.length - 1].series.map((s) => s.id);

describe("Compare with", () => {
  test("ticking the 3-month average and unticking last month changes the card and the chart together", () => {
    render(<Dash />);
    act(() => {
      setTick("averageThree", true);
      setTick("lastMonth", false);
    });
    expect(text("dash-spent-vs-average-3")).toBe("3-month average, same days: $1,600.00 -$100.00 (-6.3%)");
    expect(screen.queryByTestId("dash-spent-vs-last")).toBeNull();
    expect(chartIds()).toEqual(["thisMonth", "averageThree", "averageMonth"]);
    expect(JSON.parse(window.localStorage.getItem(TICKS_KEY)!)).toEqual(["averageThree", "averageMonth"]);
  });

  test("the same month last year reads its same days and opens their ledger", () => {
    window.localStorage.setItem(TICKS_KEY, JSON.stringify(["lastYear"]));
    render(<Dash />);
    expect(text("dash-spent-vs-last-year")).toBe("October 2025, same days (Oct 1 to Oct 20): $1,000.00 +$500.00 (+50.0%)");
    const link = screen.getByTestId("dash-spent-vs-last-year").querySelector("a[data-ledger]")!;
    const q = new URLSearchParams(link.getAttribute("href")!.split("?")[1]);
    expect([q.get("from"), q.get("to"), q.get("kind")]).toEqual(["2025-10-01", "2025-10-20", "expense"]);
    expect(chartIds()).toEqual(["thisMonth", "lastYear"]);
  });

  test("junk in storage reads as the first-time ticks: last month and the 12-month average", () => {
    window.localStorage.setItem(TICKS_KEY, '["lastMonth","nonsense"]');
    expect(readTicks()).toEqual(["lastMonth", "averageMonth"]);
    window.localStorage.setItem(TICKS_KEY, "{not json");
    expect(readTicks()).toEqual(["lastMonth", "averageMonth"]);
  });

  test("See by category opens Reports on the card's own days, against the 3-month average", () => {
    expect(reportsHref(spent, false)).toBe("#/reports?period=this-month&compare=avg-3&allcat=1");
    const ended = { ...spent, period: { preset: "this-month" as const, from: "2026-08-01", to: "2026-08-31" } };
    expect(reportsHref(ended, true)).toBe("#/reports?from=2026-08-01&to=2026-08-31&compare=avg-3&allcat=1");
  });
});

describe("a click on a day of a short month", () => {
  test("Day 28 of a 28-day February opens that day; Day 29, which February does not have, opens nothing", () => {
    // March 2026: last month is February 2026 (28 days); last year is March 2025.
    window.localStorage.setItem(TICKS_KEY, JSON.stringify(["lastMonth"]));
    window.location.hash = "#/dashboard";
    render(<SpendingChartCard curves={{ ...curves, month: "2026-03", lastMonthLabel: "February" }} endedLabel={null} />);
    const click = charts.calls[charts.calls.length - 1].onMarkClick!;
    act(() => click({ seriesId: "lastMonth", x: "29" }));
    expect(window.location.hash).toBe("#/dashboard");
    act(() => click({ seriesId: "lastMonth", x: "28" }));
    const q = new URLSearchParams(window.location.hash.split("?")[1]);
    expect([q.get("from"), q.get("to")]).toEqual(["2026-02-28", "2026-02-28"]);
  });
});
