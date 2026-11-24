// @vitest-environment jsdom
// tests/ui/LastDayWholeMonths.test.tsx
//
// On a month's last day, This month so far compares whole
// months everywhere. Last month already did (compare.ts: a whole month maps to a whole
// month); now the average month and the chart read Day 31 too, so all three agree.
//
// Fixture, worked by hand: Sep 30 (September has 30 days), spent $1,500.00.
//   Last month: all of August, $1,860.00. Change -$360.00, 360 / 1,860 = 19.35% -> -19.4%.
//   Average month: Day 31 of the ramp is $3,100.00 (Day 30 would be 310,000 x 30 / 31 =
//   $3,000.00). Change -$1,600.00, 1,600 / 3,100 = 51.61% -> -51.6%.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";


import ThisMonthCard from "../../src/ui/dashboard/ThisMonthCard";
import { chartRows, chartSummary } from "../../src/ui/dashboard/SpendingChart";
import { resolvePeriod } from "../../src/domain/period";
import type { MonthToDate } from "../../src/domain/compare";
import { comparisonDay, type SpendingCurves } from "../../src/domain/spending-curve";
import { helpByKey } from "../../src/help";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error -- jsdom polyfill for tests only
  global.ResizeObserver = ResizeObserverStub;
});
afterEach(cleanup);

const ramp = (length: number, end: number) => Array.from({ length }, (_, i) => Math.round((end * (i + 1)) / length));

const curvesOn = (month: string, today: number): SpendingCurves => ({
  month,
  today,
  days: 31,
  thisMonth: ramp(today, 150000),
  lastMonth: ramp(31, 186000),
  averageMonth: ramp(31, 310000),
  lastMonthLabel: "August",
});

const spentOn = (asOf: string, baselineTo: string): MonthToDate => ({
  period: resolvePeriod("this-month", asOf),
  cents: 150000,
  baseline: { range: { from: "2026-08-01", to: baselineTo }, cents: 186000, byCategory: {} },
  leftOverCents: 0,
  savingCents: 0,
  topCategories: [],
});

const text = (id: string) => (screen.getByTestId(id).textContent ?? "").replace(/\s+/g, " ").trim();

describe("comparisonDay: the day the comparisons are read at", () => {
  test("today, on any day before the month's last", () => {
    expect(comparisonDay(curvesOn("2026-09", 29))).toBe(29);
    expect(comparisonDay(curvesOn("2026-10", 20))).toBe(20);
    expect(comparisonDay(curvesOn("2026-10", 30))).toBe(30);
  });
  test("Day 31 on the month's last day, whatever its length", () => {
    expect(comparisonDay(curvesOn("2026-09", 30))).toBe(31);
    expect(comparisonDay(curvesOn("2026-10", 31))).toBe(31);
    expect(comparisonDay(curvesOn("2026-02", 28))).toBe(31);
    expect(comparisonDay(curvesOn("2028-02", 29))).toBe(31);
    expect(comparisonDay(curvesOn("2028-02", 28))).toBe(28);
  });
});

describe("This month so far on Sep 30: whole months everywhere", () => {
  test("the average month reads Day 31 and says whole month", () => {
    render(<ThisMonthCard spent={spentOn("2026-09-30", "2026-08-31")} curves={curvesOn("2026-09", 30)} />);
    expect(text("dash-spent-vs-average")).toBe("12-month average, whole month: $3,100.00 -$1,600.00 (-51.6%)");
  });
  test("last month says whole month, with its dates", () => {
    render(<ThisMonthCard spent={spentOn("2026-09-30", "2026-08-31")} curves={curvesOn("2026-09", 30)} />);
    expect(text("dash-spent-vs-last")).toBe("Last month, whole month (Aug 1 to Aug 31): $1,860.00 -$360.00 (-19.4%)");
  });
  test("the chart's summary reads each line whole", () => {
    expect(chartSummary(curvesOn("2026-09", 30))).toBe(
      "This month so far: $1,500.00 through Day 30. August, whole month: $1,860.00. Average month, whole month: $3,100.00."
    );
  });
  test("this month's line carries its total to Day 31, the way a short comparison month does", () => {
    const rows = chartRows(curvesOn("2026-09", 30));
    expect(rows[29].thisMonth).toBe(150000);
    expect(rows[30].thisMonth).toBe(150000);
  });
});

describe("help says so", () => {
  test("Spent this month and Spending by day name the last-day rule", () => {
    const how = (label: string) => helpByKey("dashboard")!.numbers!.find((n) => n.label === label)?.how ?? "";
    expect(how("Spent this month")).toContain(
      "On the month's last day the month is whole, so every line compares whole months: Last month, whole month and 12-month average, whole month."
    );
    expect(how("Spending by day")).toContain("On the month's last day this month's line carries its total to Day 31");
  });
});

describe("the day before: same days, unchanged", () => {
  test("Sep 29 reads Day 29 and stops this month's line at today", () => {
    render(<ThisMonthCard spent={spentOn("2026-09-29", "2026-08-29")} curves={curvesOn("2026-09", 29)} />);
    // Day 29 of the average ramp: 310,000 x 29 / 31 = 290,000. -$1,400.00, 1,400 / 2,900 = 48.28% -> -48.3%.
    expect(text("dash-spent-vs-average")).toBe("12-month average, same days: $2,900.00 -$1,400.00 (-48.3%)");
    expect(text("dash-spent-vs-last")).toMatch(/^Last month, same days \(Aug 1 to Aug 29\): /);
    expect(chartRows(curvesOn("2026-09", 29))[29].thisMonth).toBeUndefined();
  });
});
