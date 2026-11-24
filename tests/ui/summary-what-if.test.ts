// tests/ui/summary-what-if.test.ts
// Under a what-if the top bar's Monthly budget
// and Salary needed follow it; Drawable stays today's cash (D4). Monthly budget
// includes maaser's raise of the Charity line once the salary is on.
import { describe, expect, it } from "vitest";
import { summariseForMasthead } from "../../src/ui/lib/instrument";
import { addMonths } from "../../src/domain/scenario";
import { takeHomeMonthlyCents, type WhatIf, type WhatIfChange } from "../../src/domain/what-if";
import { salaryForView, DEFAULT_SALARY_ASSUMPTIONS, type SalaryAssumptions } from "../../src/domain/salary";
import type { Scenario } from "../../src/domain/scenario";

const accounts = [
  { id: "chk", name: "Checking", type: "depository", institution: "B", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" as const, balanceCents: 7_500_000 },
];
const budgetLines = [
  { planId: "p", planningCategory: "Rent", period: null, amountCents: 600_000 },
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 60_000 },
];
// A pot rate high enough that a $150,000 salary's share passes the $600.00 Charity line.
const SALARY: SalaryAssumptions = { ...DEFAULT_SALARY_ASSUMPTIONS, premiumMonthlyCents: 60_000, maaserRate: 0.1, children: 1 };
const base = {
  salaryAssumptions: SALARY,
  accounts: accounts as never,
  balances: [{ accountId: "chk", balanceCents: 7_500_000, asOf: "2026-09-02" }],
  budgetLines,
  categorySettings: [],
  uncategorizedCount: 0,
  ruleCount: 0,
  lastSyncedAt: null,
  asOfDate: "2026-09-02",
};
const nextMonth = addMonths("2026-09", 1);
const row: Scenario = { id: "w1", planId: "p", name: "New job $150k", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" };
const car: WhatIfChange = { id: "car", position: 1, kind: "add", label: "Car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: nextMonth, untilPeriod: null, loan: null };
const whatIf = (over: Partial<WhatIf>): WhatIf => ({ scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [], ...over });

describe("the top bar under a what-if", () => {
  const real = summariseForMasthead(base);

  it("an empty what-if reads exactly as Real numbers, but still says a what-if is on", () => {
    const on = summariseForMasthead({ ...base, scenario: row, whatIf: whatIf({}) });
    expect(on.reading.burnCents).toBe(real.reading.burnCents);
    // Under a what-if the bar reads the ladder's second statement. The
    // bar has no goal savings line of its own: with nothing
    // switched on it is line for line the Real numbers statement, and so is every figure.
    expect(on.salary).toEqual(real.salary);
    expect(on.reading.runwayMonths).toBe(real.reading.runwayMonths);
    expect(on.scenarioLabel).toBe("New job $150k");
  });

  it("a new cost moves Monthly budget and Salary needed; Drawable does not move", () => {
    const on = summariseForMasthead({ ...base, scenario: row, whatIf: whatIf({ changes: [car] }) });
    expect(on.reading.burnCents).toBe(real.reading.burnCents + 70_000);
    expect(on.salary!.grossAnnualCents).toBe(salaryForView((600_000 + 70_000) * 12, 60_000 * 12, SALARY).grossAnnualCents);
    expect(on.reading.drawableCents).toBe(real.reading.drawableCents);
    expect(on.reading.runwayMonths!).toBeLessThan(real.reading.runwayMonths!);
  });

  it("a salary adds maaser's raise to Monthly budget, lengthens the runway, and leaves Salary needed alone", () => {
    const w = whatIf({ salaryGrossAnnualCents: 15_000_000, salaryFromPeriod: addMonths(nextMonth, 1) });
    const on = summariseForMasthead({ ...base, scenario: row, whatIf: w });
    const raise = takeHomeMonthlyCents(15_000_000, SALARY).maaserCents - 60_000;
    expect(on.reading.burnCents).toBe(real.reading.burnCents + raise);
    expect(on.salary!.grossAnnualCents).toBe(real.salary!.grossAnnualCents);
    expect(on.reading.runwayMonths === null || on.reading.runwayMonths > real.reading.runwayMonths!).toBe(true);
  });

  it("the what-if is composed here even when the scenario row arrives uncomposed", () => {
    const on = summariseForMasthead({ ...base, scenario: row, whatIf: whatIf({ changes: [car] }) });
    expect(on.baselineSeries).not.toBeNull();
  });

  it("an older scenario with no what-if keeps its label rule: shown only when it changes something", () => {
    expect(summariseForMasthead({ ...base, scenario: row, whatIf: null }).scenarioLabel).toBeNull();
  });
});


// The top bar
// rebuilt the what-if from its raw record, so a ticked goal's planned cost
// never reached Monthly budget or Salary needed. It must, like a new cost.
describe("a ticked goal's ongoing cost in the top bar", () => {
  const real = summariseForMasthead(base);
  const house = { id: "House", name: "House", goalType: "savings", targetAmountCents: 100, targetDate: null, priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null, ongoingMonthlyCents: 50_000, ongoingStartedPeriod: null } as never;
  // Ticked before the saving row existed: its cost row and its saving row, both on (migration 0029).
  const ticked = whatIf({ rows: [{ kind: "goal-cost", refId: "House", position: 1, on: true }, { kind: "goal-saving", refId: "House", position: 2, on: true }] });

  it("moves Monthly budget and Salary needed, and shortens the runway", () => {
    const on = summariseForMasthead({ ...base, scenario: row, whatIf: ticked, goals: [house] });
    expect(on.reading.burnCents).toBe(real.reading.burnCents + 50_000);
    expect(on.salary!.grossAnnualCents).toBe(salaryForView((600_000 + 50_000) * 12, 60_000 * 12, SALARY).grossAnnualCents);
    expect(on.reading.runwayMonths!).toBeLessThan(real.reading.runwayMonths!);
  });

  it("an unticked goal, or one whose cost has started, moves nothing", () => {
    const unticked = summariseForMasthead({ ...base, scenario: row, whatIf: whatIf({}), goals: [house] });
    expect(unticked.reading.burnCents).toBe(real.reading.burnCents);
    const started = summariseForMasthead({ ...base, scenario: row, whatIf: ticked, goals: [{ ...(house as object), ongoingStartedPeriod: "2026-09" } as never] });
    expect(started.reading.burnCents).toBe(real.reading.burnCents);
  });
});

// The bar shows take-home needed (net) beside Salary needed (gross).
describe("take-home needed in the top bar", () => {
  const a = SALARY;
  it("carries the take-home and every step from gross to it", () => {
    const real = summariseForMasthead(base);
    const b = salaryForView(600_000 * 12, 60_000 * 12, a);
    expect(real.salary).toMatchObject({
      grossAnnualCents: b.grossAnnualCents,
      takeHomeAnnualCents: b.takeHomeAnnualCents,
      federalAnnualCents: b.federalAnnualCents,
      ficaAnnualCents: b.ficaAnnualCents,
      premiumAnnualCents: b.premiumAnnualCents,
      charityAnnualCents: b.charityAnnualCents,
    });
    const s = real.salary!;
    expect(s.grossAnnualCents - s.federalAnnualCents - s.ficaAnnualCents - s.premiumAnnualCents - s.charityAnnualCents).toBe(s.takeHomeAnnualCents);
  });

  it("under a what-if it is that what-if's take-home to live", () => {
    const on = summariseForMasthead({ ...base, scenario: row, whatIf: whatIf({ changes: [car] }) });
    expect(on.salary!.takeHomeAnnualCents).toBe(salaryForView((600_000 + 70_000) * 12, 60_000 * 12, a).takeHomeAnnualCents);
  });
});
