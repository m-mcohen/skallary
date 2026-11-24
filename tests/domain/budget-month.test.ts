import { describe, expect, test } from "vitest";
import {
  buildMonthView, budgetLeftOver, comparisonLabel, isSetByYou, leftOverEffect, lineFigures, replacedBy, simulateChange,
  type BudgetInputs,
} from "../../src/domain/budget-month";
import { demoSalary } from "../demo";
import { resolveMonthlyPlan } from "../../src/domain/budget";
import type { BudgetChange, BudgetLine, Plan } from "../../src/domain/plan-types";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { CharityPot } from "../../src/domain/charity-pot";

const P = "plan-2026";
const PLAN: Plan = { id: P, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", createdAt: "" };
const ACCOUNTS: Account[] = [{ id: "chk", name: "Everyday Checking", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }];
let n = 0;
const txn = (date: string, cat: string, amountCents: number): NormalizedTxn => ({
  sourceTransactionId: `t${++n}`, accountId: "chk", date, amountCents, sourceCategory: cat, merchant: cat, isTransfer: false, sourceUpdatedAt: null,
});
const months12 = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const TXNS: NormalizedTxn[] = [
  // Groceries: $500 on the 5th of each of the last 12 months plus $100 on the 25th; October $300 + $200 (the 3rd and the 18th).
  ...months12.map((m) => txn(`${m}-05`, "Groceries", -50000)),
  ...months12.map((m) => txn(`${m}-25`, "Groceries", -10000)),
  txn("2026-10-03", "Groceries", -30000), txn("2026-10-18", "Groceries", -20000),
  // Rent: fixed, $2,000 on the 1st.
  ...[...months12, "2026-10"].map((m) => txn(`${m}-01`, "Rent", -200000)),
  // Clothing: once, in March.
  txn("2026-03-10", "Clothing", -12000),
  // Hobby: long ago only.
  txn("2024-01-10", "Hobby", -5000),
  // Paychecks: $4,000 on the 15th.
  ...[...months12, "2026-10"].map((m) => txn(`${m}-15`, "Paychecks", 400000)),
];
const line = (cat: string, amountCents: number, source: "you" | "suggested" = "suggested"): BudgetLine => ({ planId: P, planningCategory: cat, period: null, amountCents, source });
const MAPPING = { Groceries: "Groceries", Rent: "Rent", Clothing: "Clothing", Hobby: "Hobby", Paychecks: "Paychecks", Gifts: "Gifts" };
const POT_ON: CharityPot = { on: true, name: "Giving", kind: "percent", rateBps: 1000, fixedCents: null, fixedFrom: null,
  counts: { me: true, partner: true, joint: true }, floorCents: 0 };
const INPUT: BudgetInputs = {
  prepared: TXNS, accounts: ACCOUNTS, mapping: MAPPING,
  lines: [line("Groceries", 45000), line("Rent", 200000, "you"), line("Gifts", 10000)],
  changes: [], bigMonths: [], notes: [{ planId: P, planningCategory: "Groceries", month: "2026-10", note: "Party", updatedAt: "" }],
  settings: [{ planningCategory: "Rent", recurring: true, recurringSource: "user", pinned: false }],
  salary: { ...demoSalary(), currentSalary: { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" } },
};
const view = (over: Partial<Parameters<typeof buildMonthView>[0]> = {}) =>
  buildMonthView({ ...INPUT, month: "2026-10", today: "2026-10-20", compare: "avg-12", sort: "group", ...over });
const row = (v: ReturnType<typeof view>, name: string) => v.sections.flatMap((s) => s.rows).find((r) => r.line === name)!;

describe("rows and groups", () => {
  test("Fixed, Variable, Income, then Left over; alphabetical inside a group", () => {
    const v = view();
    expect(v.sections.map((s) => s.id)).toEqual(["fixed", "variable", "income"]);
    expect(v.sections[1].rows.map((r) => r.line)).toEqual(["Clothing", "Gifts", "Groceries", "Hobby"]);
    expect(v.leftOver.label).toBe("Left over");
  });
  test("a line with no budget, nothing spent and no usual spending is hidden", () => {
    const v = view();
    expect(row(v, "Hobby").hidden).toBe(true);
    expect(row(v, "Clothing").hidden).toBe(false); // it has a usual amount
    expect(v.hiddenCount).toBe(1);
  });
  test("biggest change first puts every spending line in one list", () => {
    const v = view({ sort: "change" });
    expect(v.sections.map((s) => s.id)).toEqual(["spending", "income"]);
    expect(v.sections[0].title).toBe("All spending, biggest change first");
    const changes = v.sections[0].rows.filter((r) => r.changeCents !== null).map((r) => Math.abs(r.changeCents!));
    expect(changes).toEqual([...changes].sort((a, b) => b - a));
  });
});

describe("same days mid-month", () => {
  test("on October 20 each month counts days 1 to 20 only, and October is never in the average", () => {
    const v = view();
    const g = row(v, "Groceries");
    expect(g.spentCents).toBe(50000);
    expect(g.comparisonCents).toBe(50000); // the 25th of each month is past day 20
    expect(v.throughDay).toBe(20);
  });
  test("a finished month compares whole months", () => {
    const v = view({ month: "2026-09" });
    expect(row(v, "Groceries").spentCents).toBe(60000);
    expect(row(v, "Groceries").comparisonCents).toBe(60000);
    expect(v.inProgress).toBe(false);
  });
  test("the average starts at the line's first month with spending and counts empty months as zero", () => {
    // Clothing first spent in March: March to September = 7 months.
    expect(row(view(), "Clothing").comparisonCents).toBe(Math.round(12000 / 7));
  });
  test("last month, same month last year and a specific month", () => {
    expect(row(view({ compare: "last-month" }), "Rent").comparisonCents).toBe(200000);
    expect(row(view({ compare: "last-year" }), "Rent").comparisonCents).toBe(200000);
    expect(row(view({ compare: "month:2023-05" }), "Rent").comparisonCents).toBeNull(); // before any data (first is 2024-01)
    expect(comparisonLabel("last-month", "2026-10")).toBe("September 2026");
    expect(comparisonLabel("avg-3", "2026-10")).toBe("3-month average");
  });
});

describe("budget, colors and tags", () => {
  test("Groceries over budget by a real amount is red, and heading over", () => {
    const g = row(view(), "Groceries");
    expect(g.budgetCents).toBe(45000);
    expect(g.leftCents).toBe(-5000);
    expect(g.barTone).toBe("red");
    expect(g.headingOver).toBe(true);
    expect(g.note).toBe("Party");
  });
  test("fixed lines never get Heading over; a set-by-you line is marked", () => {
    const r = row(view(), "Rent");
    expect(r.group).toBe("fixed");
    expect(r.headingOver).toBe(false);
    expect(r.setByYou).toBe(true);
  });
  test("spending and income bars each have their own scale, so a paycheck gap does not shrink every spending bar", () => {
    const v = view({ compare: "last-month", today: "2026-10-10" }); // the paycheck lands on the 15th
    const rows = v.sections.flatMap((s) => s.rows).filter((r) => !r.hidden);
    const big = (side: "spending" | "income") => Math.max(1, ...rows.filter((r) => r.side === side).map((r) => Math.abs(r.changeCents ?? 0)));
    expect(v.changeScale).toEqual({ spending: big("spending"), income: big("income") });
    expect(v.changeScale.spending).not.toBe(v.changeScale.income);
  });
  test("on the row: Clothing with nothing spent stays grey", () => {
    expect(row(view(), "Clothing").changeTone).toBe("grey");
  });
});

describe("income and Left over", () => {
  test("October: Paychecks has no budget, so neither do Income and Left over", () => {
    const v = view();
    const pay = row(v, "Paychecks");
    expect(pay.budgetCents).toBeNull();
    expect(v.noSalaryNote).toBe("No salary in Settings for October 2026.");
    expect(v.sections[2].subtotal.budgetCents).toBeNull();
    expect(v.leftOver.budgetCents).toBeNull();
    expect(v.leftOver.spentCents).toBe(400000 - 50000 - 200000);
  });
  test("October stays without an income budget even when another income line has one you set", () => {
    const v = view({ lines: [...INPUT.lines, line("Business Income", 50000, "you")] });
    expect(row(v, "Business Income").budgetCents).toBe(50000);
    expect(v.sections[2].subtotal.budgetCents).toBeNull();
    expect(v.leftOver.budgetCents).toBeNull();
  });
  test("November: Left over budget = income budget minus spending budget", () => {
    const v = view({ month: "2026-11", today: "2026-11-02" });
    const income = v.sections.find((s) => s.id === "income")!.subtotal.budgetCents!;
    const spending = v.sections.filter((s) => s.id !== "income").reduce((s, x) => s + (x.subtotal.budgetCents ?? 0), 0);
    expect(v.leftOver.budgetCents).toBe(income - spending);
    expect(v.noSalaryNote).toBeNull();
  });
});

describe("the panel's figures", () => {
  test("12 months to the open month, last month, highest month and the averages", () => {
    const f = lineFigures(INPUT, "Groceries", "spending", "2026-10", "2026-10-20");
    expect(f.months).toHaveLength(12);
    expect(f.months.at(-1)?.month).toBe("2026-10");
    expect(f.monthCents).toBe(50000);
    expect(f.headingForCents).toBe(Math.round((50000 / 20) * 31));
    expect(f.lastMonthCents).toBe(60000);
    expect(f.avg3).toBe(60000);
    expect(f.avg12).toBe(60000);
    expect(f.highest).toEqual({ month: "2025-11", cents: 60000 });
  });
});

describe("changing a line before it is saved", () => {
  const change = (fromMonth: string, amountCents: number, id = 1): BudgetChange =>
    ({ id, planId: P, planningCategory: "Groceries", fromMonth, amountCents, reason: "changed", goalId: null, createdAt: "" });
  test("set by you: an every-month amount or a changed change; a goal change alone is not", () => {
    expect(isSetByYou(INPUT.lines, [], "Rent")).toBe(true);
    expect(isSetByYou(INPUT.lines, [], "Groceries")).toBe(false);
    expect(isSetByYou(INPUT.lines, [change("2026-10", 1)], "Groceries")).toBe(true);
    expect(isSetByYou(INPUT.lines, [{ ...change("2026-10", 1), reason: "goal", goalId: "g" }], "Groceries")).toBe(false);
  });
  test("from a month on replaces that month and later; every month replaces all", () => {
    const changes = [change("2026-03", 47000, 1), change("2026-10", 48000, 2), change("2026-11", 49000, 3)];
    expect(replacedBy(changes, "Groceries", "2026-10").map((c) => c.fromMonth)).toEqual(["2026-11"]);
    expect(replacedBy(changes, "Groceries", null).map((c) => c.fromMonth)).toEqual(["2026-03", "2026-10", "2026-11"]);
    const sim = simulateChange(INPUT.lines, changes, "Groceries", "2026-10", 52000, "2027-12");
    expect(resolveMonthlyPlan(sim.lines, "Groceries", "2026-09")).toBe(47000);
    expect(resolveMonthlyPlan(sim.lines, "Groceries", "2026-12")).toBe(52000);
    const every = simulateChange(INPUT.lines, changes, "Groceries", null, 40000, "2027-12");
    expect(resolveMonthlyPlan(every.lines, "Groceries", "2026-03")).toBe(40000);
    expect(every.changes).toHaveLength(0);
  });
  test("the effect on Left over in the month and in the year", () => {
    const before = budgetLeftOver(INPUT, "2026-11");
    const e = leftOverEffect(INPUT, PLAN, "2026-10-20", "Groceries", "2026-11", 55000);
    expect(e.month).toBe("2026-11");
    expect(e.monthBefore).toBe(before.leftOverCents);
    expect(e.monthAfter).toBe(before.leftOverCents! - 10000);
    expect(e.yearAfter).toBe(e.yearBefore - 2 * 10000); // November and December
  });
  test("October has no income budget, so the month line falls back to the spending budget", () => {
    const e = leftOverEffect(INPUT, PLAN, "2026-10-20", "Groceries", "2026-10", 55000);
    expect(e.monthBefore).toBeNull();
    expect(e.spendAfter - e.spendBefore).toBe(10000);
  });
});

test("Charity shows on the month and counts in Left over once the salary brings maaser, even with no Charity row", () => {
  const v = view({ month: "2026-11", today: "2026-11-02" });
  const charity = v.sections.flatMap((s) => s.rows).find((r) => r.line === "Charity");
  expect(charity?.budgetFrom).toBe("maaser");
  const left = budgetLeftOver(INPUT, "2026-11");
  expect(left.spendingCents).toBeGreaterThan(45000 + 200000 + 10000);
});

describe("with the charity pot on, the Charity line is never red for maaser reasons", () => {
  const POT: Account = { id: "pot", name: "Giving", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me", maaserPot: true };
  const potRow = (date: string, amountCents: number, over: Partial<NormalizedTxn> = {}): NormalizedTxn => ({ ...txn(date, "Transfer", amountCents), accountId: "pot", ...over });
  const withPot = (extra: NormalizedTxn[], lines = [...INPUT.lines, line("Charity", 90000)]) => ({ ...INPUT, accounts: [...ACCOUNTS, POT], prepared: [...TXNS, ...extra], lines, salary: { ...INPUT.salary, pot: POT_ON } });
  test("spent is what reached a charity; a big gift month over its budget stays grey", () => {
    const v = view(withPot([
      potRow("2026-10-02", 150000), txn("2026-10-08", "Charity", -60000),
      potRow("2026-10-15", -5000, { isTransfer: true, transferPartnerAccountId: "chk" }),
      potRow("2026-10-18", -50000, { sourceCategory: null, description: "ZELLE PAYMENT TO A CHARITY" }),
      potRow("2026-10-20", -250000, { sourceCategory: null, description: "ATM WITHDRAWAL" }),
    ]));
    const charity = row(v, "Charity");
    expect(charity.spentCents).toBe(360000);
    expect(charity.leftCents).toBe(90000 - 360000);
    expect(charity.barTone).toBe("grey");
    expect(charity.leftTone).toBe("grey");
    expect(charity.headingOver).toBe(false);
    expect(charity.changeTone).toBe("grey"); // the Change cell too: it must not read red against the average
    expect(v.leftOver.spentCents).toBe(400000 - 200000 - 50000 - 360000);
  });
  test("the Change cell against the average stays grey too, even when the month is far above usual", () => {
    const history = months12.map((m) => txn(`${m}-10`, "Charity", -10000));
    const v = view(withPot([...history, txn("2026-10-08", "Charity", -300000)]));
    const charity = row(v, "Charity");
    expect(charity.changeCents).toBeGreaterThan(200000);
    expect(charity.changeTone).toBe("grey");
    expect(row(v, "Groceries").changeTone).toBeDefined();
  });
  test("a card gift under budget with nothing out of the pot: grey too, and Groceries still goes red", () => {
    const v = view(withPot([txn("2026-10-08", "Charity", -50000)]));
    expect(row(v, "Charity").barTone).toBe("grey");
    expect(row(v, "Groceries").barTone).toBe("red");
  });
  test("the panel's 12 bars are grey on Charity whatever the budget", () => {
    const f = lineFigures(withPot([txn("2026-09-08", "Charity", -500000), txn("2026-08-08", "Charity", -30000)]), "Charity", "spending", "2026-10", "2026-10-20");
    expect(f.months.every((m) => m.tone === "grey")).toBe(true);
    expect(f.months.find((m) => m.month === "2026-09")?.spentCents).toBe(500000);
  });
  test("with a pot and nothing on the line, Charity is a line and hidden by the ordinary rule", () => {
    const v = view({ ...INPUT, accounts: [...ACCOUNTS, POT], prepared: TXNS });
    const charity = row(v, "Charity");
    expect(charity).toBeTruthy();
    expect(charity.hidden).toBe(true);
  });
});

test("a yearly bill's charge stays in spent but leaves the 12-month average", () => {
  const yearly = { ...txn("2026-03-10", "Insurance", -60000), sourceTransactionId: "toy-yearly-insurance" };
  const over = {
    prepared: [...months12.map(m => txn(m + "-06", "Insurance", -10000)), yearly],
    mapping: { Insurance: "Insurance" }, yearlyTxnIds: [yearly.sourceTransactionId],
    today: "2026-11-01",
  };
  expect(row(view({ ...over, month: "2026-03" }), "Insurance").spentCents).toBe(70000);
  expect(row(view({ ...over, month: "2026-10" }), "Insurance").comparisonCents).toBe(10000);
});

test("Charity takes the over-budget tone unless the pot is on", () => {
  const over = (pot: CharityPot | null) => row(view({
    prepared: [txn("2026-05-05", "Charity", -20000)], mapping: { Charity: "Charity" },
    lines: [line("Charity", 10000)], month: "2026-05", today: "2026-07-01", salary: { ...INPUT.salary, pot },
  }), "Charity").leftTone;
  const pot = POT_ON;
  expect(over(null)).not.toBe("grey");
  expect(over({ ...pot, on: false })).not.toBe("grey");
  expect(over(pot)).toBe("grey");
});
