// tests/domain/income-statement.test.ts
//
// maaser is a tenth of pay into the bank (after tax and benefits); figures below worked by hand.
//
// The salary ladder as an income statement, with a
// Monthly | Yearly switch. One function builds the statement for the ladder's two
// totals and for the top bar's take-home panel, so the two cannot disagree.
//
// Layout of the statement: Gross pay; less Federal income tax, Social Security and Medicare, Health
// premium, Maaser; = Take-home (the only take-home, after maaser); then the budget's
// lines under an "Expenses" heading with the Charity line left out (maaser covers it);
// then the what-if rows switched on; then the lines in all and Left over or short.
// The in-between "Take-home pay" line is retired. Item 5: each tax and premium line
// says "estimated" or "from Settings".
import { describe, expect, test } from "vitest";
import { incomeStatement, statementCents, type IncomeStatement, type StatementLine } from "../../src/domain/income-statement";
import { DEFAULT_SALARY_ASSUMPTIONS, currentSalaryBreakdown, monthlyPayCents, w2Breakdown, type SalaryAssumptions } from "../../src/domain/salary";
import { ladderGoalsFrom, whatIfLadder, type WhatIf } from "../../src/domain/what-if";
import { summariseForMasthead } from "../../src/ui/lib/instrument";
import type { BudgetLine, Goal } from "../../src/domain/plan-types";
import type { Scenario } from "../../src/domain/scenario";

// Settings, Salary: the paycheck premium $660.00 a month,
// maaser a tenth, one child. No state or local income tax line.
const ASSUMED: SalaryAssumptions = { ...DEFAULT_SALARY_ASSUMPTIONS, premiumMonthlyCents: 66_000, premiumFromSettings: true, maaserRate: 0.1, children: 1 };
const CHARITY_LINE = 60_000; // the budget's Charity line, $600.00 a month
// A $8,500.00 month of costs, and the Charity line, which the statement leaves out of Expenses.
const EXPENSES = [
  { label: "Rent", cents: 500_000 },
  { label: "Groceries", cents: 200_000 },
  { label: "Charity", cents: CHARITY_LINE },
  { label: "Dining", cents: 150_000 },
];

const ids = (lines: StatementLine[]) => lines.map((l) => l.id);
const cents = (lines: StatementLine[]) => Object.fromEntries(lines.filter((l) => !l.heading).map((l) => [l.id, l.cents]));
const label = (lines: StatementLine[], id: string) => lines.find((l) => l.id === id)!.label;

/**
 * Every "=" line equals the running sum of the lines above it (a heading has no figure,
 * and the "in all" line is a group's sum, outside the running sum), and the "in all"
 * line equals the lines of its group: the statement adds up to the cent.
 */
function expectAddsUp(lines: StatementLine[]) {
  let running = 0;
  let group = 0;
  for (const l of lines) {
    if (l.heading) continue;
    if (l.subtotal) {
      expect({ id: l.id, cents: l.cents }).toEqual({ id: l.id, cents: group });
      continue;
    }
    if (l.total) {
      expect({ id: l.id, cents: l.cents }).toEqual({ id: l.id, cents: running });
      running = l.cents;
      continue;
    }
    running += l.cents;
    if (l.id.startsWith("expense:") || l.id.startsWith("row:")) group += l.cents;
  }
}

