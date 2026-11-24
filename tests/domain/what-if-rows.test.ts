// tests/domain/what-if-rows.test.ts
//
// One list per what-if, in list order, every row switchable. The
// what-if's own changes, each goal's saving row, and each goal's ongoing-cost row
// (only goals that have one). Switched-off rows count nowhere. Goal saving rows
// count toward Salary needed and Take-home needed only, never Monthly budget or
// Forecast. Cost rows count everywhere. No start months: the ladder prices next
// month. Check a salary walks the one list top to bottom, skipping what does not
// fit. A verdict sits at the top when a salary applies.
//
// Money is worked by hand beside each expectation. Where a gross salary has to be
// priced, the salary module does it (its own tests pin the tax tables); the row
// arithmetic on top of it is shown here.
import { describe, expect, test } from "vitest";
import {
  applyWhatIfs,
  checkSalary,
  plannedGoalCosts,
  salaryVerdict,
  verdictText,
  whatIfLadder,
  whatIfList,
  type LadderGoal,
  type WhatIf,
  type WhatIfChange,
  type WhatIfRow,
} from "../../src/domain/what-if";
import { cashForecast } from "../../src/domain/cash-forecast";
import { salaryForView, spendableAtSalary, DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import { summariseForMasthead } from "../../src/ui/lib/instrument";
import type { BudgetLine, Goal } from "../../src/domain/plan-types";
import type { Scenario } from "../../src/domain/scenario";

const base: BudgetLine[] = [
  { planId: "p", planningCategory: "Rent", period: null, amountCents: 210_000 }, // $2,100
  { planId: "p", planningCategory: "Groceries", period: null, amountCents: 65_000 }, // $650.00
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 15_000 }, // $150.00
];
// Today's need, charity aside: 2,100 + 650 = $2,750.00.
const NEED0 = 275_000;
const a = DEFAULT_SALARY_ASSUMPTIONS;
// No premium and no maaser, so what a salary leaves is plain to follow.
const plain = { ...DEFAULT_SALARY_ASSUMPTIONS, premiumMonthlyCents: 0, maaserRate: 0 };
const salaryFor = (need: number, charity = 15_000, s = a) => salaryForView(need * 12, charity * 12, s).grossAnnualCents;

const change = (over: Partial<WhatIfChange>): WhatIfChange => ({
  id: "car", position: 1, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2026-10", untilPeriod: null, loan: null, ...over,
});
const car = change({});
const gym = change({ id: "gym", position: 2, label: "Gym", planningCategory: "Gym", amountCents: 5_000 });
const row = (kind: WhatIfRow["kind"], refId: string, position: number, on = true): WhatIfRow => ({ kind, refId, position, on });
const w = (changes: WhatIfChange[], rows: WhatIfRow[], over: Partial<WhatIf> = {}): WhatIf => ({ scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes, rows, ...over });

// A goal as the list and the ladder see it: saving a month, and its planned ongoing cost.
const house: LadderGoal = { id: "house", name: "House", recommendedMonthlyCents: 100_000, complete: false, plannedCostCents: 400_000 }; // saves $1,000, then costs $4,000.00
const trip: LadderGoal = { id: "trip", name: "Beach trip, 8 days", recommendedMonthlyCents: 40_000, complete: false, plannedCostCents: 0 }; // saves $400, no ongoing cost

