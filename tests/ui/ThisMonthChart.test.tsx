// @vitest-environment jsdom
// tests/ui/ThisMonthChart.test.tsx
//
// The spending chart inside "This month so far".
//
// The dropdown between last month and the
// average month is gone; both comparisons show at once and the chart draws both
// lines (tests/ui/ThisMonthSameDays.test.tsx). The dropdown's tests (starts on the
// average month, remembered on this computer, a stored value that is not one of
// the two) were retired with it; the rest below still hold.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
const charts = mockChartBase();

import { mockChartBase } from "./charts/mock-chart-base";
import ThisMonthCard from "../../src/ui/dashboard/ThisMonthCard";
import SpendingChartCard from "../../src/ui/dashboard/SpendingChartCard";
import { TOP_CATEGORIES_KEY } from "../../src/ui/dashboard/TopCategories";
import { formatPeriodLabel } from "../../src/domain/period";
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

/**
 * The Dashboard's arrangement now: the chart on its own
 * card, then the spending card. These tests read both, as the Dashboard shows them.
 */
function Dash(props: Parameters<typeof ThisMonthCard>[0]) {
  return (
    <>
      {props.curves && props.spent && (
        <SpendingChartCard curves={props.curves} endedLabel={props.ended ? formatPeriodLabel(props.ended.month) : null} />
      )}
      <ThisMonthCard {...props} />
    </>
  );
}

// Top categories starts folded; these tests read the open list.
beforeEach(() => window.localStorage.setItem(TOP_CATEGORIES_KEY, "open"));

beforeEach(() => {
  window.localStorage.clear();
  charts.reset();
});
afterEach(cleanup);

const spent: MonthToDate = {
  period: resolvePeriod("this-month", "2026-10-20"),
  cents: 150000,
  baseline: { range: { from: "2026-09-01", to: "2026-09-20" }, cents: 120000 },
  leftOverCents: 0,
  savingCents: 0,
  topCategories: [],
};

const ramp = (length: number, end: number) => Array.from({ length }, (_, i) => Math.round((end * (i + 1)) / length));

const curves: SpendingCurves = {
  month: "2026-10",
  today: 20,
  days: 31,
  thisMonth: ramp(20, 150000),
  lastMonth: ramp(31, 186000), // Day 20 = 120000
  averageMonth: ramp(31, 310000), // Day 20 = 200000
  lastMonthLabel: "September",
};

const note = (id = "dash-spent-note") => screen.getByTestId(id).textContent ?? "";

describe("the spending chart", () => {
  test("the average month's figure is not a link: it is twelve separate stretches of days", () => {
    render(<Dash spent={spent} curves={curves} />);
    expect(screen.getByTestId("dash-spent-vs-average").querySelector("a[data-ledger]")).toBeNull();
  });

  test("without 12 months of history the average says so, and the chart leaves its line off", () => {
    render(<Dash spent={spent} curves={{ ...curves, averageMonth: null }} />);
    expect(note("dash-spent-vs-average")).toBe("Not enough history to compare with the 12-month average.");
    expect(screen.getByTestId("spend-chart-summary").textContent).not.toContain("Average month");
  });

  test("the chart's summary states every figure for screen readers", () => {
    render(<Dash spent={spent} curves={curves} />);
    expect(screen.getByTestId("spend-chart-summary").textContent).toBe(
      "This month so far: $1,500.00 through Day 20. September by Day 20: $1,200.00; by Day 31: $1,860.00. Average month by Day 20: $2,000.00; by Day 31: $3,100.00."
    );
  });

  test("on the 1st, this month's single point is still marked", () => {
    const first: SpendingCurves = { ...curves, today: 1, thisMonth: [300] };
    render(<Dash spent={{ ...spent, period: resolvePeriod("this-month", "2026-10-01"), cents: 300 }} curves={first} />);
    expect(screen.getByTestId("spend-chart-summary").textContent).toContain("This month so far: $3.00 through Day 1.");
    // The chart is given this month's one point, with exactly one dot (today's), beside both comparison lines.
    const chart = charts.last("Spending by day, this month against September and the average month");
    expect(chart.series.map((s) => s.id)).toEqual(["thisMonth", "lastMonth", "averageMonth"]);
    expect(chart.series[0].points.filter((p) => p.cents !== null)).toEqual([{ x: "1", cents: 300 }]);
    expect(chart.marks).toEqual([{ kind: "dot", seriesId: "thisMonth", x: "1" }]);
  });

  test("with no curves yet the card still shows its figures", () => {
    render(<Dash spent={spent} curves={null} />);
    expect(screen.getByTestId("dash-figure-spent-this-month").textContent).toBe("$1,500.00");
    expect(note("dash-spent-vs-last")).toContain("Last month, same days (Sep 1 to Sep 20): $1,200.00");
    expect(screen.queryByTestId("dash-spent-vs-average")).toBeNull();
  });
});