describe("the worked example: $150,000 gross, $660.00 premium, $8,500.00 of expenses", () => {
  // Worked by hand (TAX_2026_MFJ, one child):
  //   premium a year      66,000 x 12 = 792,000 ($7,920.00), taken before tax
  //   wages               15,000,000 - 792,000 = 14,208,000
  //   Social Security and Medicare  0.0765 x 14,208,000 = 1,086,912 ($10,869.12)
  //   taxable             14,208,000 - 3,220,000 = 10,988,000
  //   federal             248,000 + 912,000 + 199,760 = 1,359,760, less the
  //                       $2,200 child credit = 1,139,760 ($11,397.60)
  //   after tax           15,000,000 - 1,086,912 - 1,139,760 = 12,773,328
  //   maaser              10% of what lands in the bank: 10% of (12,773,328 - 792,000 =
  //                       11,981,328) = 1,198,132.8 -> 1,198,133 ($11,981.33),
  //                       more than the Charity line's 60,000 x 12 = 720,000
  //   take-home           12,773,328 - 792,000 - 1,198,133 = 10,783,195 ($107,831.95)
  //   expenses            (500,000 + 200,000 + 150,000) x 12 = 10,200,000; Charity left out
  //   left over           10,783,195 - 10,200,000 = 583,195 ($5,831.95)
  // A month, each running total of the year divided by 12 and rounded once:
  //   gross               1,250,000 ($12,500.00)
  //   federal             13,860,240 / 12 = 1,155,020, so 94,980 ($949.80)
  //   payroll             12,773,328 / 12 = 1,064,444, so 90,576 ($905.76)
  //   premium             66,000 ($660.00): the paycheck is 998,444, monthlyPayCents' own
  //   maaser              round(10% x (12,773,328 - 792,000 = 11,981,328) / 12) = round(99,844.4)
  //                       = 99,844 ($998.44)
  //   take-home           998,444 - 99,844 = 898,600 ($8,986.00)
  //   expenses            -500,000, -200,000, -150,000; in all -850,000
  //   left over           898,600 - 850,000 = 48,600 ($486.00)
  const b = w2Breakdown(15_000_000, CHARITY_LINE * 12, ASSUMED);
  const s = incomeStatement({ breakdown: b, assumptions: ASSUMED, charityLineMonthlyCents: CHARITY_LINE, expenses: EXPENSES });

  test("the order: pay, what comes out, Take-home, then Expenses (no Charity), in all, left over", () => {
    const order = ["gross", "federal", "payroll", "premium", "maaser", "take-home", "expenses", "expense:Rent", "expense:Groceries", "expense:Dining", "in-all", "left-over"];
    expect(ids(s.yearly)).toEqual(order);
    expect(ids(s.monthly)).toEqual(order);
    expect(s.yearly.map((l) => l.label).join(" ")).not.toMatch(/state|local/i);
  });

  test("Take-home is the only take-home, after maaser; the in-between Take-home pay line is gone", () => {
    expect(label(s.monthly, "take-home")).toBe("= Take-home");
    expect(s.monthly.concat(s.yearly).some((l) => /Take-home pay|Left for the budget/.test(l.label))).toBe(false);
    expect(s.monthly.some((l) => l.id === "take-home-pay" || l.id === "left-for-budget")).toBe(false);
  });

  test("the Charity line is left out of Expenses, and a note says the line above Take-home covers it", () => {
    expect(s.monthly.some((l) => l.id === "expense:Charity")).toBe(false);
    expect(s.notes.join(" ")).toMatch(/The Charity line is left out of Expenses: the line above Take-home covers it\./);
    expect(label(s.monthly, "expenses")).toBe("Expenses");
    expect(s.monthly.find((l) => l.id === "expenses")!.heading).toBe(true);
  });

  test("Yearly, to the cent", () => {
    expect(cents(s.yearly)).toEqual({
      gross: 15_000_000,
      federal: -1_139_760,
      payroll: -1_086_912,
      premium: -792_000,
      maaser: -1_198_133,
      "take-home": 10_783_195,
      "expense:Rent": -6_000_000,
      "expense:Groceries": -2_400_000,
      "expense:Dining": -1_800_000,
      "in-all": -10_200_000,
      "left-over": 583_195,
    });
  });

  test("Monthly, to the cent", () => {
    expect(cents(s.monthly)).toEqual({
      gross: 1_250_000,
      federal: -94_980,
      payroll: -90_576,
      premium: -66_000,
      maaser: -99_844,
      "take-home": 898_600,
      "expense:Rent": -500_000,
      "expense:Groceries": -200_000,
      "expense:Dining": -150_000,
      "in-all": -850_000,
      "left-over": 48_600,
    });
  });

  test("both views add up exactly", () => {
    expectAddsUp(s.yearly);
    expectAddsUp(s.monthly);
  });

  // Yearly = 12 x Monthly where the year divides by 12. Payroll 1,086,912 / 12 = 90,576
  // exactly. Maaser: 12 x 99,844 = 1,198,128, 5 cents less than the year's 1,198,133 (the year
  // rounds 1,198,132.8 up, the month rounds 99,844.4 down), so Take-home and Left over
  // are 5 cents over a year's worth of months.
  test("Yearly is 12 x Monthly line by line, except the cents rounding explains", () => {
    const y = cents(s.yearly);
    const m = cents(s.monthly);
    for (const id of ["gross", "federal", "premium", "expense:Rent", "expense:Groceries", "expense:Dining", "in-all"]) expect(12 * m[id]).toBe(y[id]);
    expect(12 * m.payroll - y.payroll).toBe(0);
    expect(12 * m.maaser - y.maaser).toBe(5);
    expect(12 * m["take-home"] - y["take-home"]).toBe(5);
    expect(12 * m["left-over"] - y["left-over"]).toBe(5);
  });

  test("the month follows the app's one rounding path: paycheck less the larger of maaser and the Charity line", () => {
    const pay = monthlyPayCents(b, ASSUMED);
    expect(statementCents(s.monthly, "maaser")).toBe(-Math.max(CHARITY_LINE, pay.maaserCents));
    expect(statementCents(s.monthly, "take-home")).toBe(pay.paycheckCents - Math.max(CHARITY_LINE, pay.maaserCents));
  });

  test("taxes say estimated; a typed premium says from Settings; money out carries a minus", () => {
    expect(label(s.monthly, "gross")).toBe("Gross pay");
    expect(label(s.monthly, "federal")).toBe("Federal income tax (estimated)");
    expect(label(s.monthly, "payroll")).toBe("Social Security and Medicare (estimated)");
    expect(label(s.monthly, "premium")).toBe("Benefits (from Settings)");
    expect(label(s.monthly, "in-all")).toBe("Expenses, in all");
    expect(label(s.monthly, "left-over")).toBe("= Left over");
    for (const id of ["federal", "payroll", "premium", "maaser", "expense:Rent", "in-all"]) expect(statementCents(s.yearly, id)).toBeLessThan(0);
  });

  test("a premium never typed says estimated", () => {
    const est = incomeStatement({ breakdown: b, assumptions: { ...ASSUMED, premiumFromSettings: false }, charityLineMonthlyCents: CHARITY_LINE, expenses: EXPENSES });
    expect(label(est.monthly, "premium")).toBe("Benefits (estimated)");
  });
});

