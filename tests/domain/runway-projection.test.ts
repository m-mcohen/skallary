import { describe, it, expect } from "vitest";
import { projectFutureNet, INCOME_CATEGORY } from "../../src/domain/runway-projection";
import { computeRunway } from "../../src/domain/runway";
import type { BudgetLine } from "../../src/domain/plan-types";

const dflt = (cat: string, cents: number): BudgetLine => ({ planId: "p", planningCategory: cat, period: null, amountCents: cents });
const override = (cat: string, period: string, cents: number): BudgetLine => ({ planId: "p", planningCategory: cat, period, amountCents: cents });

describe("projectFutureNet", () => {
  // Outstanding 24: the month stepping now comes from period.ts; this pins it across a year line.
  it("steps across December into the next year, a January override landing in January", () => {
    const lines = [dflt("Groceries", 100000), override("Groceries", "2027-01", 300000)];
    const out = projectFutureNet(lines, "2026-11-15", 3);
    expect(out.map((o) => o.period)).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(out.map((o) => o.netCents)).toEqual([-100000, -300000, -100000]);
  });

  it("projects months strictly after asOf, applying defaults to every month", () => {
    const lines = [dflt("Groceries", 100000), dflt(INCOME_CATEGORY, 0)];
    const out = projectFutureNet(lines, "2026-08-15", 3);
    expect(out.map((o) => o.period)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(out.every((o) => o.netCents === -100000)).toBe(true); // 0 income - 1000 expense
  });

  it("applies an income ramp override from its start month", () => {
    const lines = [dflt("Groceries", 100000), dflt(INCOME_CATEGORY, 0), override(INCOME_CATEGORY, "2026-11", 900000)];
    const out = projectFutureNet(lines, "2026-08-31", 4); // 09,10,11,12
    expect(out.find((o) => o.period === "2026-10")!.netCents).toBe(-100000);
    expect(out.find((o) => o.period === "2026-11")!.netCents).toBe(800000); // 9000 income - 1000 expense
  });

  it("feeds computeRunway to a real cash-out (under 9 months at $0 income)", () => {
    const lines = [dflt("Living", 700000), dflt(INCOME_CATEGORY, 0)]; // 7,000/mo burn
    const net = projectFutureNet(lines, "2026-08-31", 24);
    const rw = computeRunway(6000000, net); // $60,000 drawable
    // 60,000 / 7,000 = ~8.57 months of runway: after 8 full months of burn the
    // running balance is 60,000 - 8*7,000 = 4,000 (still positive), so the
    // balance crosses to <=0 during month 9 (60,000 - 9*7,000 = -3,000).
    // computeRunway's runwayMonths is the 1-based month index of that crossing,
    // so the correct value here is 9, not 8.
    expect(rw.runwayMonths).toBe(9);
  });

  it("subtracts a plannedEvent's amount from its month's net (future one-time expense)", () => {
    const lines = [dflt("Groceries", 100000), dflt(INCOME_CATEGORY, 300000)];
    const withoutEvent = projectFutureNet(lines, "2026-08-15", 3);
    const withEvent = projectFutureNet(lines, "2026-08-15", 3, [
      { period: "2026-10", planningCategory: "Home", amountCents: 50000 },
    ]);
    // Untouched months are unaffected.
    expect(withEvent.find((o) => o.period === "2026-09")!.netCents).toBe(
      withoutEvent.find((o) => o.period === "2026-09")!.netCents
    );
    // 2026-10's net is reduced by exactly the event's amount.
    expect(withEvent.find((o) => o.period === "2026-10")!.netCents).toBe(
      withoutEvent.find((o) => o.period === "2026-10")!.netCents - 50000
    );
  });
});
