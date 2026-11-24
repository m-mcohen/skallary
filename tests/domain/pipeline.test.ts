import { describe, it, expect } from "vitest";
import { prepareTransactions } from "../../src/domain/pipeline";
import type { NormalizedTxn } from "../../src/domain/types";

const txn = (over: Partial<NormalizedTxn> & { sourceTransactionId: string }): NormalizedTxn => ({
  accountId: "demo-checking", date: "2026-09-02", amountCents: -5000, sourceCategory: null,
  merchant: null, isTransfer: false, sourceUpdatedAt: null,
  description: null, memo: null, payee: null, mcc: null, pending: false, ...over,
});

describe("prepareTransactions", () => {
  it("categorizes a blank SimpleFIN row from its raw memo", () => {
    const out = prepareTransactions([txn({ sourceTransactionId: "a", memo: "ZELLE PAT QUINCE", amountCents: -50000 })], {
      rules: [{ id: 1, priority: 100, memoContains: "quince", amountCents: -50000, action: "categorize", toCategory: "Memberships" }],
      adjustments: [],
    });
    expect(out[0].sourceCategory).toBe("Memberships");
  });

  it("flags both legs of an internal move after the rules have run", () => {
    const out = prepareTransactions(
      [
        txn({ sourceTransactionId: "out", accountId: "demo-checking", amountCents: -100000 }),
        txn({ sourceTransactionId: "in", accountId: "demo-brokerage", amountCents: 100000 }),
      ],
      { rules: [], adjustments: [] }
    );
    expect(out.every((t) => t.isTransfer)).toBe(true);
  });

  it("lets a hand-made adjustment override what the rules decided", () => {
    // Adjustments run LAST on purpose: they are the user's explicit
    // correction, so they beat both the rules and pair-matching.
    const out = prepareTransactions([txn({ sourceTransactionId: "a", memo: "AMAZON", sourceCategory: null })], {
      rules: [{ id: 1, priority: 100, memoContains: "amazon", action: "categorize", toCategory: "Shopping" }],
      adjustments: [{ matchKind: "category_amount", matchCategory: "Shopping", action: "recategorize", toCategory: "Household" }],
    });
    expect(out[0].sourceCategory).toBe("Household");
  });

  it("keeps the rent payment as spend end to end", () => {
    // The whole point: no counterpart leg, so nothing flags it a transfer,
    // and it lands in Rent rather than vanishing from the budget.
    const out = prepareTransactions(
      [
        txn({ sourceTransactionId: "rent", accountId: "demo-checking", amountCents: -210000, memo: "ZELLE TO LANDLORD" }),
        txn({ sourceTransactionId: "other", accountId: "demo-card-alex", amountCents: -210000, memo: "UNRELATED" , date: "2026-09-25" }),
      ],
      { rules: [{ id: 1, priority: 100, memoContains: "landlord", action: "categorize", toCategory: "Rent" }], adjustments: [] }
    );
    const rent = out.find((t) => t.sourceTransactionId === "rent")!;
    expect(rent.sourceCategory).toBe("Rent");
    expect(rent.isTransfer).toBe(false);
  });
});
