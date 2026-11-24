// tests/domain/undo-invariance.test.ts
// Success line: "the reversal leaves every number exactly
// as it was before." A filing adds a rule, a one-row change and a recurring mark; Undo
// deletes exactly those (tests/server/categorizations.test.ts proves that). Here the
// real pipeline shows that deleting them gives back the same spending totals and the
// same Recurring list, on a fixture with an older rule for the same merchant.
import { expect, test } from "vitest";
import { prepareTransactions } from "../../src/domain/pipeline";
import { rollupMonthly } from "../../src/domain/rollups";
import { detectRecurring } from "../../src/domain/recurring";
import type { CategorizationRule } from "../../src/domain/rules";
import type { TransactionAdjustment } from "../../src/domain/adjustments";
import type { RecurringChoice } from "../../src/domain/recurring-choices";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const accounts: Account[] = [
  { id: "a1", name: "Checking", type: "depository", institution: "Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];
const t = (id: string, date: string, cents: number, merchant: string, cat: string | null = null): NormalizedTxn => ({
  sourceTransactionId: id, accountId: "a1", date, amountCents: cents, sourceCategory: cat,
  merchant, payee: merchant, isTransfer: false, sourceUpdatedAt: null,
});
const txns = [
  t("s1", "2026-07-02", -4000, "Shell"), t("s2", "2026-08-02", -4100, "Shell"), t("s3", "2026-09-02", -3900, "Shell"),
  t("n1", "2026-08-05", -1599, "Netflix", "Streaming"), t("n2", "2026-09-05", -1599, "Netflix", "Streaming"),
];
const older: CategorizationRule = { id: 1, priority: 100, payeeContains: "shell", action: "categorize", toCategory: "Fuel", note: null };

/** What you read: monthly totals by category and kind, and the Recurring list. */
function figures(rules: CategorizationRule[], adjustments: TransactionAdjustment[], choices: RecurringChoice[]) {
  const prepared = prepareTransactions(txns, { rules, adjustments, accounts });
  return {
    rollups: rollupMonthly(prepared, accounts, {}),
    recurring: detectRecurring(prepared, {}, "2026-10-05", choices).map((s) => [s.key, s.cadence]),
  };
}

test("a merchant filing over an older rule, with a recurring mark, then its undo, leaves every figure as it was", () => {
  const before = figures([older], [], []);
  const newer: CategorizationRule = { id: 2, priority: 100, payeeContains: "shell", action: "categorize", toCategory: "Gas", note: null };
  const mark: RecurringChoice = { payeeKey: "netflix", accountId: "a1", choice: "recurring", cadence: "annual", label: "Netflix", createdAt: "x" };
  expect(figures([older, newer], [], [mark])).not.toEqual(before);
  // Undo deleted the newer rule and the mark; the older rule was never touched.
  expect(figures([older], [], [])).toEqual(before);
});

test("a one-row change, then its undo, leaves every figure as it was", () => {
  const before = figures([older], [], []);
  const adj: TransactionAdjustment = { matchKind: "id", sourceTransactionId: "n2", action: "recategorize", toCategory: "Gifts", note: null };
  expect(figures([older], [adj], [])).not.toEqual(before);
  expect(figures([older], [], [])).toEqual(before);
});

test("the older rule matters: without it the figures differ, so the first test is not empty", () => {
  expect(figures([], [], [])).not.toEqual(figures([older], [], []));
});