describe("the one list", () => {
  test("stored rows keep their order; a change with no row comes on at the end; a goal with no row comes off at the bottom", () => {
    const list = whatIfList(w([car, gym], [row("goal-saving", "house", 1), row("change", "car", 2)]), [house, trip]);
    expect(list.map((r) => [r.kind, r.refId, r.on])).toEqual([
      ["goal-saving", "house", true],
      ["change", "car", true],
      ["change", "gym", true], // a change saved without a row is on
      ["goal-cost", "house", false], // house's cost row was never stored: it arrives off
      ["goal-saving", "trip", false], // a new goal arrives switched off
    ]);
    // Trip has no ongoing cost, so it has no cost row at all.
    expect(list.some((r) => r.kind === "goal-cost" && r.refId === "trip")).toBe(false);
  });

  test("a new what-if lists every goal switched off", () => {
    const list = whatIfList(w([], []), [house, trip]);
    expect(list.every((r) => !r.on)).toBe(true);
    expect(list.map((r) => `${r.kind}:${r.refId}`)).toEqual(["goal-saving:house", "goal-cost:house", "goal-saving:trip"]);
  });

  test("rows for a deleted change or a goal no longer listed are dropped", () => {
    const list = whatIfList(w([car], [row("change", "gone", 1), row("goal-saving", "archived", 2), row("change", "car", 3)]), []);
    expect(list.map((r) => r.refId)).toEqual(["car"]);
  });

  test("labels: a change by its name, a goal's saving and its ongoing cost by the goal's name", () => {
    const list = whatIfList(w([car], [row("change", "car", 1), row("goal-saving", "house", 2), row("goal-cost", "house", 3)]), [house]);
    expect(list.map((r) => r.label)).toEqual(["New car", "Saving for House", "House, ongoing cost"]);
    expect(list.map((r) => r.monthlyCents)).toEqual([70_000, 100_000, 400_000]);
  });
});