describe("the what-if rows switched on, after Expenses", () => {
  const b = w2Breakdown(15_000_000, CHARITY_LINE * 12, ASSUMED);
  const s = incomeStatement({
    breakdown: b,
    assumptions: ASSUMED,
    charityLineMonthlyCents: CHARITY_LINE,
    expenses: EXPENSES,
    rows: [
      { id: "car", label: "New car", cents: 70_000 },
      { id: "groceries-cut", label: "Groceries", cents: -20_000 },
      { id: "house", label: "Saving for House", cents: 100_000 },
    ],
  });

  test("their own heading, each row a line, a cut adding back; in all, then short", () => {
    expect(ids(s.monthly).slice(6)).toEqual(["expenses", "expense:Rent", "expense:Groceries", "expense:Dining", "what-if", "row:car", "row:groceries-cut", "row:house", "in-all", "left-over"]);
    expect(label(s.monthly, "what-if")).toBe("What-if rows switched on");
    expect(statementCents(s.monthly, "row:car")).toBe(-70_000);
    expect(statementCents(s.monthly, "row:groceries-cut")).toBe(20_000);
    expect(statementCents(s.yearly, "row:house")).toBe(-1_200_000);
    // 850,000 + 70,000 - 20,000 + 100,000 = 1,000,000
    expect(statementCents(s.monthly, "in-all")).toBe(-1_000_000);
    expect(label(s.monthly, "in-all")).toBe("Expenses and what-if rows, in all");
    // 898,600 - 1,000,000 = -101,400: short $1,014.00 a month
    expect(statementCents(s.monthly, "left-over")).toBe(-101_400);
    expect(label(s.monthly, "left-over")).toBe("= Short");
    expectAddsUp(s.monthly);
    expectAddsUp(s.yearly);
  });
});

