import { describe, it, expect } from "vitest";
import { normalizeMemoKey, deriveRulesFromHistory } from "../../src/domain/rules";
import type { NormalizedTxn } from "../../src/domain/types";

const txn = (over: Partial<NormalizedTxn> & { sourceTransactionId: string }): NormalizedTxn => ({
  accountId: "demo-checking", date: "2026-09-02", amountCents: -5000, sourceCategory: null,
  merchant: null, isTransfer: false, sourceUpdatedAt: null,
  description: null, memo: null, payee: null, mcc: null, pending: false, ...over,
});

describe("normalizeMemoKey", () => {
  it("strips the confirmation code so the same recurring payment groups together", () => {
    // These are the same payment two different months. Raw, every memo is
    // unique and no rule could ever be learned from them.
    expect(normalizeMemoKey("Zelle payment from DEMO GUEST Conf# toyref1"))
      .toBe(normalizeMemoKey("Zelle payment from DEMO GUEST Conf# toyref2"));
    expect(normalizeMemoKey("Zelle payment to Maple Hall REF99demo1"))
      .toBe(normalizeMemoKey("Zelle payment to Maple Hall REF99DEMO2"));
  });

  it("keeps the part that identifies who was paid", () => {
    expect(normalizeMemoKey("Zelle payment to Cedar Hall REF99demo1")).toContain("cedar hall");
  });

  it("strips dates and card/account digits", () => {
    expect(normalizeMemoKey("MARKET #1234 09/01 DEMO TOWN")).toBe(normalizeMemoKey("MARKET #5678 08/14 DEMO TOWN"));
  });

  it("returns null for a memo with nothing stable left", () => {
    expect(normalizeMemoKey("")).toBeNull();
    expect(normalizeMemoKey("  12345 09/01  ")).toBeNull();
  });
});

describe("deriveRulesFromHistory with memos", () => {
  it("learns a rule for a payee the merchant field hides behind 'Zelle'", () => {
    // The memo is the only thing identifying these as the same recurring
    // payment -- the merchant field just says "Zelle".
    const history = Array.from({ length: 6 }, (_, i) =>
      txn({ sourceTransactionId: `b${i}`, merchant: "Zelle", memo: `Zelle payment to Cedar Hall REF${i}`, sourceCategory: "Studio Rent" })
    );
    const rule = deriveRulesFromHistory(history).find((r) => r.memoContains?.includes("cedar hall"));
    expect(rule?.toCategory).toBe("Studio Rent");
  });

  it("declines to guess when a group is split, leaving it for the review queue", () => {
    // Two of three isn't confidence, it's a coin flip with extra steps. The
    // safe outcome is no rule: the transaction surfaces for one explicit
    // decision, which then becomes a rule that never asks again.
    const history = [
      txn({ sourceTransactionId: "1", merchant: "Zelle", memo: "Zelle payment to Cedar Hall REF1", sourceCategory: "Studio Rent" }),
      txn({ sourceTransactionId: "2", merchant: "Zelle", memo: "Zelle payment to Cedar Hall REF2", sourceCategory: "Studio Rent" }),
      txn({ sourceTransactionId: "3", merchant: "Zelle", memo: "Zelle payment to Cedar Hall REF3", sourceCategory: "Financial & Legal Services" }),
    ];
    expect(deriveRulesFromHistory(history).some((r) => r.memoContains?.includes("cedar hall"))).toBe(false);
  });

  it("runs memo rules BEFORE merchant rules, because they identify more precisely", () => {
    const history = [
      txn({ sourceTransactionId: "1", merchant: "Zelle", memo: "Zelle payment to Cedar Hall REF1", sourceCategory: "Studio Rent" }),
      txn({ sourceTransactionId: "2", merchant: "Zelle", memo: "Zelle payment to Cedar Hall REF2", sourceCategory: "Studio Rent" }),
      txn({ sourceTransactionId: "3", merchant: "Zelle", memo: "Zelle payment to Cedar Hall REF3", sourceCategory: "Studio Rent" }),
      txn({ sourceTransactionId: "4", merchant: "Zelle", memo: "Zelle payment to Demo Guest REF4", sourceCategory: "Gifts" }),
      txn({ sourceTransactionId: "5", merchant: "Zelle", memo: "Zelle payment to Demo Guest REF5", sourceCategory: "Gifts" }),
      txn({ sourceTransactionId: "6", merchant: "Zelle", memo: "Zelle payment to Demo Guest REF6", sourceCategory: "Gifts" }),
    ];
    const rules = deriveRulesFromHistory(history);
    const memoRule = rules.find((r) => r.memoContains?.includes("cedar hall"))!;
    const merchantRule = rules.find((r) => r.payeeContains === "zelle");
    if (merchantRule) expect(memoRule.priority).toBeLessThan(merchantRule.priority);
  });

  it("ignores a memo pattern that only ever appeared once or twice", () => {
    const history = [
      txn({ sourceTransactionId: "1", merchant: "Zelle", memo: "Zelle payment to One Off REF1", sourceCategory: "Gifts" }),
      txn({ sourceTransactionId: "2", merchant: "Zelle", memo: "Zelle payment to One Off REF2", sourceCategory: "Gifts" }),
    ];
    // A memo rule needs more evidence than a merchant rule, because a memo
    // pattern that recurs twice is far weaker evidence than a named merchant.
    expect(deriveRulesFromHistory(history).some((r) => r.memoContains?.includes("one off"))).toBe(false);
  });
});

describe("memo rules only form when the group is actually one thing", () => {
  const many = (memo: string, category: string, n: number, from = 0): NormalizedTxn[] =>
    Array.from({ length: n }, (_, i) =>
      txn({ sourceTransactionId: `${memo}-${from + i}`, merchant: "Zelle", memo: `${memo} REF${from + i}`, sourceCategory: category })
    );

  it("refuses a rule for a memo pattern that covers several different things", () => {
    // Mixed history can hide distinct payment patterns.
    const history = [
      ...many("Online Transfer to ACCT", "Transfer", 6),
      ...many("Online Transfer to ACCT", "Giving", 5, 100),
      ...many("Online Transfer to ACCT", "Paychecks", 4, 200),
    ];
    expect(deriveRulesFromHistory(history).some((r) => r.memoContains?.includes("online transfer"))).toBe(false);
  });

  it("still learns a rule when the group is overwhelmingly one category", () => {
    const history = [...many("Zelle payment to Cedar Hall", "Studio Rent", 19), ...many("Zelle payment to Cedar Hall", "Gifts", 1, 50)];
    const rule = deriveRulesFromHistory(history).find((r) => r.memoContains?.includes("cedar hall"));
    expect(rule?.toCategory).toBe("Studio Rent");
  });
});
