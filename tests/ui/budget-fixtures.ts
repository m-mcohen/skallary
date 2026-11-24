// tests/ui/budget-fixtures.ts -- an in-memory data layer for the Budget screens (invented
// figures; the same shape as tests/domain/budget-month.test.ts). Today is October 20, 2026.
import { vi } from "vitest";
import type { BudgetDataLayer } from "../../src/ui/budget/useBudgetData";
import type { BigMonth, BudgetChange, BudgetLine, MonthNote, Plan } from "../../src/domain/plan-types";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { CategorySetting } from "../../src/domain/category-settings";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import type { Db } from "../../src/ui/lib/db";
import type { MaaserMark } from "../../src/domain/maaser-marks";

export const TODAY = "2026-10-20";
export const PLAN: Plan = { id: "plan-2026", name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", createdAt: "" };
const ACCOUNTS: Account[] = [{ id: "checking", name: "Pinecrest Checking", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }];
let n = 0;
const txn = (date: string, cat: string, amountCents: number): NormalizedTxn => ({
  sourceTransactionId: `t${++n}`, accountId: "checking", date, amountCents, sourceCategory: cat, merchant: cat, isTransfer: false, sourceUpdatedAt: null,
});
const MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
export const TXNS: NormalizedTxn[] = [
  ...MONTHS.map((m) => txn(`${m}-05`, "Groceries", -50000)),
  txn("2026-10-03", "Groceries", -30000), txn("2026-10-18", "Groceries", -20000),
  ...[...MONTHS, "2026-10"].map((m) => txn(`${m}-01`, "Rent", -200000)),
  txn("2026-03-10", "Clothing", -12000),
  txn("2024-01-10", "Hobby", -5000),
  ...[...MONTHS, "2026-10"].map((m) => txn(`${m}-15`, "Paychecks", 400000)),
];
const MAPPING = { Groceries: "Groceries", Rent: "Rent", Clothing: "Clothing", Hobby: "Hobby", Paychecks: "Paychecks", Gifts: "Gifts" };

export function makeBudgetLayer(over: {
  lines?: BudgetLine[]; changes?: BudgetChange[]; bigMonths?: BigMonth[]; notes?: MonthNote[]; settings?: CategorySetting[];
  accounts?: Account[]; txns?: NormalizedTxn[]; maaserFloorCents?: number; maaserMarks?: MaaserMark[];
} = {}) {
  const state = {
    lines: over.lines ?? [
      { planId: PLAN.id, planningCategory: "Groceries", period: null, amountCents: 45000, source: "suggested" as const },
      { planId: PLAN.id, planningCategory: "Rent", period: null, amountCents: 200000, source: "you" as const },
      { planId: PLAN.id, planningCategory: "Gifts", period: null, amountCents: 10000, source: "suggested" as const },
    ],
    changes: over.changes ?? [],
    bigMonths: over.bigMonths ?? [],
    notes: over.notes ?? [{ planId: PLAN.id, planningCategory: "Groceries", month: "2026-10", note: "Party", updatedAt: "" }],
    settings: over.settings ?? [{ planningCategory: "Rent", recurring: true, recurringSource: "user" as const, pinned: false }],
  };
  const layer: BudgetDataLayer = {
    loadDb: async () => ({}) as Db,
    getTransactions: async () => over.txns ?? TXNS,
    getAccounts: async () => over.accounts ?? ACCOUNTS,
    getCategoryMappings: async () => MAPPING,
    getTransactionAdjustments: async () => [],
    listPlans: async () => [PLAN],
    getBudgetLines: async () => state.lines,
    getBudgetExtras: async () => ({ changes: state.changes, bigMonths: state.bigMonths, notes: state.notes }),
    getCategorySettings: async () => state.settings,
    getSalarySettings: async () => ({ ...DEFAULT_SALARY_ASSUMPTIONS, maaserRate: 0.1, currentSalary: { kind: "gross" as const, grossAnnualCents: 12_000_000, fromPeriod: "2026-11" } }),
    listGoals: async () => [],
    getMaaserFloor: async () => over.maaserFloorCents ?? 0,
    getMaaserMarks: async () => over.maaserMarks ?? [],
    setCategoryRecurring: vi.fn(async () => {}),
    changeBudgetLine: vi.fn(async () => ({ replaced: [] })),
    resetBudgetLine: vi.fn(async () => ({ cleared: [], kept: [], suggestion: { planningCategory: "", amountCents: 0, basis: { kind: "average" as const, months: 12, emptyMonths: 0 } } })),
    getLineSuggestion: vi.fn(async (_db: Db, _p: string, line: string) => ({ planningCategory: line, amountCents: 50000, basis: { kind: "average" as const, months: 12, emptyMonths: 0 } })),
    addBigMonth: vi.fn(async (_db: Db, planId: string, b: Pick<BigMonth, "planningCategory" | "month" | "label" | "amountCents">) => ({ ...b, id: 9, planId, createdAt: "" })),
    updateBigMonth: vi.fn(async () => {}),
    deleteBigMonth: vi.fn(async () => {}),
    setMonthNote: vi.fn(async () => {}),
    getSetup: vi.fn(async () => ({ suggestions: [] })),
    applySetup: vi.fn(async () => ({ applied: 0, cleared: [] })),
    startNextYear: vi.fn(async (_db: Db, _from: string, _lines: unknown) => ({ plan: { ...PLAN, id: "plan-2027", name: "2027", startDate: "2027-01-01", endDate: "2027-12-31" } })),
  };
  return { layer, state };
}
