// tests/domain/what-if.test.ts
// The What if screen's arithmetic: loans, composing a
// what-if into a scenario, the salary ladder and Check a salary.
import { describe, expect, test } from "vitest";
import {
  changeAmountCents,
  changeProblem,
  checkSalary,
  lineAfterChanges,
  loanMonthlyCents,
  loanPayoffMonth,
  loanProblem,
  whatIfLadder,
  whatIfProblem,
  type WhatIf,
  type WhatIfChange,
} from "../../src/domain/what-if";
import { monthlyLoanPaymentCents } from "../../src/domain/loan";
import { DEFAULT_SALARY_ASSUMPTIONS, spendableAtSalary } from "../../src/domain/salary";
import type { BudgetLine } from "../../src/domain/plan-types";
import { demoBudgetLines, demoSalary } from "../demo";

describe("loan payments", () => {
  test("a car is the amortized payment on price less down payment", () => {
    const car = { priceCents: 3_000_000, downPaymentCents: 500_000, annualRate: 0.065, years: 5 };
    expect(loanMonthlyCents(car)).toBe(monthlyLoanPaymentCents(2_500_000, 0.065, 5));
    // By hand: $25,000 at 6.5% over 60 months is about $489.15 a month.
    expect(Math.abs(loanMonthlyCents(car) - 48_915)).toBeLessThanOrEqual(2);
  });
  test("a mortgage adds a twelfth of the yearly property tax and insurance", () => {
    const house = { priceCents: 80_000_000, downPaymentCents: 16_000_000, annualRate: 0.065, years: 30, propertyTaxYearCents: 1_200_000, insuranceYearCents: 480_000 };
    expect(loanMonthlyCents(house)).toBe(monthlyLoanPaymentCents(64_000_000, 0.065, 30) + 100_000 + 40_000);
  });
  test("a 0% loan divides evenly", () => {
    expect(loanMonthlyCents({ priceCents: 1_200_000, downPaymentCents: 0, annualRate: 0, years: 1 })).toBe(100_000);
  });
  test("paid in full up front: no payment, but tax and insurance still count", () => {
    expect(loanMonthlyCents({ priceCents: 1_200_000, downPaymentCents: 1_200_000, annualRate: 0.05, years: 5, propertyTaxYearCents: 120_000 })).toBe(10_000);
  });
  test("impossible loans are refused in plain words", () => {
    expect(loanProblem({ priceCents: 100, downPaymentCents: 0, annualRate: 0.05, years: 0 })).toBe("A loan needs at least one year.");
    expect(loanProblem({ priceCents: 100, downPaymentCents: 200, annualRate: 0.05, years: 5 })).toBe("The down payment is more than the price.");
    expect(loanProblem({ priceCents: 100, downPaymentCents: 0, annualRate: -0.01, years: 5 })).toBe("The rate cannot be below zero.");
    expect(loanProblem({ priceCents: 100, downPaymentCents: 0, annualRate: Number.NaN, years: 5 })).toBe("The rate cannot be below zero.");
    expect(loanProblem({ priceCents: 100, downPaymentCents: 0, annualRate: 0.05, years: 5 })).toBeNull();
  });

  // Server validation. A `null` field reads as zero under
  // `>=`, which used to hide a missing price entirely instead of refusing it.
  test("a missing loan field is refused in plain words, never silently treated as zero", () => {
    expect(loanProblem({ priceCents: null as never, downPaymentCents: 0, annualRate: 0.05, years: 5 })).toBe("A loan needs a price.");
    expect(loanProblem({ priceCents: undefined as never, downPaymentCents: 0, annualRate: 0.05, years: 5 })).toBe("A loan needs a price.");
    expect(loanProblem({ priceCents: 100, downPaymentCents: null as never, annualRate: 0.05, years: 5 })).toBe("A loan needs a down payment (0 if none).");
    expect(loanProblem({ priceCents: 100, downPaymentCents: 0, annualRate: null as never, years: 5 })).toBe("A loan needs a rate.");
    expect(loanProblem({ priceCents: 100, downPaymentCents: 0, annualRate: 0.05, years: null as never })).toBe("A loan needs its years.");
    expect(loanProblem({ priceCents: "35000" as never, downPaymentCents: 0, annualRate: 0.05, years: 5 })).toBe("A loan needs a price.");
  });
});

describe("changeProblem: the kind must be one of the five", () => {
  const base: WhatIfChange = {
    id: "c", position: 1, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2027-03", untilPeriod: null, loan: null,
  };
  test("a change kind outside the five is refused in plain words", () => {
    expect(changeProblem({ ...base, kind: "bogus" as never })).toBe("That kind of change is not recognized.");
  });
  test("every real kind is accepted (kind alone is not the problem)", () => {
    for (const kind of ["add", "change", "cut"] as const) {
      expect(changeProblem({ ...base, kind, planningCategory: "Rent" })).toBeNull();
    }
  });
});

