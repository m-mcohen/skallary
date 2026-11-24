import { describe, expect, test } from "vitest";
import { buildYearView, shadeBand, shadeOf } from "../../src/domain/budget-year";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import type { BigMonth, BudgetLine, Plan } from "../../src/domain/plan-types";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { CharityPot } from "../../src/domain/charity-pot";

const P = "plan-2026";
const PLAN: Plan = { id: P, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", createdAt: "" };
const ACCOUNTS: Account[] = [{ id: "demo-checking", name: "Pinecrest Joint Checking ...0101", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }];
let n = 0;
const txn = (date: string, cat: string, amountCents: number): NormalizedTxn => ({
  sourceTransactionId: `y${++n}`, accountId: "demo-checking", date, amountCents, sourceCategory: cat, merchant: cat, isTransfer: false, sourceUpdatedAt: null,
});
const MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const TXNS = [
  ...MONTHS.map((m) => txn(`${m}-05`, "Groceries", m === "2026-05" ? -150000 : -50000)),
  txn("2026-10-03", "Groceries", -20000),
  ...MONTHS.map((m) => txn(`${m}-15`, "Paychecks", 400000)),
];
const line = (cat: string, amountCents: number): BudgetLine => ({ planId: P, planningCategory: cat, period: null, amountCents, source: "suggested" });
const big: BigMonth = { id: 1, planId: P, planningCategory: "Gifts", month: "2026-12", label: "Holiday gifts", amountCents: 40000, createdAt: "" };
const POT_ON: CharityPot = { on: true, name: "Giving", kind: "percent", rateBps: 1000, fixedCents: null, fixedFrom: null,
  counts: { me: true, partner: true, joint: true }, floorCents: 0 };
const INPUT = {
  prepared: TXNS, accounts: ACCOUNTS, mapping: { Groceries: "Groceries", Paychecks: "Paychecks", Gifts: "Gifts" },
  lines: [line("Groceries", 55000), line("Gifts", 10000)], changes: [], bigMonths: [big],
  notes: [{ planId: P, planningCategory: "Groceries", month: "2026-05", note: "Party", updatedAt: "" }],
  settings: [], salary: { ...DEFAULT_SALARY_ASSUMPTIONS, currentSalary: { kind: "gross" as const, grossAnnualCents: 9_600_000, fromPeriod: "2026-11" } },
  plan: PLAN, today: "2026-10-20",
};
const rowOf = (v: ReturnType<typeof buildYearView>, name: string) => v.sections.flatMap((s) => s.rows).find((r) => r.line === name)!;

describe("shading", () => {
  test("the band is the larger of the typical swing, 15% of the average, or $15", () => {
    expect(shadeBand([100, 100, 100], 100)).toBe(1500);
    expect(shadeBand([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 120000], 10000)).toBeGreaterThan(30000);
    expect(shadeBand([50000, 50000], 50000)).toBe(7500);
  });
  test("beyond 1.5 bands shades; beyond 2.5 shades darker; high and low apart", () => {
    expect(shadeOf(50000 + 15000, 50000, 10000)).toBeNull();
    expect(shadeOf(50000 + 15001, 50000, 10000)).toBe("high");
    expect(shadeOf(50000 + 25001, 50000, 10000)).toBe("high-strong");
    expect(shadeOf(50000 - 15001, 50000, 10000)).toBe("low");
    expect(shadeOf(50000 - 25001, 50000, 10000)).toBe("low-strong");
  });
});

describe("the year grid", () => {
  test("finished months show spent, this month spent so far, future months the budget in force with big months", () => {
    const v = buildYearView(INPUT);
    expect(v.months).toHaveLength(12);
    const g = rowOf(v, "Groceries");
    expect(g.cells[0]).toMatchObject({ month: "2026-01", state: "finished", cents: 50000 });
    expect(g.cells[9]).toMatchObject({ month: "2026-10", state: "now", cents: 20000, shade: null });
    expect(g.cells[11]).toMatchObject({ month: "2026-12", state: "future", cents: 55000 });
    const gifts = rowOf(v, "Gifts");
    expect(gifts.cells[11].cents).toBe(50000);
    expect(gifts.bigMonths).toEqual([big]);
  });
  test("an unusual finished month shades and carries its note", () => {
    const g = rowOf(buildYearView(INPUT), "Groceries");
    expect(g.cells[4].shade).toBe("high-strong");
    expect(g.cells[4].note).toBe("Party");
    expect(g.cells[3].shade).toBeNull();
  });
  test("income lines never shade; future Paychecks reads Settings, blank before the salary starts", () => {
    // A bonus month that would shade strongly on a spending line.
    const withBonus = { ...INPUT, prepared: [...TXNS, txn("2026-06-20", "Paychecks", 1_200_000)] };
    const pay = rowOf(buildYearView(withBonus), "Paychecks");
    expect(pay.cells.every((c) => c.shade === null)).toBe(true);
    expect(pay.cells[10].cents).toBeGreaterThan(0);
    const aug = buildYearView({ ...INPUT, today: "2026-08-10" });
    expect(rowOf(aug, "Paychecks").cells[8].cents).toBeNull();
  });
  test("the Average column follows the 12-month rule", () => {
    expect(rowOf(buildYearView(INPUT), "Groceries").averageCents).toBe(Math.round((11 * 50000 + 150000) / 12));
  });
  test("Left over: finished months actual, future months budget (blank without a salary)", () => {
    const v = buildYearView(INPUT);
    expect(v.leftOver.cells[0]).toBe(400000 - 50000);
    expect(v.leftOver.cells[10]).not.toBeNull();
    const aug = buildYearView({ ...INPUT, today: "2026-08-10" });
    expect(aug.leftOver.cells[8]).toBeNull();
  });
});

describe("with the charity pot on, the Year tab never shades the Charity line", () => {
  test("a $1,000 September after $10 gifts all year stays unshaded on Charity and still shades Groceries", () => {
    const small = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map((m) => txn(`${m}-10`, "Charity", -1000));
    const v = buildYearView({
      ...INPUT,
      prepared: [...TXNS, ...small, txn("2026-09-10", "Charity", -100000)],
      mapping: { ...INPUT.mapping, Charity: "Charity" },
      lines: [...INPUT.lines, line("Charity", 1000)],
      salary: { ...INPUT.salary, pot: POT_ON },
    });
    const charity = rowOf(v, "Charity");
    expect(charity.cells.every((c) => c.shade === null)).toBe(true);
    expect(rowOf(v, "Groceries").cells.some((c) => c.shade !== null)).toBe(true);
  });
});