describe("switched-off rows count nowhere", () => {
  // Car on, gym off.
  const wi = w([car, gym], [row("change", "car", 1), row("change", "gym", 2, false)]);

  test("the ladder leaves a switched-off change out", () => {
    const l = whatIfLadder(wi, base, [], "2026-10", a);
    expect(l.rungs.map((r) => r.id)).toEqual(["start", "car"]);
    // 2,750.00 + 700 = $3,450.00 a month, charity aside.
    expect(l.needToLiveMonthlyCents).toBe(345_000);
    expect(l.salaryToLiveCents).toBe(salaryFor(345_000));
  });

  test("Check a salary never lists a switched-off row", () => {
    const l = whatIfLadder(wi, base, [], "2026-10", plain);
    const check = checkSalary(l, 15_000_000, plain, { whatIf: wi, baseLines: base });
    expect(check.items.map((i) => i.id)).toEqual(["car"]);
  });

  test("Forecast leaves a switched-off change out", () => {
    // Nov 2026, no salary: 2,100 + 650 + 150 + 700 (car) = $3,600.00. The $50 gym is off.
    const m = cashForecast({ budgetLines: base, asOfDate: "2026-10-15", assumptions: plain, whatIf: wi });
    expect(m[0].costCents).toBe(360_000);
  });

  test("the overlay and the top bar's Monthly budget leave it out", () => {
    const scenario = { id: "w1", planId: "p", name: "New job", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" } as Scenario;
    const [s] = applyWhatIfs([scenario], [wi], base, plain, "2026-09");
    expect(s.expenseDeltas.some((d) => d.planningCategory === "Gym")).toBe(false);
    const bar = summariseForMasthead({ accounts: [], balances: [], budgetLines: base, categorySettings: [], uncategorizedCount: 0, ruleCount: 0, lastSyncedAt: null, asOfDate: "2026-09-02", scenario: s, whatIf: wi, salaryAssumptions: plain });
    // Normal month 2,100 + 650 + 150 = $2,900.00, plus the $700 car = $3,600.00.
    expect(bar.reading.burnCents).toBe(360_000);
  });

  test("a switched-off goal cost row adds nothing; switched on it is a cost everywhere", () => {
    const goals: Goal[] = [{ id: "house", name: "House", goalType: "savings", targetAmountCents: 100_000, targetDate: null, priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null, ongoingMonthlyCents: 400_000 }];
    expect(plannedGoalCosts(w([], [row("goal-cost", "house", 1, false)]), goals)).toEqual([]);
    expect(plannedGoalCosts(w([], [row("goal-cost", "house", 1)]), goals)).toEqual([{ goalId: "house", label: "House", monthlyCents: 400_000 }]);
    // Forecast, Nov 2026: 2,900.00 + 4,000.00 = $6,900.00.
    const m = cashForecast({ budgetLines: base, asOfDate: "2026-10-15", assumptions: plain, whatIf: w([], [row("goal-cost", "house", 1)]), goals });
    expect(m[0].costCents).toBe(690_000);
  });
});

describe("goal saving rows count toward Salary needed only", () => {
  const goals: Goal[] = [
    // Planned $1,000 a month, typed: that is what What if saves.
    { id: "house", name: "House", goalType: "savings", targetAmountCents: 10_000_000, targetDate: "2030-09-01", priority: 0, currentAmountCents: 0, plannedMonthlyCents: 100_000, notes: "", archivedAt: null },
  ];
  const wi = w([], [row("goal-saving", "house", 1)]);
  const scenario = { id: "w1", planId: "p", name: "New job", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" } as Scenario;
  const barInput = { accounts: [], balances: [], budgetLines: base, categorySettings: [], uncategorizedCount: 0, ruleCount: 0, lastSyncedAt: null, asOfDate: "2026-09-02", salaryAssumptions: a };

  test("the ladder's second total takes it; Salary to live does not", () => {
    const l = whatIfLadder(wi, base, [{ id: "house", name: "House", recommendedMonthlyCents: 100_000, complete: false, plannedCostCents: 0 }], "2026-10", a);
    expect(l.salaryToLiveCents).toBe(salaryFor(NEED0));
    // 2,750.00 + 1,000 = $3,750.00 a month to live and save.
    expect(l.salaryToLiveAndHitGoalsCents).toBe(salaryFor(375_000));
  });

  test("the top bar's Salary needed takes it; its Monthly budget does not", () => {
    const real = summariseForMasthead(barInput);
    const on = summariseForMasthead({ ...barInput, scenario, whatIf: wi, goals });
    expect(on.reading.burnCents).toBe(real.reading.burnCents); // $2,900.00 either way
    expect(on.salary!.grossAnnualCents).toBe(salaryFor(375_000));
    const off = summariseForMasthead({ ...barInput, scenario, whatIf: w([], [row("goal-saving", "house", 1, false)]), goals });
    expect(off.salary!.grossAnnualCents).toBe(real.salary!.grossAnnualCents);
  });

  test("Forecast never takes it", () => {
    const m = cashForecast({ budgetLines: base, asOfDate: "2026-10-15", assumptions: plain, whatIf: wi, goals });
    expect(m[0].costCents).toBe(290_000); // the budget alone, $2,900.00
  });
});

describe("no start months", () => {
  test("the ladder prices next month, and a change counts in full whatever months are stored on it", () => {
    const late = change({ fromPeriod: "2027-03" });
    const ended = change({ id: "ended", label: "Old gym", planningCategory: "Gym", amountCents: 5_000, fromPeriod: "2025-01", untilPeriod: "2025-06" });
    const l = whatIfLadder(w([late, ended], []), base, [], "2026-10", a);
    expect(l.priceMonth).toBe("2026-10");
    expect(l.rungs.map((r) => [r.id, r.monthlyCents, r.note])).toEqual([
      ["start", NEED0, null],
      ["car", 70_000, null],
      ["ended", 5_000, null],
    ]);
  });
});

describe("the ladder and Check a salary follow the one list", () => {
  test("cost rows climb to Salary to live in list order, changes and goal costs mixed; saving rows follow", () => {
    const wi = w([car], [row("goal-saving", "trip", 1), row("goal-cost", "house", 2), row("change", "car", 3)]);
    const l = whatIfLadder(wi, base, [house, trip], "2026-10", a);
    expect(l.rungs.map((r) => [r.kind, r.id])).toEqual([["start", "start"], ["goal-cost", "cost:house"], ["change", "car"], ["goal", "trip"]]);
    // To live: 2,750.00 + 4,000.00 + 700 = $7,450.00. And hit goals: + 400 = $7,850.00.
    expect(l.salaryToLiveCents).toBe(salaryFor(745_000));
    expect(l.salaryToLiveAndHitGoalsCents).toBe(salaryFor(785_000));
  });

  test("Check a salary walks the list top to bottom and skips what does not fit", () => {
    // A salary that leaves exactly enough for today's costs plus $1,000 (house saving) and not $700 more.
    const houseSaving: LadderGoal = { ...house, plannedCostCents: 0 };
    // $100 a year above the salary that prices it, so a cent of rounding between the
    // two salary calculations cannot tip the first row out.
    const gross = salaryFor(NEED0 + 100_000, 15_000, plain) + 10_000;
    const spend = spendableAtSalary(gross, 15_000 * 12, plain).spendableMonthlyCents;
    expect(spend - NEED0 - 100_000).toBeGreaterThanOrEqual(0);
    expect(spend - NEED0 - 100_000).toBeLessThan(70_000);

    // House saving first: it fits, the car does not.
    const first = w([car], [row("goal-saving", "house", 1), row("change", "car", 2)]);
    const c1 = checkSalary(whatIfLadder(first, base, [houseSaving], "2026-10", plain), gross, plain, { whatIf: first, baseLines: base });
    expect(c1.items.map((i) => [i.id, i.covered])).toEqual([["house", true], ["car", false]]);
    expect(c1.leftOverMonthlyCents).toBe(spend - NEED0 - 100_000);

    // Car first: the $700 car fits, the $1,000 saving no longer does (only spend - 2,750.00 - 700 is left).
    const second = w([car], [row("change", "car", 1), row("goal-saving", "house", 2)]);
    const c2 = checkSalary(whatIfLadder(second, base, [houseSaving], "2026-10", plain), gross, plain, { whatIf: second, baseLines: base });
    expect(c2.items.map((i) => [i.id, i.covered])).toEqual([["car", true], ["house", false]]);
    expect(c2.leftOverMonthlyCents).toBe(spend - NEED0 - 70_000);
  });
});

describe("the verdict", () => {
  const houseSaving: LadderGoal = { ...house, plannedCostCents: 0 };
  const wi = w([car], [row("change", "car", 1), row("goal-saving", "house", 2)]);

  test("a salary that covers everything switched on says so, with what is left a month", () => {
    const l = whatIfLadder(wi, base, [houseSaving], "2026-10", plain);
    const v = salaryVerdict(l, 15_000_000, plain, { whatIf: wi, baseLines: base });
    const spend = spendableAtSalary(15_000_000, 15_000 * 12, plain).spendableMonthlyCents;
    // Left over: spend - 2,750.00 - 700 - 1,000.
    expect(v).toMatchObject({ covered: true, leftOverMonthlyCents: spend - NEED0 - 70_000 - 100_000, notCovered: [] });
    expect(verdictText(v)).toBe(`$150,000 covers everything switched on, with $${Math.round((spend - 445_000) / 100).toLocaleString("en-US")} a month left over.`);
  });

  test("a salary that falls short says by how much a month, and what it does not cover", () => {
    // The salary that just covers today's costs: nothing on the list fits.
    const gross = salaryFor(NEED0, 15_000, plain);
    const l = whatIfLadder(wi, base, [houseSaving], "2026-10", plain);
    const v = salaryVerdict(l, gross, plain, { whatIf: wi, baseLines: base });
    const spend = spendableAtSalary(gross, 15_000 * 12, plain).spendableMonthlyCents;
    // Short: 2,750.00 + 700 + 1,000 = $4,450.00 needed, less what the salary leaves.
    expect(v).toMatchObject({ covered: false, shortMonthlyCents: 445_000 - spend, notCovered: ["New car", "Saving for House"] });
    const dollars = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
    expect(verdictText(v)).toBe(`${dollars(gross)} is ${dollars(445_000 - spend)} a month short; it does not cover: New car, Saving for House.`);
  });

  test("names that carry a comma are kept apart with semicolons", () => {
    const tripW = w([], [row("goal-saving", "trip", 1), row("goal-saving", "house", 2)]);
    const l = whatIfLadder(tripW, base, [trip, houseSaving], "2026-10", plain);
    const v = salaryVerdict(l, salaryFor(NEED0, 15_000, plain), plain, { whatIf: tripW, baseLines: base });
    expect(verdictText(v)).toMatch(/it does not cover: Saving for Beach trip, 8 days; Saving for House\.$/);
  });

  test("when today's costs are not covered, it says so first", () => {
    const l = whatIfLadder(wi, base, [houseSaving], "2026-10", plain);
    const v = salaryVerdict(l, 1_000_000, plain, { whatIf: wi, baseLines: base });
    expect(v.covered).toBe(false);
    expect(v.notCovered[0]).toBe("Today's costs");
  });
});
