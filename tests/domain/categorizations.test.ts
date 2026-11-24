// tests/domain/categorizations.test.ts
// What a filing may contain, and what it writes for a row.
import { describe, expect, test } from "vitest";
import { buildFiling, filingScope, validateFiling } from "../../src/domain/categorizations";
import type { NormalizedTxn } from "../../src/domain/types";

const shell: NormalizedTxn = {
  sourceTransactionId: "t1", accountId: "a1", date: "2026-10-02", amountCents: -4012,
  sourceCategory: null, merchant: "Shell", payee: "Shell", isTransfer: false, sourceUpdatedAt: null,
};
const ok = {
  sourceTransactionId: "t1", label: "Shell", fromCategory: "Uncategorized", toCategory: "Gas",
  rule: { priority: 100, payeeContains: "shell", action: "categorize", toCategory: "Gas", note: "Set from Now" },
  adjustment: null,
};

describe("validateFiling", () => {
  test("a rule filing passes, and the server sets the rule's priority itself", () => {
    const v = validateFiling({ ...ok, rule: { ...ok.rule, priority: 1 } });
    expect(typeof v).toBe("object");
    expect((v as { rule: { priority: number } }).rule.priority).toBe(100);
  });
  test("a rule with a blank merchant name is refused: it would match every transaction", () => {
    expect(validateFiling({ ...ok, rule: { ...ok.rule, payeeContains: "  " } })).toBe(
      "This transaction has no merchant name, so it cannot become a rule."
    );
  });
  test("a filing with neither a rule nor a one-row change is refused", () => {
    expect(validateFiling({ ...ok, rule: null })).toBe("Pick a category first.");
  });
  test("a one-row change must be for the row being filed", () => {
    const adj = { matchKind: "id", sourceTransactionId: "other", action: "recategorize", toCategory: "Gas" };
    expect(validateFiling({ ...ok, rule: null, adjustment: adj })).toBe("That change is for a different transaction.");
  });
  test("a one-row change may not exclude a row: filing only files", () => {
    const adj = { matchKind: "id", sourceTransactionId: "t1", action: "exclude" };
    expect(validateFiling({ ...ok, rule: null, adjustment: adj })).toBe("Unknown change.");
  });
  test("a recurring mark is checked with the Recurring screen's own rules", () => {
    const recurring = {
      action: "save",
      choice: { payeeKey: "shell", accountId: "a1", choice: "recurring", cadence: "fortnightly", label: "Shell" },
    };
    expect(validateFiling({ ...ok, recurring })).toBe("Pick how often it repeats.");
  });
  test("a long note is refused; a note and a mark that pass are kept", () => {
    expect(validateFiling({ ...ok, note: "x".repeat(1001) })).toBe("A note can be at most 1,000 characters.");
    const v = validateFiling({ ...ok, note: " Road trip ", recurring: { action: "remove", payeeKey: "shell", accountId: "a1" } });
    expect(v).toMatchObject({ note: "Road trip", recurring: { action: "remove", payeeKey: "shell", accountId: "a1" } });
  });
  test("no note sent means the note is left alone", () => {
    expect("note" in (validateFiling(ok) as object)).toBe(false);
  });
});

describe("buildFiling", () => {
  test("Waiting on you always writes a rule for the merchant", () => {
    expect(buildFiling({ txn: shell, choice: "Gas", isTransfer: false, from: "Now", needsCategory: true, alsoRule: false })).toEqual({
      rule: { priority: 100, payeeContains: "shell", action: "categorize", toCategory: "Gas", note: "Set from Now" },
      adjustment: null,
    });
  });
  test("Transactions: a filed row gets a one-row change, plus a rule only when asked", () => {
    const filed = { ...shell, sourceCategory: "Fuel" };
    const one = buildFiling({ txn: filed, choice: "Gas", isTransfer: false, from: "Transactions", needsCategory: false, alsoRule: false });
    expect(one?.rule).toBeNull();
    expect(one?.adjustment).toMatchObject({ matchKind: "id", sourceTransactionId: "t1", action: "recategorize", toCategory: "Gas" });
    const both = buildFiling({ txn: filed, choice: "Gas", isTransfer: false, from: "Transactions", needsCategory: false, alsoRule: true });
    expect(both?.rule?.payeeContains).toBe("shell");
    expect(both?.adjustment).not.toBeNull();
  });
  test("Transactions: an uncategorized row takes the forward rule alone", () => {
    const r = buildFiling({ txn: shell, choice: "Gas", isTransfer: false, from: "Transactions", needsCategory: true, alsoRule: true });
    expect(r?.rule?.payeeContains).toBe("shell");
    expect(r?.adjustment).toBeNull();
  });
  test("an uncategorized row with no merchant name takes a one-row change, never a blank rule", () => {
    const blank = { ...shell, merchant: null, payee: null, description: null };
    const r = buildFiling({ txn: blank, choice: "Gas", isTransfer: false, from: "Transactions", needsCategory: true, alsoRule: false });
    expect(r?.rule).toBeNull();
    expect(r?.adjustment?.sourceTransactionId).toBe("t1");
    expect(buildFiling({ txn: blank, choice: "Gas", isTransfer: false, from: "Now", needsCategory: true, alsoRule: false })).toBeNull();
  });
  test("a transfer writes the transfer kind", () => {
    expect(buildFiling({ txn: shell, choice: "", isTransfer: true, from: "Now", needsCategory: true, alsoRule: false })?.rule).toEqual({
      priority: 100, payeeContains: "shell", action: "transfer", note: "Set from Now",
    });
  });
});

test("filingScope says how far a filing reached", () => {
  expect(filingScope({ ruleId: 1, adjustmentId: null })).toBe("Every transaction from this merchant");
  expect(filingScope({ ruleId: null, adjustmentId: 2 })).toBe("This transaction");
  expect(filingScope({ ruleId: 1, adjustmentId: 2 })).toBe("This transaction, and every one from this merchant");
});
