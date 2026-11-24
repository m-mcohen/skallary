// tests/domain/reports.test.ts
//
// The Reports aggregation engine. Pure, so charts consume shapes tested here
// rather than eyeballed. The invariant that matters most: cash-flow net =
// income - expense, per month, to the cent. If it does not, Reports and the
// Runway panel are telling different stories about the same months.
import { describe, expect, test } from "vitest";
import {
  cashFlowByMonth,
  incomeByCategoryOverTime,
  spendingByCategoryOverTime,
} from "../../src/domain/reports";
import type { MonthlyRollup } from "../../src/domain/rollups";

const rollups: MonthlyRollup[] = [
  { period: "2026-07", planningCategory: "Groceries", kind: "expense", amountCents: 30000 },
  { period: "2026-07", planningCategory: "Rent", kind: "expense", amountCents: 210000 },
  { period: "2026-07", planningCategory: "Paychecks", kind: "income", amountCents: 800000 },
  { period: "2026-08", planningCategory: "Groceries", kind: "expense", amountCents: 45000 },
  { period: "2026-08", planningCategory: "Rent", kind: "expense", amountCents: 210000 },
  { period: "2026-08", planningCategory: "Paychecks", kind: "income", amountCents: 800000 },
];

describe("spendingByCategoryOverTime", () => {
  test("emits one series per expense category, sorted by total descending", () => {
    const { series } = spendingByCategoryOverTime(rollups);
    expect(series.map((s) => s.category)).toEqual(["Rent", "Groceries"]);
    expect(series[0].total).toBe(210000 * 2);
    expect(series[1].total).toBe(30000 + 45000);
  });

  test("carries per-month values in order, filling gaps with zero", () => {
    const { series, periods } = spendingByCategoryOverTime(rollups);
    expect(periods).toEqual(["2026-07", "2026-08"]);
    const groceries = series.find((s) => s.category === "Groceries")!;
    expect(groceries.byMonth["2026-07"]).toBe(30000);
    expect(groceries.byMonth["2026-08"]).toBe(45000);
  });

  test("excludes income from spending", () => {
    const { series } = spendingByCategoryOverTime(rollups);
    expect(series.map((s) => s.category)).not.toContain("Paychecks");
  });

  test("returns empty shapes rather than throwing on no data", () => {
    const r = spendingByCategoryOverTime([]);
    expect(r).toEqual({ periods: [], series: [], totals: [] });
  });
});

describe("incomeByCategoryOverTime", () => {
  test("excludes expenses", () => {
    const { series } = incomeByCategoryOverTime(rollups);
    expect(series.map((s) => s.category)).toEqual(["Paychecks"]);
  });
});

describe("cashFlowByMonth", () => {
  test("per-month net foots to income minus expense", () => {
    // The invariant that keeps Reports and Runway telling the same story.
    const flow = cashFlowByMonth(rollups);
    for (const m of flow) {
      expect(m.netCents).toBe(m.incomeCents - m.expenseCents);
    }
    expect(flow.find((f) => f.period === "2026-07")).toMatchObject({
      incomeCents: 800000,
      expenseCents: 30000 + 210000,
    });
  });

  test("months with only expense read as negative net, not missing", () => {
    const flow = cashFlowByMonth([
      { period: "2026-09", planningCategory: "Rent", kind: "expense", amountCents: 210000 },
    ]);
    expect(flow).toEqual([
      { period: "2026-09", incomeCents: 0, expenseCents: 210000, savingCents: 0, investmentIncomeCents: 0, netCents: -210000 },
    ]);
  });

  test("periods sort chronologically", () => {
    const flow = cashFlowByMonth([
      { period: "2026-09", planningCategory: "Rent", kind: "expense", amountCents: 1 },
      { period: "2026-07", planningCategory: "Rent", kind: "expense", amountCents: 1 },
      { period: "2026-08", planningCategory: "Rent", kind: "expense", amountCents: 1 },
    ]);
    expect(flow.map((f) => f.period)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });
});