describe("whatIfProblem: goal picks and repeated change ids", () => {
  const change = (id: string, position: number): WhatIfChange => ({
    id, position, kind: "add", label: "x", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2027-03", untilPeriod: null, loan: null,
  });
  const w = (over: Partial<WhatIf>): WhatIf => ({ scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [], ...over });

  test("two changes sharing an id are refused in plain words, never SQLite's own text", () => {
    expect(whatIfProblem(w({ changes: [change("dup", 1), change("dup", 2)] }))).toBe("Two changes share the same id.");
  });
  test("distinct ids are fine", () => {
    expect(whatIfProblem(w({ changes: [change("a", 1), change("b", 2)] }))).toBeNull();
  });
  test("a row needs the change or goal it points to, a whole-number position and a switch", () => {
    // Goal picks are rows of the one list.
    expect(whatIfProblem(w({ rows: [{ kind: "goal-saving", refId: "", position: 1, on: true }] }))).toBe("A row needs the change or goal it points to.");
    expect(whatIfProblem(w({ rows: [{ kind: "goal-saving", refId: "house", position: 1.5, on: true }] }))).toBe("A row's order must be a whole number.");
    expect(whatIfProblem(w({ rows: [{ kind: "goal-saving", refId: "house", position: NaN, on: true }] }))).toBe("A row's order must be a whole number.");
    expect(whatIfProblem(w({ rows: [{ kind: "goal-wish" as never, refId: "house", position: 1, on: true }] }))).toBe("That kind of row is not recognized.");
    expect(whatIfProblem(w({ rows: [{ kind: "goal-saving", refId: "house", position: 1, on: "yes" as never }] }))).toBe("A row must be switched on or off.");
    expect(whatIfProblem(w({ rows: [{ kind: "goal-saving", refId: "house", position: 1, on: true }, { kind: "goal-saving", refId: "house", position: 2, on: false }] }))).toBe("The same row is listed twice.");
    expect(whatIfProblem(w({ rows: [{ kind: "goal-saving", refId: "house", position: 1, on: true }, { kind: "goal-cost", refId: "house", position: 2, on: false }] }))).toBeNull();
  });
});

describe("a mortgage's tax and insurance outlast the loan; a car still ends with it", () => {
  const loan = { priceCents: 80_000_000, downPaymentCents: 16_000_000, annualRate: 0.065, years: 2, propertyTaxYearCents: 1_200_000, insuranceYearCents: 480_000 };
  const house: WhatIfChange = { id: "house", position: 1, kind: "mortgage", label: "House", planningCategory: "Mortgage", amountCents: 1, fromPeriod: "2027-01", untilPeriod: null, loan };
  const full = loanMonthlyCents(loan);
  const taxAndInsuranceOnly = Math.round((1_200_000 + 480_000) / 12);

  test("loanPayoffMonth is the loan's last payment month, inclusive", () => {
    expect(loanPayoffMonth("2027-01", 2)).toBe("2028-12");
  });

  test("the full payment applies through payoff; only tax and insurance after", () => {
    expect(changeAmountCents(house, "2028-11")).toBe(full);
    expect(changeAmountCents(house, "2028-12")).toBe(full); // payoff month itself: still the full payment
    expect(changeAmountCents(house, "2029-01")).toBe(taxAndInsuranceOnly); // the month after: tax and insurance only
    expect(changeAmountCents(house, "2031-06")).toBe(taxAndInsuranceOnly); // years later: still going
  });

  test("a car has no tax or insurance to keep, so its own untilPeriod (set by the UI) is what ends it", () => {
    const carLoan = { priceCents: 3_000_000, downPaymentCents: 500_000, annualRate: 0.065, years: 2 };
    const car: WhatIfChange = { id: "car", position: 1, kind: "car", label: "New car", planningCategory: "Car payment", amountCents: 1, fromPeriod: "2027-01", untilPeriod: null, loan: carLoan };
    // changeAmountCents itself never zeroes a car out -- activeIn (driven by
    // untilPeriod) is what stops it, unchanged.
    expect(changeAmountCents(car, "2031-06")).toBe(loanMonthlyCents(carLoan));
  });
});

