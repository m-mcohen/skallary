// tests/ui/summary.test.ts
//
// The reading carried by the summary bar and the Dashboard headline. (Renamed
// from instrument.test.ts when the masthead was retired; the subject --
// summariseForMasthead in src/ui/lib/instrument.ts -- is unchanged, and every
// assertion below carried over untouched.)
//
// This is the one number on screen at all times, and a click away from the
// Runway panel, so the property that matters most is that the two AGREE. The
// head therefore runs projectFutureNet + computeRunway, the same path the
// panel runs.
//
// The app's convention, encoded by projectFutureNet: the projection starts the
// month AFTER as-of, because the current month is already partly spent. An
// earlier version of this file asserted a flat projection starting at as-of,
// which is a different question and put one date in the head
// while the panel said another a few inches below it.
import { describe, expect, it } from "vitest";
import { readInstrument, summariseForMasthead } from "../../src/ui/lib/instrument";
import { addMonths } from "../../src/domain/scenario";
import { projectFutureNet } from "../../src/domain/runway-projection";

describe("addMonths", () => {
  it("rolls the year over", () => {
    expect(addMonths("2026-09", 0)).toBe("2026-09");
    expect(addMonths("2026-09", 4)).toBe("2027-01");
    expect(addMonths("2026-09", 12)).toBe("2027-09");
  });
});

describe("readInstrument", () => {
  // A sample reading: drawable $75,000.00 against a budget of
  // record of $7,000.00 a month.
  const flat = (n: number, cents: number) =>
    Array.from({ length: n }, (_, i) => ({ period: addMonths("2026-10", i), netCents: -cents }));
  const live = {
    drawableCents: 7500000,
    burnCents: 700000,
    asOf: "2026-09",
    futureMonthlyNet: flat(24, 700000),
  };

  it("crosses zero in the month the panel's own engine says it does", () => {
    expect(readInstrument(live).crossPeriod).toBe("2027-08");
  });

  it("counts the current month, which the projection excludes but the money funds", () => {
    // computeRunway counts the months the money funds (10 whole ones here). The head shows the same span
    // with a fraction, so the two never read as different answers.
    expect(readInstrument(live).runwayMonths).toBeCloseTo(11.71, 1);
  });

  it("opens the series at today's balance rather than after a month of spending", () => {
    const s = readInstrument(live).series;
    expect(s[0]).toEqual({ period: "2026-09", cents: 7500000 });
    expect(s[1]).toEqual({ period: "2026-10", cents: 7500000 - 700000 });
  });

  it("never draws the balance below zero, because a runway ends rather than inverting", () => {
    expect(readInstrument(live).series.every((p) => p.cents >= 0)).toBe(true);
  });

  it("reports an endless runway when nothing is going out", () => {
    const r = readInstrument({ ...live, burnCents: 0, futureMonthlyNet: flat(24, 0) });
    expect(r.runwayMonths).toBe(null);
    expect(r.crossPeriod).toBe(null);
  });

  it("lengthens the runway when the burn falls", () => {
    const cheaper = readInstrument({ ...live, burnCents: 600000, futureMonthlyNet: flat(24, 600000) });
    expect(cheaper.runwayMonths!).toBeGreaterThan(readInstrument(live).runwayMonths!);
  });
});