describe("the Charity line, when it is more than maaser", () => {
  test("the line stands in for maaser and says so, as the math always has (the larger of the two)", () => {
    const b = w2Breakdown(15_000_000, 200_000 * 12, ASSUMED);
    const s = incomeStatement({ breakdown: b, assumptions: ASSUMED, charityLineMonthlyCents: 200_000, expenses: [{ label: "Living", cents: 700_000 }, { label: "Charity", cents: 200_000 }] });
    expect(statementCents(s.monthly, "maaser")).toBe(-200_000);
    expect(statementCents(s.yearly, "maaser")).toBe(-2_400_000);
    expect(label(s.monthly, "maaser")).toMatch(/Charity line/);
    expect(s.monthly.some((l) => l.id === "expense:Charity")).toBe(false);
    expectAddsUp(s.monthly);
    expectAddsUp(s.yearly);
  });
});

describe("an additional salary", () => {
  test("a W-2 salary is its own income line, the tax lines stay combined, and a note says so", () => {
    const a: SalaryAssumptions = { ...ASSUMED, additionalSalary: { kind: "w2", grossAnnualCents: 6_000_000, fromPeriod: "2026-11" } };
    const b = w2Breakdown(12_000_000, CHARITY_LINE * 12, a);
    const s = incomeStatement({ breakdown: b, assumptions: a, charityLineMonthlyCents: CHARITY_LINE, expenses: EXPENSES });
    expect(ids(s.yearly).slice(0, 6)).toEqual(["gross", "other-gross", "federal", "payroll", "premium", "maaser"]);
    expect(statementCents(s.yearly, "other-gross")).toBe(6_000_000);
    expect(statementCents(s.monthly, "other-gross")).toBe(500_000);
    expect(statementCents(s.yearly, "federal")).toBe(-b.federalAnnualCents);
    expect(label(s.yearly, "federal")).toBe("Federal income tax, both salaries, filed jointly (estimated)");
    expect(s.notes.join(" ")).toMatch(/taxed together/);
    expectAddsUp(s.yearly);
    expectAddsUp(s.monthly);
  });

  test("a typed monthly amount is its own line, before maaser, with no tax lines of its own and no maaser on it", () => {
    const a: SalaryAssumptions = { ...ASSUMED, additionalSalary: { kind: "monthly", monthlyCents: 200_000, fromPeriod: "2026-11" } };
    const b = w2Breakdown(12_000_000, CHARITY_LINE * 12, a);
    const s = incomeStatement({ breakdown: b, assumptions: a, charityLineMonthlyCents: CHARITY_LINE, expenses: EXPENSES });
    expect(ids(s.monthly).slice(0, 7)).toEqual(["gross", "federal", "payroll", "premium", "other-net", "maaser", "take-home"]);
    expect(statementCents(s.monthly, "other-net")).toBe(200_000);
    const alone = incomeStatement({ breakdown: w2Breakdown(12_000_000, CHARITY_LINE * 12, ASSUMED), assumptions: ASSUMED, charityLineMonthlyCents: CHARITY_LINE, expenses: EXPENSES });
    expect(statementCents(s.monthly, "maaser")).toBe(statementCents(alone.monthly, "maaser"));
    expect(statementCents(s.monthly, "take-home")).toBe(statementCents(alone.monthly, "take-home") + 200_000);
    expect(s.notes.join(" ")).toMatch(/no tax is worked on it/);
    expectAddsUp(s.monthly);
    expectAddsUp(s.yearly);
  });
});