describe("a line's total does not depend on the order of an add and a Change", () => {
  const lines: BudgetLine[] = [{ planId: "p", planningCategory: "Rent", period: null, amountCents: 210_000 }];
  const setLine = (id: string, position: number, amountCents: number): WhatIfChange => ({
    id, position, kind: "change", label: "x", planningCategory: "Rent", amountCents, fromPeriod: "2027-01", untilPeriod: null, loan: null,
  });
  const addLine = (id: string, position: number, amountCents: number): WhatIfChange => ({
    id, position, kind: "add", label: "y", planningCategory: "Rent", amountCents, fromPeriod: "2027-01", untilPeriod: null, loan: null,
  });

  test("a Change wins the line's base regardless of whether the add was entered before or after it", () => {
    const changeFirst = [setLine("s", 1, 500_000), addLine("a", 2, 10_000)];
    const addFirst = [addLine("a", 1, 10_000), setLine("s", 2, 500_000)];
    expect(lineAfterChanges(changeFirst, lines, "Rent", "2027-02")).toBe(510_000);
    expect(lineAfterChanges(addFirst, lines, "Rent", "2027-02")).toBe(510_000);
  });

  test("among several Changes on one line, the one later in the list still wins the base", () => {
    const c1 = setLine("c1", 1, 300_000);
    const c2 = setLine("c2", 2, 500_000);
    expect(lineAfterChanges([c1, c2], lines, "Rent", "2027-02")).toBe(500_000);
    expect(lineAfterChanges([c2, c1], lines, "Rent", "2027-02")).toBe(500_000); // array order does not matter, only position
  });

  test("perturbation: reverting to the old order-dependent walk would make the two orderings disagree", () => {
    // Sanity check that this is a real property, not a tautology: the naive
    // "walk in position order, an add adds, a Change sets" rule the old code
    // used DOES give different totals for these two orderings (500_000 vs
    // 510_000), which is exactly the bug the fix removes.
    const walkInOrder = (changes: WhatIfChange[]) => {
      let cents = 210_000;
      for (const c of [...changes].sort((x, y) => x.position - y.position)) {
        cents = c.kind === "change" || c.kind === "cut" ? c.amountCents : cents + c.amountCents;
      }
      return cents;
    };
    expect(walkInOrder([setLine("s", 1, 500_000), addLine("a", 2, 10_000)])).toBe(510_000);
    expect(walkInOrder([addLine("a", 1, 10_000), setLine("s", 2, 500_000)])).toBe(500_000);
  });
});

describe("Check a salary counts every cut first", () => {
  const base: BudgetLine[] = [
    { planId: "p", planningCategory: "Rent", period: null, amountCents: 210_000 },
    { planId: "p", planningCategory: "Groceries", period: null, amountCents: 65_000 },
    { planId: "p", planningCategory: "Charity", period: null, amountCents: 15_000 },
  ];
  // No premium and no maaser, so the arithmetic is visible. Charity is held
  // at its normal-month line (15_000), since the cut below never touches it.
  const plain = { ...DEFAULT_SALARY_ASSUMPTIONS, premiumMonthlyCents: 0, maaserRate: 0 };
  const spend = (g: number) => spendableAtSalary(g, 15_000 * 12, plain).spendableMonthlyCents;
  const empty: WhatIf = { scenarioId: "w", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
  const gross = 3_600_000; // $36,000

  test("a cut can bring today's costs back into what the salary covers, even though on their own they do not fit", () => {
    const room = spend(gross);
    expect(room).toBeLessThan(275_000); // today's costs alone (210_000 + 65_000) would not be covered
    expect(room).toBeGreaterThanOrEqual(250_000); // but today's costs after the cut (210_000 + 40_000) would be
    const w: WhatIf = { ...empty, changes: [
      { id: "cut", position: 1, kind: "cut", label: "Cheaper groceries", planningCategory: "Groceries", amountCents: 40_000, fromPeriod: "2026-10", untilPeriod: null, loan: null },
    ] };
    const ladder = whatIfLadder(w, base, [], "2026-10", plain);
    const r = checkSalary(ladder, gross, plain);
    expect(r.startCovered).toBe(true); // 210_000 + 40_000 (post-cut Groceries) = 250_000, which fits
    expect(r.items).toEqual([{ id: "cut", kind: "change", label: "Cheaper groceries", monthlyCents: -25_000, covered: true }]);
    expect(r.leftOverMonthlyCents).toBe(room - 250_000);
  });

  test("perturbation: without the cut at all, the same gross does not cover today's costs", () => {
    // Proves the room really is too small on its own, so the test above is
    // exercising the fix (counting the cut first) and not something that
    // would have passed anyway.
    const ladder = whatIfLadder(empty, base, [], "2026-10", plain);
    const r = checkSalary(ladder, gross, plain);
    expect(r.startCovered).toBe(false);
  });
});

describe("Check a salary counts the yearly bills", () => {
  // Salary needed covers the yearly bills (salaryForView); Check a salary's monthly need counts a
  // twelfth of them too, so its left-over does not rise when bills leave the every-month amounts.
  test("the salary check counts a twelfth of the yearly bills in the monthly need", () => {
    const a = demoSalary();
    const lines = demoBudgetLines();
    const gross = 12_000_000;
    const withBills = { ...a, yearlyBillsAnnualCents: 120_000 };
    const empty: WhatIf = { scenarioId: "w", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
    const ladder = whatIfLadder(empty, lines, [], "2026-10", a);
    expect(checkSalary(ladder, gross, a).leftOverMonthlyCents - checkSalary(ladder, gross, withBills).leftOverMonthlyCents).toBe(10_000);
    // The path the What if screen takes, pricing each step afresh against the what-if.
    const ctx = { whatIf: empty, baseLines: lines };
    expect(checkSalary(ladder, gross, a, ctx).leftOverMonthlyCents - checkSalary(ladder, gross, withBills, ctx).leftOverMonthlyCents).toBe(10_000);
  });
});
