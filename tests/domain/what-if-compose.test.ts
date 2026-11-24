// tests/domain/what-if-compose.test.ts
// Maaser is a tenth of pay into the bank (after tax and benefits); figures below worked by hand.
// A what-if becomes an ordinary scenario the
// overlay engine already understands. Two traps are pinned here: the engine keeps
// only the first adjustment per line and month, so composeWhatIf must add them up
// itself; and maaser meets a Charity change month by month.
import { describe, expect, test } from "vitest";
import {
  activeIn,
  applyWhatIfs,
  changeMonthlyCents,
  composeWhatIf,
  loanMonthlyCents,
  takeHomeMonthlyCents,
  whatIfPeriods,
  type WhatIf,
  type WhatIfChange,
} from "../../src/domain/what-if";
import { w2Breakdown } from "../../src/domain/salary";
import { demoSalary } from "../demo";
import { applyScenarioToLines, scenarioOverlays, type Scenario } from "../../src/domain/scenario";
import { resolveMonthlyPlan } from "../../src/domain/budget";
import type { BudgetLine } from "../../src/domain/plan-types";

const lines: BudgetLine[] = [
  { planId: "p", planningCategory: "Rent", period: null, amountCents: 210_000 },
  { planId: "p", planningCategory: "Rent", period: "2027-06", amountCents: 250_000 }, // a per-month override
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 15_000 },
];
const change = (over: Partial<WhatIfChange>): WhatIfChange => ({
  id: "c", position: 1, kind: "add", label: "x", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2027-03", untilPeriod: null, loan: null, ...over,
});
const scn = (id = "w1"): Scenario => ({ id, planId: "p", name: "Test", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" });
const noIncome = (changes: WhatIfChange[] = []): WhatIf => ({ scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes, rows: [] });
const carLoan = { priceCents: 3_504_100, downPaymentCents: 500_000, annualRate: 0.065, years: 5 };
const a = demoSalary();

describe("composeWhatIf", () => {
  test("a change counts from its month, through its until month", () => {
    const c = change({ untilPeriod: "2027-05" });
    expect([activeIn(c, "2027-02"), activeIn(c, "2027-03"), activeIn(c, "2027-05"), activeIn(c, "2027-06")]).toEqual([false, true, true, false]);
  });

  test("change a cost SETS the line, even over a per-month override", () => {
    const c = change({ kind: "change", planningCategory: "Rent", amountCents: 280_000, fromPeriod: "2027-01" });
    expect(changeMonthlyCents(c, lines, "2027-02")).toBe(280_000 - 210_000);
    expect(changeMonthlyCents(c, lines, "2027-06")).toBe(280_000 - 250_000);
  });

  test("a cut to zero removes the line's amount", () => {
    expect(changeMonthlyCents(change({ kind: "cut", planningCategory: "Rent", amountCents: 0, fromPeriod: "2027-01" }), lines, "2027-02")).toBe(-210_000);
  });

  test("a car's monthly amount comes from its loan, not the typed amount", () => {
    expect(changeMonthlyCents(change({ kind: "car", amountCents: 1, loan: carLoan }), lines, "2027-03")).toBe(loanMonthlyCents(carLoan));
  });

  test("take-home follows the Settings assumptions, from the stored gross", () => {
    const b = w2Breakdown(15_000_000, 0, a);
    const t = takeHomeMonthlyCents(15_000_000, a);
    expect(t.paycheckCents).toBe(Math.round((b.afterTaxAnnualCents - b.premiumAnnualCents) / 12));
    // The pot is 5% of what lands in the bank. $150,000, the demo's $340.00 benefits ($4,080.00 a year):
    // wages 145,920; payroll 7.65% = 11,162.88; federal on 113,720: 2,480 + 9,120 + 22% x 12,920 = 2,842.40,
    // 14,442.40 less 2,200 = 12,242.40; after tax 150,000 - 11,162.88 - 12,242.40 = 126,594.72;
    // into the bank 126,594.72 - 4,080 = 122,514.72; the pot 6,125.736 / 12 = 510.478 -> $510.48
    expect(t.maaserCents).toBe(Math.round((0.05 * (b.afterTaxAnnualCents - b.premiumAnnualCents)) / 12));
    expect(t.maaserCents).toBe(51_048);
    expect(takeHomeMonthlyCents(15_000_000, { ...a, premiumMonthlyCents: 0 }).paycheckCents).toBeGreaterThan(t.paycheckCents);
  });

  // No start months: the car's stored Mar 2027 is not read. Its costs count from the
  // cost start the caller passes (the salary's month, Nov 2026, as applyWhatIfs and Forecast do).
  test("the composed scenario carries income, the per-month deltas, the down payment once, and maaser each month", () => {
    const w: WhatIf = { scenarioId: "w1", salaryGrossAnnualCents: 15_000_000, salaryFromPeriod: "2026-11", rows: [],
      changes: [change({ kind: "car", label: "New car", loan: carLoan })] };
    const periods = ["2026-10", "2026-11", "2027-02", "2027-03", "2027-04"];
    const out = composeWhatIf(scn(), w, lines, periods, a, [], "2026-11");
    const t = takeHomeMonthlyCents(15_000_000, a);
    expect(out.income).toEqual({ kind: "custom", netMonthlyCents: t.paycheckCents, startPeriod: "2026-11" });
    expect(out.expenseDeltas.filter((d) => d.planningCategory === "Car payment").map((d) => [d.period, d.deltaCents])).toEqual([
      ["2026-11", loanMonthlyCents(carLoan)],
      ["2027-02", loanMonthlyCents(carLoan)],
      ["2027-03", loanMonthlyCents(carLoan)],
      ["2027-04", loanMonthlyCents(carLoan)],
    ]);
    expect(out.expenseDeltas.filter((d) => d.planningCategory === "Down payment: New car")).toEqual([
      { planningCategory: "Down payment: New car", period: "2026-11", deltaCents: 500_000 },
    ]);
    const charity = out.expenseDeltas.filter((d) => d.planningCategory === "Charity");
    expect(charity.map((d) => d.period)).toEqual(["2026-11", "2027-02", "2027-03", "2027-04"]); // from the salary's month
    expect(charity.every((d) => d.deltaCents === t.maaserCents - 15_000)).toBe(true);
  });

  test("two adds on one line in one month add up, through the real overlay engine", () => {
    const w = noIncome([change({ id: "a", amountCents: 70_000 }), change({ id: "b", position: 2, amountCents: 30_000 })]);
    const out = composeWhatIf(scn(), w, lines, ["2027-03"], a);
    expect(resolveMonthlyPlan(applyScenarioToLines(lines, out, ["2027-03"]), "Car payment", "2027-03")).toBe(100_000);
  });

  test("a Charity change and maaser meet: the line is the larger of the two", () => {
    const t = takeHomeMonthlyCents(15_000_000, a);
    const charityTo = (cents: number): WhatIf => ({ scenarioId: "w1", salaryGrossAnnualCents: 15_000_000, salaryFromPeriod: "2026-11", rows: [],
      changes: [change({ kind: "change", planningCategory: "Charity", amountCents: cents })] });
    const lineIn = (w: WhatIf) => resolveMonthlyPlan(applyScenarioToLines(lines, composeWhatIf(scn(), w, lines, ["2027-01"], a), ["2027-01"]), "Charity", "2027-01");
    expect(lineIn(charityTo(20_000))).toBe(t.maaserCents); // cut below maaser: maaser holds
    expect(lineIn(charityTo(300_000))).toBe(300_000); // raised above maaser: the raise holds
  });

  // The list's order is the order, and every switched-on change counts in every month.
  test("the later change in the list wins on the same line, every month", () => {
    const changes = [
      change({ kind: "change", planningCategory: "Rent", amountCents: 280_000, fromPeriod: "2027-01" }),
      change({ id: "d", position: 2, kind: "change", planningCategory: "Rent", amountCents: 300_000, fromPeriod: "2027-02" }),
    ];
    const rent = (w: WhatIf) => {
      const composed = applyScenarioToLines(lines, composeWhatIf(scn(), w, lines, ["2027-01", "2027-02"], a), ["2027-01", "2027-02"]);
      return [resolveMonthlyPlan(composed, "Rent", "2027-01"), resolveMonthlyPlan(composed, "Rent", "2027-02")];
    };
    expect(rent(noIncome(changes))).toEqual([300_000, 300_000]);
    // Moved: $2,800 now sits below $3,000 in the list, so it wins.
    const moved: WhatIf = { ...noIncome(changes), rows: [{ kind: "change", refId: "d", position: 1, on: true }, { kind: "change", refId: "c", position: 2, on: true }] };
    expect(rent(moved)).toEqual([280_000, 280_000]);
    // Switched off, a change sets nothing.
    const off: WhatIf = { ...noIncome(changes), rows: [{ kind: "change", refId: "c", position: 1, on: true }, { kind: "change", refId: "d", position: 2, on: false }] };
    expect(rent(off)).toEqual([280_000, 280_000]);
  });

  test("no salary and no changes composes to the plan itself", () => {
    const out = composeWhatIf(scn("w0"), { ...noIncome(), scenarioId: "w0" }, lines, ["2027-01"], a);
    expect(out.income).toEqual({ kind: "plan" });
    expect(out.expenseDeltas).toEqual([]);
    expect(scenarioOverlays(out)).toBe(false);
  });
});

describe("applyWhatIfs", () => {
  test("a what-if's row is replaced by its composition; a row with no what-if is untouched", () => {
    const older: Scenario = { ...scn("old"), income: { kind: "custom", netMonthlyCents: 1, startPeriod: "2026-11" } };
    const out = applyWhatIfs([scn("w1"), older], [noIncome([change({})])], lines, a, "2026-09");
    expect(scenarioOverlays(out[0])).toBe(true);
    expect(out[0].expenseDeltas.some((d) => d.planningCategory === "Car payment" && d.period === "2027-03")).toBe(true);
    expect(out[1]).toBe(older);
  });

  test("the months run from the start of this year to ten years out", () => {
    const p = whatIfPeriods("2026-09");
    expect(p[0]).toBe("2026-01");
    expect(p[p.length - 1]).toBe("2036-09");
  });
});
