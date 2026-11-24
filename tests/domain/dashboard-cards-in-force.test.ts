import { expect, test } from "vitest";
import { summariseForMasthead } from "../../src/ui/lib/instrument";
import { expandChanges } from "../../src/domain/budget-changes";
import type { BudgetChange, BudgetLine } from "../../src/domain/plan-types";

// The Dashboard's Fixed and Variable cards read this month's
// amounts in force. Plan 1 wired it; this pins it (proven by a perturbation of instrument.ts).
const P = "plan-2026";
const lines: BudgetLine[] = [
  { planId: P, planningCategory: "Rent", period: null, amountCents: 200000, source: "you" },
  { planId: P, planningCategory: "Groceries", period: null, amountCents: 50000, source: "suggested" },
];
const change: BudgetChange = { id: 1, planId: P, planningCategory: "Rent", fromMonth: "2026-10", amountCents: 210000, reason: "changed", goalId: null, createdAt: "" };
const base = {
  accounts: [], balances: [], categorySettings: [{ planningCategory: "Rent", recurring: true, recurringSource: "user" as const, pinned: false }],
  uncategorizedCount: 0, ruleCount: 0, lastSyncedAt: null, asOfDate: "2026-10-20",
};

test("the Fixed and Variable cards read this month's amounts in force", () => {
  const s = summariseForMasthead({ ...base, budgetLines: expandChanges(lines, [change], "2027-12") });
  expect(s.recurringCents).toBe(210000);
  expect(s.variableCents).toBe(50000);
});

test("a change from next month on does not move this month's cards", () => {
  const later = { ...change, fromMonth: "2026-11" };
  const s = summariseForMasthead({ ...base, budgetLines: expandChanges(lines, [later], "2027-12") });
  expect(s.recurringCents).toBe(200000);
});
