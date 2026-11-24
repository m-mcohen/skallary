import { describe, it, expect } from "vitest";
import { seedExpenseDefaults, seedAsOfMonth } from "../../src/domain/seed";
import type { MonthlyRollup } from "../../src/domain/rollups";

const r = (period: string, cat: string, kind: "expense" | "income", cents: number): MonthlyRollup => ({
  period,
  planningCategory: cat,
  kind,
  amountCents: cents,
});

describe("seedExpenseDefaults", () => {
  it("averages the most recent N complete months, excludes the asOf partial month, skips income", () => {
    const rollups = [
      r("2026-05", "Groceries", "expense", 100000),
      r("2026-06", "Groceries", "expense", 120000),
      r("2026-07", "Groceries", "expense", 110000),
      r("2026-08", "Groceries", "expense", 50000), // partial current, excluded
      r("2026-07", "Income", "income", 130000), // income skipped
    ];
    const out = seedExpenseDefaults(rollups, "2026-08", 3); // complete window = 05,06,07
    expect(out.window).toEqual(["2026-05", "2026-06", "2026-07"]);
    const g = out.defaults.find((d) => d.planningCategory === "Groceries")!;
    expect(g.amountCents).toBe(110000); // (100000+120000+110000)/3
    expect(out.defaults.some((d) => d.planningCategory === "Income")).toBe(false);
  });

  it("occasional category (minority of months) divides by the full window", () => {
    const rollups = [r("2026-07", "Dining", "expense", 60000)]; // only 1 of 3 window months -> not recurring
    const out = seedExpenseDefaults(rollups, "2026-08", 3); // window 05,06,07
    expect(out.defaults.find((d) => d.planningCategory === "Dining")!.amountCents).toBe(20000); // 60000/3
  });

  it("recurrence-aware: a recurring bill uses its active-month average; an annual charge divides by the window", () => {
    // 12-month window ending 2026-08 (window = 2025-09 .. 2026-08).
    const window = ["2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08"];
    const rollups: MonthlyRollup[] = [];
    // Rent: $2,100 in 9 of the 12 months (majority -> recurring). Missed 3 months (e.g. paid from an excluded account).
    for (const p of window.slice(0, 9)) rollups.push(r(p, "Rent", "expense", 210000));
    // Insurance: a single $1,200 annual charge (1 of 12 -> occasional).
    rollups.push(r("2026-03", "Insurance", "expense", 120000));
    const out = seedExpenseDefaults(rollups, "2026-09", 12);
    // Rent recurs (9/12 > 6) -> averaged over its 9 active months = its true $2,100, NOT 1,890,000/12 = 157,500.
    expect(out.defaults.find((d) => d.planningCategory === "Rent")!.amountCents).toBe(210000);
    expect(out.defaults.find((d) => d.planningCategory === "Rent")!.recurring).toBe(true);
    // Insurance occasional (1/12) -> 120000/12 = 10000, a small monthly-equivalent, NOT the full 120000.
    expect(out.defaults.find((d) => d.planningCategory === "Insurance")!.amountCents).toBe(10000);
    expect(out.defaults.find((d) => d.planningCategory === "Insurance")!.recurring).toBe(false);
  });
});

describe("seedAsOfMonth", () => {
  it("stops at the last COMPLETE month, never the one in progress", () => {
    // The seam introduced transactions dated in the current month. Treating
    // that month as complete averages one day of spending in as if it were a
    // whole month, quietly deflating every recurring category.
    expect(seedAsOfMonth("2026-09", "2026-09")).toBe("2026-09"); // window ends 2026-08
  });

  it("includes the latest month once it has actually finished", () => {
    expect(seedAsOfMonth("2026-08", "2026-09")).toBe("2026-09"); // window ends 2026-08
  });

  it("doesn't invent months when the data is stale", () => {
    // Latest actuals are months old: the window should end there, not run
    // forward through months with no data at all.
    expect(seedAsOfMonth("2026-05", "2026-09")).toBe("2026-06");
  });
});