describe("firm figures from Settings: the current salary only, labeled", () => {
  // Firm federal $12,000.00 and payroll $11,000.00 a year on $150,000:
  //   after tax 15,000,000 - 1,200,000 - 1,100,000 = 12,700,000
  //   maaser 10% x (12,700,000 - 792,000 = 11,908,000) = 1,190,800;
  //   take-home 12,700,000 - 792,000 - 1,190,800 = 10,717,200
  const firm: SalaryAssumptions = { ...ASSUMED, firmTaxes: { federalAnnualCents: 1_200_000, payrollAnnualCents: 1_100_000 } };

  test("the current salary's statement takes them and says from Settings", () => {
    const b = currentSalaryBreakdown(15_000_000, CHARITY_LINE * 12, firm);
    const s = incomeStatement({ breakdown: b, assumptions: firm, charityLineMonthlyCents: CHARITY_LINE, expenses: EXPENSES });
    expect(statementCents(s.yearly, "federal")).toBe(-1_200_000);
    expect(statementCents(s.yearly, "payroll")).toBe(-1_100_000);
    expect(statementCents(s.yearly, "maaser")).toBe(-1_190_800);
    expect(statementCents(s.yearly, "take-home")).toBe(10_717_200);
    expect(label(s.yearly, "federal")).toBe("Federal income tax (from Settings)");
    expect(label(s.yearly, "payroll")).toBe("Social Security and Medicare (from Settings)");
    expectAddsUp(s.yearly);
    expectAddsUp(s.monthly);
  });

  test("a cleared figure is estimated again, and says so", () => {
    const one: SalaryAssumptions = { ...ASSUMED, firmTaxes: { federalAnnualCents: null, payrollAnnualCents: 1_100_000 } };
    const s = incomeStatement({ breakdown: currentSalaryBreakdown(15_000_000, CHARITY_LINE * 12, one), assumptions: one, charityLineMonthlyCents: CHARITY_LINE, expenses: EXPENSES });
    expect(statementCents(s.yearly, "federal")).toBe(-1_139_760);
    expect(label(s.yearly, "federal")).toBe("Federal income tax (estimated)");
    expect(label(s.yearly, "payroll")).toBe("Social Security and Medicare (from Settings)");
  });

  test("any other salary keeps estimated taxes, even with firm figures saved", () => {
    const b = w2Breakdown(15_000_000, CHARITY_LINE * 12, firm);
    expect(b.federalAnnualCents).toBe(1_139_760);
    const s = incomeStatement({ breakdown: b, assumptions: firm, charityLineMonthlyCents: CHARITY_LINE, expenses: EXPENSES });
    expect(label(s.yearly, "federal")).toBe("Federal income tax (estimated)");
  });
});

describe("every line adds up, in both views, across salaries and Charity lines", () => {
  test("a sweep of grosses, with and without an additional salary, with what-if rows", () => {
    const others: SalaryAssumptions["additionalSalary"][] = [null, { kind: "w2", grossAnnualCents: 4_000_000, fromPeriod: "2026-11" }, { kind: "monthly", monthlyCents: 100_000, fromPeriod: "2026-11" }];
    let checked = 0;
    for (const other of others) {
      const a = { ...ASSUMED, additionalSalary: other };
      for (let gross = 0; gross <= 40_000_000; gross += 1_234_500) {
        for (const line of [0, 60_000, 300_001]) {
          const b = w2Breakdown(gross, line * 12, a);
          const s: IncomeStatement = incomeStatement({
            breakdown: b,
            assumptions: a,
            charityLineMonthlyCents: line,
            expenses: [{ label: "Living", cents: 700_000 }, { label: "Charity", cents: line }],
            rows: [{ id: "g", label: "Saving for Goal", cents: 33_333 }],
          });
          expectAddsUp(s.yearly);
          expectAddsUp(s.monthly);
          const pay = monthlyPayCents(b, a);
          expect(statementCents(s.monthly, "take-home")).toBe(pay.paycheckCents - Math.max(line, pay.maaserCents));
          // The year is the breakdown's: its take-home within a cent of rounding.
          expect(Math.abs(statementCents(s.yearly, "take-home") - b.takeHomeAnnualCents)).toBeLessThanOrEqual(1);
          for (const l of s.yearly) if (!l.heading) expect(Math.abs(12 * statementCents(s.monthly, l.id) - l.cents)).toBeLessThanOrEqual(24);
          expect(statementCents(s.yearly, "in-all")).toBe(12 * statementCents(s.monthly, "in-all"));
          checked++;
        }
      }
    }
    expect(checked).toBe(3 * 33 * 3);
  });
});

