// tests/domain/what-if-ladder.test.ts
// The demo salary: the pot is 5% of pay into the bank (after tax and benefits); figures below worked by hand.
// The salary ladder, and Check a salary.
import { describe, expect, test } from "vitest";
import { checkSalary, loanMonthlyCents, whatIfLadder, type WhatIf, type WhatIfChange, type WhatIfLadder, type WhatIfRow } from "../../src/domain/what-if";
import { salaryForView, spendableAtSalary, DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import type { BudgetLine } from "../../src/domain/plan-types";
import { demoSalary } from "../demo";

const base: BudgetLine[] = [
  { planId: "p", planningCategory: "Rent", period: null, amountCents: 210_000 },
  { planId: "p", planningCategory: "Groceries", period: null, amountCents: 65_000 },
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 15_000 },
];
const a = demoSalary();
const salaryFor = (need: number, charity = 15_000) => salaryForView(need * 12, charity * 12, a).grossAnnualCents;
const empty: WhatIf = { scenarioId: "w", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
const change = (over: Partial<WhatIfChange>): WhatIfChange => ({
  id: "c", position: 1, kind: "add", label: "x", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2027-03", untilPeriod: null, loan: null, ...over,
});

// No start months: the ladder always prices next month; a change's stored months are not read.
describe("the price month", () => {
  test("is next month, whatever months the changes carry", () => {
    expect(whatIfLadder(empty, base, [], "2026-10", a).priceMonth).toBe("2026-10");
    expect(whatIfLadder({ ...empty, changes: [change({ fromPeriod: "2027-03" }), change({ id: "b", fromPeriod: "2027-01" })] }, base, [], "2026-10", a).priceMonth).toBe("2026-10");
  });
});

describe("whatIfLadder", () => {
  test("no changes: the start is Salary to live, and the price month is next month", () => {
    const l = whatIfLadder(empty, base, [], "2026-10", a);
    expect(l.priceMonth).toBe("2026-10");
    expect(l.rungs.map((r) => r.kind)).toEqual(["start"]);
    expect(l.salaryToLiveCents).toBe(salaryFor(210_000 + 65_000));
    expect(l.salaryToLiveAndHitGoalsCents).toBe(l.salaryToLiveCents);
    expect(l.needToLiveMonthlyCents).toBe(210_000 + 65_000);
    expect(l.charityLineMonthlyCents).toBe(15_000);
  });

  test("each change adds its step in list order, priced next month", () => {
    const w = { ...empty, changes: [
      change({ id: "rent", position: 2, kind: "change", planningCategory: "Rent", amountCents: 260_000, fromPeriod: "2027-01" }),
      change({ id: "car", position: 1, amountCents: 70_000, fromPeriod: "2027-03" }),
    ] };
    const l = whatIfLadder(w, base, [], "2026-10", a);
    expect(l.priceMonth).toBe("2026-10");
    expect(l.rungs.map((r) => r.id)).toEqual(["start", "car", "rent"]);
    expect(l.rungs[1]).toMatchObject({ monthlyCents: 70_000, salaryAfterCents: salaryFor(210_000 + 65_000 + 70_000) });
    expect(l.rungs[2]).toMatchObject({ monthlyCents: 50_000, salaryAfterCents: salaryFor(260_000 + 65_000 + 70_000) });
    expect(l.rungs[2].salaryAddedCents).toBe(l.rungs[2].salaryAfterCents - l.rungs[1].salaryAfterCents);
    expect(l.salaryToLiveCents).toBe(salaryFor(260_000 + 65_000 + 70_000));
  });

  test("a cut is a negative step", () => {
    const l = whatIfLadder({ ...empty, changes: [change({ kind: "cut", planningCategory: "Groceries", amountCents: 50_000, fromPeriod: "2026-10" })] }, base, [], "2026-10", a);
    expect(l.rungs[1].monthlyCents).toBe(-15_000);
    expect(l.rungs[1].salaryAddedCents).toBeLessThan(0);
  });

  test("a down payment never enters the salary", () => {
    const loan = { priceCents: 3_000_000, downPaymentCents: 500_000, annualRate: 0.065, years: 5 };
    const l = whatIfLadder({ ...empty, changes: [change({ id: "car", kind: "car", loan })] }, base, [], "2026-10", a);
    expect(l.rungs[1].monthlyCents).toBe(loanMonthlyCents(loan));
    expect(l.salaryToLiveCents).toBe(salaryFor(210_000 + 65_000 + loanMonthlyCents(loan)));
  });

  test("a change on the Charity line moves charity, not the need", () => {
    const l = whatIfLadder({ ...empty, changes: [change({ kind: "change", planningCategory: "Charity", amountCents: 100_000, fromPeriod: "2026-10" })] }, base, [], "2026-10", a);
    expect(l.needToLiveMonthlyCents).toBe(210_000 + 65_000);
    expect(l.charityLineMonthlyCents).toBe(100_000);
    expect(l.salaryToLiveCents).toBe(salaryFor(210_000 + 65_000, 100_000));
  });

  test("a stored end month no longer ends a change: it counts in full", () => {
    const w = { ...empty, changes: [
      change({ id: "early", untilPeriod: "2027-01", fromPeriod: "2026-11" }),
      change({ id: "late", position: 2, planningCategory: "Gym", amountCents: 5_000, fromPeriod: "2027-03" }),
    ] };
    const l = whatIfLadder(w, base, [], "2026-10", a);
    expect(l.rungs[1]).toMatchObject({ id: "early", monthlyCents: 70_000, note: null });
  });

  test("switched-on goal saving rows stack after the costs; a fully saved goal is $0 with a note; a deleted goal is skipped", () => {
    const saving = (refId: string, position: number): WhatIfRow => ({ kind: "goal-saving", refId, position, on: true });
    const w = { ...empty, rows: [saving("trip", 2), saving("house", 1), saving("gone", 3)] };
    const goals = [
      { id: "house", name: "House", recommendedMonthlyCents: 400_000, complete: false },
      { id: "trip", name: "Beach trip", recommendedMonthlyCents: null, complete: true },
      { id: "car", name: "Second vehicle", recommendedMonthlyCents: 250_000, complete: false },
    ];
    const l = whatIfLadder(w, base, goals, "2026-10", a);
    expect(l.rungs.map((r) => [r.kind, r.id])).toEqual([["start", "start"], ["goal", "house"], ["goal", "trip"]]);
    expect(l.salaryToLiveAndHitGoalsCents).toBe(salaryFor(210_000 + 65_000 + 400_000));
    expect(l.salaryToLiveCents).toBe(salaryFor(210_000 + 65_000));
    expect(l.rungs[2]).toMatchObject({ monthlyCents: 0, salaryAddedCents: 0, note: "Fully saved, nothing more needed" });
  });

  test("a goal with no target date is $0 with a note, never NaN", () => {
    const l = whatIfLadder({ ...empty, rows: [{ kind: "goal-saving", refId: "g", position: 1, on: true }] }, base, [{ id: "g", name: "Someday", recommendedMonthlyCents: null, complete: false, plannedCostCents: 0 }], "2026-10", a);
    expect(l.rungs[1]).toMatchObject({ monthlyCents: 0, note: "No target date or planned amount" });
    expect(Number.isFinite(l.salaryToLiveAndHitGoalsCents)).toBe(true);
  });
});

// whatIfRunway is retired. The What if screen's runway line and the Forecast screen both
// run cashForecast (tests/domain/cash-forecast.test.ts,
// tests/ui/WhatIfSection.test.tsx).

describe("checkSalary", () => {
  const ladder = (rungs: { id: string; kind: "change" | "goal"; monthlyCents: number }[], charity = 0): WhatIfLadder => ({
    priceMonth: "2027-03", salaryToLiveCents: 0, salaryToLiveAndHitGoalsCents: 0, charityLineMonthlyCents: charity, needToLiveMonthlyCents: 0,
    rungs: [
      { kind: "start", id: "start", label: "Start (today's costs)", monthlyCents: 500_000, salaryAfterCents: 0, salaryAddedCents: 0, note: null },
      ...rungs.map((r) => ({ ...r, label: `Label ${r.id}`, salaryAfterCents: 0, salaryAddedCents: 0, note: null })),
    ],
  });
  // No premium and no maaser, so the arithmetic below is visible.
  const plain = { ...DEFAULT_SALARY_ASSUMPTIONS, premiumMonthlyCents: 0, maaserRate: 0 };
  const spend = (g: number) => spendableAtSalary(g, 0, plain).spendableMonthlyCents;

  test("walks the list order and skips what does not fit, then keeps going", () => {
    const gross = 12_000_000;
    const room = spend(gross) - 500_000; // what is left after today's costs
    const l = ladder([
      { id: "car", kind: "change", monthlyCents: room - 10_000 }, // fits
      { id: "house", kind: "goal", monthlyCents: 500_000 }, // does not fit on top of the car
      { id: "trip", kind: "goal", monthlyCents: 5_000 }, // still fits
    ]);
    const r = checkSalary(l, gross, plain);
    expect(r.startCovered).toBe(true);
    expect(r.spendableMonthlyCents).toBe(spend(gross));
    expect(r.items.map((i) => [i.id, i.label, i.covered])).toEqual([["car", "Label car", true], ["house", "Label house", false], ["trip", "Label trip", true]]);
    expect(r.leftOverMonthlyCents).toBe(room - (room - 10_000) - 5_000);
  });

  test("an item that exactly fills what is left is covered", () => {
    const gross = 12_000_000;
    const r = checkSalary(ladder([{ id: "car", kind: "change", monthlyCents: spend(gross) - 500_000 }]), gross, plain);
    expect(r.items[0].covered).toBe(true);
    expect(r.leftOverMonthlyCents).toBe(0);
  });

  test("a cut is always covered and makes room for what follows", () => {
    const gross = 12_000_000;
    const room = spend(gross) - 500_000;
    const l = ladder([{ id: "cut", kind: "change", monthlyCents: -100_000 }, { id: "car", kind: "change", monthlyCents: room + 50_000 }]);
    expect(checkSalary(l, gross, plain).items.map((i) => i.covered)).toEqual([true, true]);
  });

  test("a salary below today's costs covers nothing", () => {
    const r = checkSalary(ladder([{ id: "car", kind: "change", monthlyCents: 1 }]), 1_000_000, plain);
    expect(r.startCovered).toBe(false);
    expect(r.items.every((i) => !i.covered)).toBe(true);
    expect(r.leftOverMonthlyCents).toBe(spend(1_000_000) - 500_000);
  });

  // A Charity change was once charged twice (once in what the
  // salary leaves, once as a step), and a raise maaser already covered still cost money.
  test("a Charity change is counted once, through charity, never again as a cost", () => {
    const w: WhatIf = { ...empty, changes: [change({ id: "give", kind: "change", planningCategory: "Charity", amountCents: 200_000, fromPeriod: "2026-10" })] };
    const l = whatIfLadder(w, base, [], "2026-10", a);
    const gross = 15_000_000;
    const r = checkSalary(l, gross, a);
    const need = 210_000 + 65_000;
    const withRaise = spendableAtSalary(gross, 200_000 * 12, a).spendableMonthlyCents;
    expect(r.items).toEqual([expect.objectContaining({ id: "give", covered: true })]);
    expect(r.leftOverMonthlyCents).toBe(withRaise - need);
    expect(r.spendableMonthlyCents).toBe(withRaise);
  });

  test("a Charity raise that maaser already covers costs nothing", () => {
    const gross = 15_000_000;
    // The pot is 5% of what lands in the bank (after tax AND benefits): at $150,000 with the
    // demo's $340.00 benefits, (126,594.72 - 4,080) x 5% / 12 = $510.48. The raise stays
    // $50.00 under it (to $460.48), so the pot still covers it.
    const b = spendableAtSalary(gross, 0, a).breakdown;
    const maaser = Math.round((a.maaserRate * (b.afterTaxAnnualCents - b.premiumAnnualCents)) / 12);
    expect(maaser).toBe(51_048);
    const w: WhatIf = { ...empty, changes: [change({ id: "give", kind: "change", planningCategory: "Charity", amountCents: maaser - 5_000, fromPeriod: "2026-10" })] };
    const before = checkSalary(whatIfLadder(empty, base, [], "2026-10", a), gross, a);
    const after = checkSalary(whatIfLadder(w, base, [], "2026-10", a), gross, a);
    expect(after.leftOverMonthlyCents).toBe(before.leftOverMonthlyCents);
  });

  test("the charity line counts: a bigger line leaves less to spend", () => {
    const gross = 12_000_000;
    expect(checkSalary(ladder([], 50_000), gross, plain).spendableMonthlyCents).toBe(spendableAtSalary(gross, 600_000, plain).spendableMonthlyCents);
  });
});

// Salary needed is gross; take-home needed is net,
// after federal tax, Social Security and Medicare, the premium and maaser.
describe("take-home needed on the ladder", () => {
  const goals = [
    { id: "house", name: "House", recommendedMonthlyCents: 400_000, complete: false, plannedCostCents: 0 },
    { id: "car2", name: "Second vehicle", recommendedMonthlyCents: 50_400, complete: false, plannedCostCents: 30_000 },
  ];
  const w: WhatIf = {
    ...empty,
    changes: [change({ id: "car", amountCents: 70_000, fromPeriod: "2027-03" })],
    // The two kinds of tick: the change, then the ticked
    // goals' ongoing costs, then their savings, all switched on.
    rows: [
      { kind: "change", refId: "car", position: 1, on: true },
      { kind: "goal-cost", refId: "car2", position: 2, on: true },
      { kind: "goal-saving", refId: "car2", position: 3, on: true },
      { kind: "goal-saving", refId: "house", position: 4, on: true },
    ],
  };
  const l = whatIfLadder(w, base, goals, "2026-10", a);
  // Gross is rounded to whole dollars, so take-home lands within a dollar a month of the need.
  const close = (cents: number, needMonthly: number) => expect(Math.abs(cents - needMonthly * 12)).toBeLessThan(1_200);

  test("every step carries the take-home it needs: the month's costs, charity aside, a year", () => {
    close(l.rungs[0].takeHomeAfterCents, 210_000 + 65_000);
    close(l.rungs[1].takeHomeAfterCents, 210_000 + 65_000 + 70_000);
    close(l.rungs[2].takeHomeAfterCents, 210_000 + 65_000 + 70_000 + 30_000);
    close(l.rungs[3].takeHomeAfterCents, 210_000 + 65_000 + 70_000 + 30_000 + 50_400);
    close(l.rungs[4].takeHomeAfterCents, 210_000 + 65_000 + 70_000 + 30_000 + 50_400 + 400_000);
  });

  test("take-home is what the step's salary leaves after tax, the premium and maaser", () => {
    for (const r of l.rungs) {
      expect(r.takeHomeAfterCents).toBeLessThan(r.salaryAfterCents);
    }
    expect(l.takeHomeToLiveCents).toBe(salaryForView(l.needToLiveMonthlyCents * 12, l.charityLineMonthlyCents * 12, a).takeHomeAnnualCents);
    close(l.takeHomeToLiveCents, l.needToLiveMonthlyCents);
    close(l.takeHomeToLiveAndHitGoalsCents, l.needToLiveMonthlyCents + 50_400 + 400_000);
    expect(l.takeHomeToLiveAndHitGoalsCents).toBe(l.rungs[l.rungs.length - 1].takeHomeAfterCents);
  });

  test("no changes and no goals: one take-home, the same for both totals", () => {
    const e = whatIfLadder(empty, base, [], "2026-10", a);
    expect(e.takeHomeToLiveCents).toBeGreaterThan(0);
    expect(e.takeHomeToLiveCents).toBe(e.rungs[0].takeHomeAfterCents);
    expect(e.takeHomeToLiveAndHitGoalsCents).toBe(e.takeHomeToLiveCents);
  });
});