describe("summariseForMasthead", () => {
  const accounts = [
    { id: "chk", name: "Everyday Checking (1111)", type: "depository", institution: "B", currency: "USD", isOwned: true, includeInSpend: true, owner: "joint" as const, balanceCents: 600000 },
    { id: "bro", name: "Brokerage (2222)", type: "brokerage", institution: "B", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" as const, balanceCents: 2000000 },
    { id: "ira", name: "Retirement IRA (3333)", type: "retirement", institution: "B", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" as const, balanceCents: 1200000 },
    // A superseded record: still owns history, must not be tallied.
    { id: "legacy", name: "Everyday Checking (...1111)", type: "depository", institution: "B", currency: "USD", isOwned: true, includeInSpend: true, owner: "joint" as const, balanceCents: null, archived: true },
  ];
  const balances = accounts
    .filter((a) => a.balanceCents != null)
    .map((a) => ({ accountId: a.id, balanceCents: a.balanceCents!, asOf: "2026-09-02" }));
  const budgetLines = [
    { planId: "p", planningCategory: "Rent", period: null, amountCents: 200000 },
    { planId: "p", planningCategory: "Shopping", period: null, amountCents: 50000 },
    // A per-month override must not be added on top of the default line.
    { planId: "p", planningCategory: "Rent", period: "2026-10", amountCents: 250000 },
  ];
  const settings = [
    { planningCategory: "Rent", recurring: true, recurringSource: "user" as const, pinned: true },
    { planningCategory: "Shopping", recurring: false, recurringSource: "auto" as const, pinned: false },
  ];

  const call = () =>
    summariseForMasthead({
      accounts: accounts as never,
      balances,
      budgetLines,
      categorySettings: settings,
      uncategorizedCount: 1,
      ruleCount: 100,
      lastSyncedAt: null,
      asOfDate: "2026-09-02",
    });

  it("burns only the default lines, never double counting a month override", () => {
    expect(call().reading.burnCents).toBe(200000 + 50000);
  });

  it("leaves an income line out of Monthly budget, the same sum the What if card shows", () => {
    const withIncome = summariseForMasthead({
      accounts: accounts as never,
      balances,
      budgetLines: [...budgetLines, { planId: "p", planningCategory: "Paychecks", period: null, amountCents: 50_000 }],
      categorySettings: settings,
      uncategorizedCount: 1,
      ruleCount: 100,
      lastSyncedAt: null,
      asOfDate: "2026-09-02",
    });
    expect(withIncome.reading.burnCents).toBe(200000 + 50000);
  });

  it("splits the burn into recurring and variable", () => {
    expect(call().recurringCents).toBe(200000);
    expect(call().variableCents).toBe(50000);
  });

  it("counts retirement as held back rather than drawable", () => {
    expect(call().heldBackCents).toBe(1200000);
    expect(call().reading.drawableCents).toBe(600000 + 2000000);
  });

  it("does not tally archived accounts, which are records rather than accounts", () => {
    expect(call().accountCount).toBe(3);
  });

  it("drives the projection through the app's own engine", () => {
    // Same inputs through projectFutureNet must give the same first month, so
    // the head cannot drift from the panel when the plan changes shape.
    const mine = call().reading.series[1].period;
    expect(mine).toBe(projectFutureNet(budgetLines, "2026-09-02", 24)[0].period);
  });
});

describe("summariseForMasthead with a saved scenario", () => {
  const accounts = [
    { id: "chk", name: "Checking", type: "depository", institution: "B", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" as const, balanceCents: 7500000 },
  ];
  const balances = [{ accountId: "chk", balanceCents: 7500000, asOf: "2026-09-02" }];
  const budgetLines = [{ planId: "p", planningCategory: "Rent", period: null, amountCents: 700000 }];
  const base = {
    accounts: accounts as never, balances, budgetLines, categorySettings: [],
    uncategorizedCount: 0, ruleCount: 0, lastSyncedAt: null, asOfDate: "2026-09-02",
  };
  const goal = {
    id: "s1", planId: "p", name: "Goal from March", isDefault: false, createdAt: "",
    income: { kind: "custom" as const, netMonthlyCents: 1_040_000, startPeriod: "2027-03" },
    expenseDeltas: [],
  };

  it("keeps the recorded plan as a baseline and lengthens the runway with income", () => {
    const plain = summariseForMasthead(base);
    const withGoal = summariseForMasthead({ ...base, scenario: goal });
    expect(plain.baselineSeries).toBeNull();
    expect(withGoal.baselineSeries).toEqual(plain.reading.series);
    expect(withGoal.scenarioLabel).toBe("Goal from March");
    const a = withGoal.reading.runwayMonths, b = plain.reading.runwayMonths;
    expect(a === null || a > b!).toBe(true);
  });

  it("treats the no-op scenario as no scenario at all", () => {
    const plan = { ...goal, name: "Plan", income: { kind: "plan" as const } };
    expect(summariseForMasthead({ ...base, scenario: plan }).scenarioLabel).toBeNull();
  });

  it("a scenario with only line overrides is an overlay: the reading moves and the label is set", () => {
    const scenario = {
      id: "v", planId: "p", name: "Planned life", isDefault: false, income: { kind: "plan" as const },
      expenseDeltas: [], createdAt: "",
      lineOverrides: [{ planningCategory: "Rent", amountCents: 450_000, cut: false, note: "", baseAmountCents: 700_000, updatedAt: "" }],
    };
    const plain = summariseForMasthead(base);
    const withOverride = summariseForMasthead({ ...base, scenario });
    expect(withOverride.scenarioLabel).toBe("Planned life");
    expect(withOverride.reading.runwayMonths).not.toBe(plain.reading.runwayMonths);
  });

  it("a note-only override is not an overlay: no label, no baseline series", () => {
    const scenario = {
      id: "v", planId: "p", name: "Planned life", isDefault: false, income: { kind: "plan" as const },
      expenseDeltas: [], createdAt: "",
      lineOverrides: [{ planningCategory: "Rent", amountCents: null, cut: false, note: "keep", baseAmountCents: 700_000, updatedAt: "" }],
    };
    const withOverride = summariseForMasthead({ ...base, scenario });
    expect(withOverride.scenarioLabel).toBeNull();
    expect(withOverride.baselineSeries).toBeNull();
  });

  it("carries the salary for the composed view", () => {
    const s = summariseForMasthead({ ...base, salaryAssumptions: { premiumMonthlyCents: 0, maaserRate: 0.1, children: 1 } });
    expect(s.salary?.grossAnnualCents).toBeGreaterThan(0);
    const cut = summariseForMasthead({ ...base, budgetLines: [], salaryAssumptions: { premiumMonthlyCents: 0, maaserRate: 0.1, children: 1 } });
    expect(cut.salary).toBeNull();
  });
});