describe("the ladder carries a statement per total", () => {
  const lines: BudgetLine[] = [
    { planId: "p", planningCategory: "Rent", period: null, amountCents: 200_000 },
    { planId: "p", planningCategory: "Groceries", period: null, amountCents: 90_000 },
    { planId: "p", planningCategory: "Charity", period: null, amountCents: CHARITY_LINE },
  ];
  const w: WhatIf = {
    scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null,
    changes: [{ id: "car", position: 1, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2026-10", untilPeriod: null, loan: null }],
    rows: [{ kind: "change", refId: "car", position: 1, on: true }, { kind: "goal-saving", refId: "house", position: 2, on: true }],
  };
  const goals = [{ id: "house", name: "House", recommendedMonthlyCents: 477_552, complete: false, plannedCostCents: 0 }];

  test("Salary to live: the budget's lines (no Charity), the cost rows, in all its need, a few cents of rounding left over", () => {
    const l = whatIfLadder(w, lines, goals, "2026-10", ASSUMED);
    const s = l.statements!.toLive;
    expect(statementCents(s.yearly, "gross")).toBe(l.salaryToLiveCents);
    expect(ids(s.monthly).filter((id) => id.startsWith("expense:") || id.startsWith("row:"))).toEqual(["expense:Rent", "expense:Groceries", "row:car"]);
    expect(statementCents(s.monthly, "in-all")).toBe(-l.needToLiveMonthlyCents);
    expect(Math.abs(statementCents(s.monthly, "left-over"))).toBeLessThan(100);
    expectAddsUp(s.monthly);
    expectAddsUp(s.yearly);
  });

  test("Salary to live and hit goals: the same, plus each goal saving switched on as its own row", () => {
    const l = whatIfLadder(w, lines, goals, "2026-10", ASSUMED);
    const s = l.statements!.toLiveAndHitGoals;
    expect(statementCents(s.yearly, "gross")).toBe(l.salaryToLiveAndHitGoalsCents);
    expect(statementCents(s.monthly, "row:house")).toBe(-477_552);
    expect(statementCents(s.monthly, "in-all")).toBe(-l.needToLiveAndHitGoalsMonthlyCents!);
    expect(Math.abs(statementCents(s.monthly, "left-over"))).toBeLessThan(100);
  });

  test("a what-if's additional salary reaches its statements", () => {
    const l = whatIfLadder({ ...w, additionalSalary: { kind: "w2", grossAnnualCents: 6_000_000, fromPeriod: "2026-11" } }, lines, goals, "2026-10", ASSUMED);
    expect(statementCents(l.statements!.toLive.yearly, "other-gross")).toBe(6_000_000);
    expect(statementCents(l.statements!.toLiveAndHitGoals.monthly, "other-gross")).toBe(500_000);
  });

  test("Salary needed keeps estimated taxes even with firm figures saved for the current salary", () => {
    const firm = { ...ASSUMED, firmTaxes: { federalAnnualCents: 100, payrollAnnualCents: 100 } };
    const l = whatIfLadder(w, lines, goals, "2026-10", firm);
    const plain = whatIfLadder(w, lines, goals, "2026-10", ASSUMED);
    expect(l.salaryToLiveCents).toBe(plain.salaryToLiveCents);
    expect(label(l.statements!.toLive.yearly, "federal")).toBe("Federal income tax (estimated)");
  });
});

describe("the top bar reads the same statement", () => {
  const lines: BudgetLine[] = [
    { planId: "p", planningCategory: "Rent", period: null, amountCents: 200_000 },
    { planId: "p", planningCategory: "Charity", period: null, amountCents: CHARITY_LINE },
  ];
  const base = { accounts: [], balances: [], budgetLines: lines, categorySettings: [], uncategorizedCount: 0, ruleCount: 0, lastSyncedAt: null, asOfDate: "2026-10-02", salaryAssumptions: ASSUMED };

  test("under a what-if, the top bar's statement is the ladder's Salary to live and hit goals statement", () => {
    const w: WhatIf = {
      scenarioId: "s1", salaryGrossAnnualCents: null, salaryFromPeriod: null,
      changes: [{ id: "car", position: 1, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2026-11", untilPeriod: null, loan: null }],
      rows: [{ kind: "change", refId: "car", position: 1, on: true }, { kind: "goal-saving", refId: "g1", position: 2, on: true }],
    };
    const goal: Goal = { id: "g1", name: "Trip", goalType: "savings", targetAmountCents: 1_200_000, targetDate: "2027-10-01", priority: 1, currentAmountCents: 0, plannedMonthlyCents: 100_000, notes: "", archivedAt: null };
    const scenario: Scenario = { id: "s1", planId: "p", name: "New job offer", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "2026-10-02" };
    const m = summariseForMasthead({ ...base, scenario, whatIf: w, goals: [goal] });
    const ladderGoals = ladderGoalsFrom([goal], { accounts: [], balances: [], links: [], txns: [] }, "2026-10-02");
    const l = whatIfLadder(w, lines, ladderGoals, "2026-11", ASSUMED);
    expect(m.salary!.statement).toEqual(l.statements!.toLiveAndHitGoals);
    expect(m.salary!.grossAnnualCents).toBe(statementCents(m.salary!.statement.yearly, "gross"));
  });

  test("with no what-if, it is the same function on the same figures the bar prices", () => {
    const m = summariseForMasthead(base);
    const b = w2Breakdown(m.salary!.grossAnnualCents, CHARITY_LINE * 12, ASSUMED);
    expect(m.salary!.statement).toEqual(
      incomeStatement({ breakdown: b, assumptions: ASSUMED, charityLineMonthlyCents: CHARITY_LINE, expenses: [{ label: "Charity", cents: CHARITY_LINE }, { label: "Rent", cents: 200_000 }] })
    );
  });
});

// Benefits: one Benefits line, with each benefit listed under it.
describe("the Benefits line and its items", () => {
  const list = [
    { name: "Health insurance", amountCents: 50_000, every: "month" as const, beforeTax: true },
    { name: "Dental", amountCents: 1_000, every: "paycheck" as const, beforeTax: true },
    { name: "Life insurance", amountCents: 2_500, every: "month" as const, beforeTax: false },
  ];
  // Dental a paycheck, twice a month: $20.00 a month. In all $545.00 a month, $25.00 of it after tax.
  const listed: SalaryAssumptions = { ...ASSUMED, premiumMonthlyCents: 54_500, afterTaxBenefitsMonthlyCents: 2_500, benefits: list, paySchedule: "twice-a-month" };
  const lb = w2Breakdown(15_000_000, CHARITY_LINE * 12, listed);
  const ls = incomeStatement({ breakdown: lb, assumptions: listed, charityLineMonthlyCents: CHARITY_LINE, expenses: EXPENSES });
  const line = (lines: StatementLine[]) => lines.find((l) => l.id === "premium")!;
  // The same salary with no list, for comparison.
  const s = incomeStatement({ breakdown: w2Breakdown(15_000_000, CHARITY_LINE * 12, ASSUMED), assumptions: ASSUMED, charityLineMonthlyCents: CHARITY_LINE, expenses: EXPENSES });

  test("each benefit is an item under the line, a month or a year, money out with a minus", () => {
    expect(line(ls.monthly).items).toEqual([
      { label: "Health insurance", cents: -50_000 },
      { label: "Dental", cents: -2_000 },
      { label: "Life insurance (after tax)", cents: -2_500 },
    ]);
    expect(line(ls.yearly).items).toEqual([
      { label: "Health insurance", cents: -600_000 },
      { label: "Dental", cents: -24_000 },
      { label: "Life insurance (after tax)", cents: -30_000 },
    ]);
  });

  test("a year, the items add up to the line exactly", () => {
    expect(line(ls.yearly).items!.reduce((sum, i) => sum + i.cents, 0)).toBe(line(ls.yearly).cents);
  });

  test("the items sit beside the running sum, never in it: every total still adds up", () => {
    expect(ids(ls.monthly)).toEqual(ids(s.monthly));
    expect(statementCents(ls.yearly, "premium")).toBe(-54_500 * 12);
  });

  test("no list: no items", () => {
    expect(line(s.monthly).items).toBeUndefined();
  });
});
