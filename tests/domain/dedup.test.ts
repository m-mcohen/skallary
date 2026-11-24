// tests/domain/dedup.test.ts
//
// classify() decides the one thing every figure depends on: is a row spending,
// income, or money moving between your own accounts.
// "Credit Card Payment" keeps its label but is not spending. Paying a card
// moves money from checking to the card; the purchases on the card are the
// spending, already counted in their own categories.
import { describe, expect, test } from "vitest";
import { classify, isTransferCategory } from "../../src/domain/dedup";
import type { NormalizedTxn } from "../../src/domain/types";

const txn = (over: Partial<NormalizedTxn>): NormalizedTxn =>
  ({ sourceTransactionId: "t", accountId: "a", date: "2026-08-01", amountCents: -100, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over }) as NormalizedTxn;

describe("isTransferCategory", () => {
  test("Credit Card Payment, whatever its case; nothing else", () => {
    expect(isTransferCategory("Credit Card Payment")).toBe(true);
    expect(isTransferCategory("credit card payment")).toBe(true);
    expect(isTransferCategory("Credit Card Payments")).toBe(false);
    expect(isTransferCategory("Credit Card")).toBe(false);
    expect(isTransferCategory("Payment")).toBe(false);
    expect(isTransferCategory("Transfer")).toBe(false);
  });
});

describe("classify", () => {
  test("a Credit Card Payment row is a transfer, and keeps its label", () => {
    expect(classify(txn({ sourceCategory: "Credit Card Payment" }), {})).toEqual({ planningCategory: "Credit Card Payment", kind: "transfer" });
  });

  test("the rule reads the PLANNING category, so a mapping can put a feed category in or out of it", () => {
    // Mapped INTO the category: a transfer.
    expect(classify(txn({ sourceCategory: "Card Autopay" }), { "Card Autopay": "Credit Card Payment" }).kind).toBe("transfer");
    // Mapped OUT of it, to a spending category: spending again. The mappings table
    // owns the taxonomy; this is the undo path the help describes.
    expect(classify(txn({ sourceCategory: "Credit Card Payment" }), { "Credit Card Payment": "Fees" })).toEqual({ planningCategory: "Fees", kind: "expense" });
  });

  test("everything else is as before", () => {
    expect(classify(txn({}), {}).kind).toBe("expense");
    expect(classify(txn({ sourceCategory: "Paychecks", amountCents: 1000 }), {}).kind).toBe("income");
    expect(classify(txn({ isTransfer: true }), {}).kind).toBe("transfer");
    expect(classify(txn({ sourceCategory: null }), {})).toEqual({ planningCategory: "Uncategorized", kind: "expense" });
  });
});
