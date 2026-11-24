import { describe, it, expect } from "vitest";
import { applyAdjustments, type TransactionAdjustment } from "../../src/domain/adjustments";
import { rollupMonthly } from "../../src/domain/rollups";
import type { NormalizedTxn, Account } from "../../src/domain/types";

const txn = (overrides: Partial<NormalizedTxn> = {}): NormalizedTxn => ({
  sourceTransactionId: "t1",
  accountId: "acc-1",
  date: "2026-07-15",
  amountCents: 130000,
  sourceCategory: "Paychecks",
  merchant: "Employer",
  isTransfer: false,
  sourceUpdatedAt: null,
  ...overrides,
});

describe("applyAdjustments", () => {
  it("'transfer' action flips isTransfer on matching category_amount txns only", () => {
    const matching = txn({ sourceTransactionId: "t1", sourceCategory: "Paychecks", amountCents: 130000 });
    const nonMatchingAmount = txn({ sourceTransactionId: "t2", sourceCategory: "Paychecks", amountCents: 500000 });
    const nonMatchingCategory = txn({ sourceTransactionId: "t3", sourceCategory: "Dining", amountCents: 130000 });
    const adj: TransactionAdjustment[] = [
      { matchKind: "category_amount", matchCategory: "Paychecks", matchAmountCents: 130000, action: "transfer" },
    ];
    const out = applyAdjustments([matching, nonMatchingAmount, nonMatchingCategory], adj);
    expect(out).toHaveLength(3);
    expect(out.find((t) => t.sourceTransactionId === "t1")!.isTransfer).toBe(true);
    expect(out.find((t) => t.sourceTransactionId === "t2")!.isTransfer).toBe(false);
    expect(out.find((t) => t.sourceTransactionId === "t3")!.isTransfer).toBe(false);
  });

  it("'exclude' action drops matching txns entirely", () => {
    const matching = txn({ sourceTransactionId: "t1", sourceCategory: "Fees", amountCents: 5000 });
    const nonMatching = txn({ sourceTransactionId: "t2", sourceCategory: "Fees", amountCents: 9999 });
    const adj: TransactionAdjustment[] = [
      { matchKind: "category_amount", matchCategory: "Fees", matchAmountCents: 5000, action: "exclude" },
    ];
    const out = applyAdjustments([matching, nonMatching], adj);
    expect(out.map((t) => t.sourceTransactionId)).toEqual(["t2"]);
  });

  it("'id' match kind matches by sourceTransactionId regardless of category/amount", () => {
    const target = txn({ sourceTransactionId: "abc-123", sourceCategory: "Whatever", amountCents: 42 });
    const other = txn({ sourceTransactionId: "xyz-999", sourceCategory: "Whatever", amountCents: 42 });
    const adj: TransactionAdjustment[] = [
      { matchKind: "id", sourceTransactionId: "abc-123", action: "exclude" },
    ];
    const out = applyAdjustments([target, other], adj);
    expect(out.map((t) => t.sourceTransactionId)).toEqual(["xyz-999"]);
  });

  it("non-matching transactions pass through untouched", () => {
    const t1 = txn({ sourceTransactionId: "t1", sourceCategory: "Groceries", amountCents: 4000 });
    const adj: TransactionAdjustment[] = [
      { matchKind: "category_amount", matchCategory: "Paychecks", matchAmountCents: 130000, action: "transfer" },
    ];
    const out = applyAdjustments([t1], adj);
    expect(out).toEqual([t1]);
  });

  it("'recategorize' re-labels a mis-filed/mis-flagged payment into the right category and counts it as expense", () => {
    const accounts: Account[] = [
      { id: "acc-1", name: "Joint", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "joint" },
    ];
    // A rent payment the bank flagged as a Transfer (would be dropped from spend).
    const rentAsTransfer = txn({ sourceTransactionId: "r-1", sourceCategory: "Transfer", amountCents: -210000, isTransfer: true, date: "2026-05-14" });
    // A studio rent payment mis-tagged as legal services.
    const studioAsLegal = txn({ sourceTransactionId: "b-1", sourceCategory: "Financial & Legal Services", amountCents: -40000, date: "2026-05-01" });
    // A genuine legal fee of a different amount must NOT be touched.
    const realLegal = txn({ sourceTransactionId: "l-1", sourceCategory: "Financial & Legal Services", amountCents: -12345, date: "2026-05-20" });
    const adj: TransactionAdjustment[] = [
      { matchKind: "category_amount", matchCategory: "Transfer", matchAmountCents: -210000, action: "recategorize", toCategory: "Rent" },
      { matchKind: "category_amount", matchCategory: "Financial & Legal Services", matchAmountCents: -40000, action: "recategorize", toCategory: "Studio Rent" },
    ];
    const out = applyAdjustments([rentAsTransfer, studioAsLegal, realLegal], adj);
    const rent = out.find((t) => t.sourceTransactionId === "r-1")!;
    expect(rent.sourceCategory).toBe("Rent");
    expect(rent.isTransfer).toBe(false); // un-flagged so it counts as spend
    expect(out.find((t) => t.sourceTransactionId === "b-1")!.sourceCategory).toBe("Studio Rent");
    expect(out.find((t) => t.sourceTransactionId === "l-1")!.sourceCategory).toBe("Financial & Legal Services"); // untouched
    // Through the rollup: the rent now shows as a Rent expense (it was invisible as a Transfer),
    // the studio rent shows as Studio Rent, and only the real fee remains under legal services.
    const rollups = rollupMonthly(out, accounts, {});
    expect(rollups.find((r) => r.planningCategory === "Rent" && r.kind === "expense")!.amountCents).toBe(210000);
    expect(rollups.find((r) => r.planningCategory === "Studio Rent" && r.kind === "expense")!.amountCents).toBe(40000);
    expect(rollups.find((r) => r.planningCategory === "Financial & Legal Services" && r.kind === "expense")!.amountCents).toBe(12345);
  });

  it("a category-only rule (null amount) matches every amount in that category", () => {
    // Maaser set-aside inflows come in varying amounts; a null matchAmountCents means "any amount".
    const a = txn({ sourceTransactionId: "m-1", sourceCategory: "Maaser", amountCents: 20000 });
    const b = txn({ sourceTransactionId: "m-2", sourceCategory: "Maaser", amountCents: 175000 });
    const other = txn({ sourceTransactionId: "c-1", sourceCategory: "Charity", amountCents: -5000 });
    const adj: TransactionAdjustment[] = [
      { matchKind: "category_amount", matchCategory: "Maaser", matchAmountCents: null, action: "transfer" },
    ];
    const out = applyAdjustments([a, b, other], adj);
    expect(out.find((t) => t.sourceTransactionId === "m-1")!.isTransfer).toBe(true);
    expect(out.find((t) => t.sourceTransactionId === "m-2")!.isTransfer).toBe(true);
    expect(out.find((t) => t.sourceTransactionId === "c-1")!.isTransfer).toBe(false); // real giving untouched
  });

  it("after applyAdjustments + rollupMonthly, a $1,300 Paychecks txn no longer appears as income", () => {
    const accounts: Account[] = [
      { id: "acc-1", name: "Checking", type: "checking", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
    ];
    const paycheck = txn({ sourceTransactionId: "pc-1", sourceCategory: "Paychecks", amountCents: 130000, date: "2026-07-10" });
    const groceries = txn({
      sourceTransactionId: "g-1", sourceCategory: "Groceries", amountCents: -20000,
      date: "2026-07-11", isTransfer: false,
    });
    const adj: TransactionAdjustment[] = [
      { matchKind: "category_amount", matchCategory: "Paychecks", matchAmountCents: 130000, action: "transfer" },
    ];
    const adjusted = applyAdjustments([paycheck, groceries], adj);
    const rollups = rollupMonthly(adjusted, accounts, {});
    expect(rollups.some((r) => r.kind === "income" && r.planningCategory === "Paychecks")).toBe(false);
    expect(rollups.some((r) => r.planningCategory === "Groceries" && r.kind === "expense")).toBe(true);
  });
});
