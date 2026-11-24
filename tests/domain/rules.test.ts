import { describe, it, expect } from "vitest";
import { applyRules, deriveRulesFromHistory, ruleKeyFor, type CategorizationRule } from "../../src/domain/rules";
import type { NormalizedTxn } from "../../src/domain/types";

const txn = (over: Partial<NormalizedTxn> & { sourceTransactionId: string }): NormalizedTxn => ({
  accountId: "demo-checking", date: "2026-09-02", amountCents: -5000, sourceCategory: null,
  merchant: null, isTransfer: false, sourceUpdatedAt: null,
  description: null, memo: null, payee: null, mcc: null, pending: false, ...over,
});

const rule = (over: Partial<CategorizationRule>): CategorizationRule => ({
  id: 1, priority: 100, action: "categorize", ...over,
});

describe("applyRules -- matching", () => {
  it("matches the raw bank memo, case-insensitively", () => {
    // The bank feed uses a generic payee, so the memo identifies the recipient.
    const rows = [txn({ sourceTransactionId: "t1", memo: "ZELLE TO CEDAR HALL 09/01" })];
    const rules = [rule({ memoContains: "cedar", toCategory: "Studio Rent" })];
    expect(applyRules(rows, rules)[0].sourceCategory).toBe("Studio Rent");
  });

  it("requires every condition in a rule to hold", () => {
    // Two payments to one merchant have different amounts.
    const rules = [rule({ memoContains: "cedar", amountCents: -70000, toCategory: "Studio Rent" })];
    expect(applyRules([txn({ sourceTransactionId: "rent", memo: "ZELLE CEDAR", amountCents: -70000 })], rules)[0].sourceCategory).toBe("Studio Rent");
    expect(applyRules([txn({ sourceTransactionId: "wifi", memo: "ZELLE CEDAR", amountCents: -5000 })], rules)[0].sourceCategory).toBeNull();
  });

  it("matches an amount range for a bill that drifts month to month", () => {
    // Studio internet is "between 30 and 40 dollars".
    const rules = [rule({ memoContains: "cedar", amountMinCents: -4000, amountMaxCents: -3000, toCategory: "Studio Internet" })];
    expect(applyRules([txn({ sourceTransactionId: "a", memo: "CEDAR", amountCents: -3500 })], rules)[0].sourceCategory).toBe("Studio Internet");
    expect(applyRules([txn({ sourceTransactionId: "b", memo: "CEDAR", amountCents: -70000 })], rules)[0].sourceCategory).toBeNull();
  });

  it("can scope a rule to one account", () => {
    const rules = [rule({ payeeContains: "transfer", accountId: "demo-checking", toCategory: "Savings" })];
    expect(applyRules([txn({ sourceTransactionId: "a", accountId: "demo-checking", payee: "Transfer" })], rules)[0].sourceCategory).toBe("Savings");
    expect(applyRules([txn({ sourceTransactionId: "b", accountId: "demo-savings", payee: "Transfer" })], rules)[0].sourceCategory).toBeNull();
  });

  it("matches on payee and description as well as memo", () => {
    const rules = [
      rule({ id: 1, payeeContains: "maple market", toCategory: "Groceries" }),
      rule({ id: 2, descriptionContains: "toy power", toCategory: "Utilities" }),
    ];
    const out = applyRules(
      [txn({ sourceTransactionId: "a", payee: "Maple Market #123" }), txn({ sourceTransactionId: "b", description: "TOY POWER AUTOPAY" })],
      rules
    );
    expect(out.map((t) => t.sourceCategory)).toEqual(["Groceries", "Utilities"]);
  });

  it("first rule wins, in priority order", () => {
    const rules = [
      rule({ id: 2, priority: 200, memoContains: "amazon", toCategory: "Shopping" }),
      rule({ id: 1, priority: 100, memoContains: "amazon", toCategory: "Household" }),
    ];
    // Lower priority number runs first, so Household wins even though the
    // Shopping rule is listed first.
    expect(applyRules([txn({ sourceTransactionId: "a", memo: "AMAZON MKTPL" })], rules)[0].sourceCategory).toBe("Household");
  });
});

describe("applyRules -- actions", () => {
  it("flags a transfer without changing the category", () => {
    const rules = [rule({ memoContains: "giving", action: "transfer" })];
    const out = applyRules([txn({ sourceTransactionId: "a", memo: "TRANSFER TO GIVING" })], rules);
    expect(out[0].isTransfer).toBe(true);
  });

  it("drops an excluded transaction entirely", () => {
    const rules = [rule({ memoContains: "test charge", action: "exclude" })];
    expect(applyRules([txn({ sourceTransactionId: "a", memo: "TEST CHARGE" })], rules)).toHaveLength(0);
  });

  it("leaves a transaction no rule matches untouched, for the uncategorized queue", () => {
    const rows = [txn({ sourceTransactionId: "a", memo: "SOMETHING NEW" })];
    const out = applyRules(rows, [rule({ memoContains: "nope", toCategory: "X" })]);
    expect(out[0].sourceCategory).toBeNull();
    expect(out[0]).not.toBe(rows[0]); // never mutates the input
    expect(rows[0].sourceCategory).toBeNull();
  });

  it("never overwrites a category a transaction already carries", () => {
    // Keep categories already assigned in the source feed.
    const rows = [txn({ sourceTransactionId: "a", memo: "AMAZON", sourceCategory: "Shopping" })];
    expect(applyRules(rows, [rule({ memoContains: "amazon", toCategory: "Household" })])[0].sourceCategory).toBe("Shopping");
  });
});

describe("deriveRulesFromHistory", () => {
  it("turns categorized history into memo rules so the taxonomy carries over", () => {
    // Learn the existing categories from the imported history.
    const history = [
      ...Array.from({ length: 20 }, (_, i) =>
        txn({ sourceTransactionId: `p${i}`, merchant: "Maple Market", sourceCategory: "Groceries" })),
      txn({ sourceTransactionId: "stray", merchant: "Maple Market", sourceCategory: "Dining" }),
    ];
    const rules = deriveRulesFromHistory(history);
    // The dominant category wins; one stray miscategorization doesn't.
    expect(rules).toEqual([expect.objectContaining({ payeeContains: "maple market", toCategory: "Groceries" })]);
  });

  it("refuses a merchant whose history is only a bare plurality", () => {
    // A mixed payment history does not identify a single category.
    const history = [
      txn({ sourceTransactionId: "1", merchant: "Maple Market", sourceCategory: "Groceries" }),
      txn({ sourceTransactionId: "2", merchant: "Maple Market", sourceCategory: "Groceries" }),
      txn({ sourceTransactionId: "3", merchant: "Maple Market", sourceCategory: "Dining" }),
    ];
    expect(deriveRulesFromHistory(history)).toEqual([]);
  });

  it("ignores merchants with too little history to be confident", () => {
    const history = [txn({ sourceTransactionId: "1", merchant: "One Off Shop", sourceCategory: "Shopping" })];
    expect(deriveRulesFromHistory(history, { minOccurrences: 2 })).toEqual([]);
  });

  it("skips uncategorized and transfer history rather than learning from noise", () => {
    const history = [
      txn({ sourceTransactionId: "1", merchant: "A", sourceCategory: null }),
      txn({ sourceTransactionId: "2", merchant: "A", sourceCategory: null }),
      txn({ sourceTransactionId: "3", merchant: "B", sourceCategory: "Transfer", isTransfer: true }),
      txn({ sourceTransactionId: "4", merchant: "B", sourceCategory: "Transfer", isTransfer: true }),
    ];
    expect(deriveRulesFromHistory(history)).toEqual([]);
  });
});

describe("applyRules -- statement text across feeds", () => {
  it("falls back to the description when the feed leaves the memo empty", () => {
    // When a feed leaves the memo empty, the description holds the statement text.
    const rows = [
      txn({
        sourceTransactionId: "sf1",
        memo: "",
        description: "DEMO COVER INSURANCE",
        payee: "Demo Cover",
      }),
    ];
    const rules = [rule({ memoContains: "demo cover insurance", toCategory: "Renter's Insurance" })];
    expect(applyRules(rows, rules)[0].sourceCategory).toBe("Renter's Insurance");
  });

  it("still prefers the memo when the feed supplies one", () => {
    // The fallback must not turn into "memo OR description". A row whose real
    // memo names a different counterparty than its description summary must
    // match on the memo alone, or a generic description could steal the row.
    const rows = [
      txn({
        sourceTransactionId: "m1",
        memo: "ZELLE TO CEDAR HALL",
        description: "Zelle payment",
      }),
    ];
    const rules = [rule({ memoContains: "zelle payment", toCategory: "Gifts" })];
    expect(applyRules(rows, rules)[0].sourceCategory).toBeNull();
  });
});

describe("applyRules -- substring safety", () => {
  it("will not match a key in the middle of a longer word", () => {
    // A short merchant key needs word boundaries.
    const rows = [
      txn({ sourceTransactionId: "ins", payee: "Toy Insurance Office" }),
      txn({ sourceTransactionId: "gws", payee: "Demo Workspace" }),
    ];
    const rules = [rule({ payeeContains: "ce", toCategory: "Electronics" })];
    const out = applyRules(rows, rules);
    expect(out.map((t) => t.sourceCategory)).toEqual([null, null]);
  });

  it("still matches a short merchant name standing on its own", () => {
    // Short merchant names still match as whole words.
    const rules = [
      rule({ id: 1, payeeContains: "cvs", toCategory: "Medical" }),
      rule({ id: 2, payeeContains: "h&m", toCategory: "Clothing" }),
      rule({ id: 3, payeeContains: "ups", toCategory: "Postage & Shipping" }),
    ];
    expect(applyRules([txn({ sourceTransactionId: "a", payee: "CVS/PHARMACY #1000" })], rules)[0].sourceCategory).toBe("Medical");
    expect(applyRules([txn({ sourceTransactionId: "b", payee: "H&M STORE 0001" })], rules)[0].sourceCategory).toBe("Clothing");
    expect(applyRules([txn({ sourceTransactionId: "c", payee: "THE UPS STORE" })], rules)[0].sourceCategory).toBe("Postage & Shipping");
  });

  it("does not let a short key match inside an unrelated word", () => {
    // "gap" must not fire on "SINGAPORE AIRLINES".
    const rules = [rule({ payeeContains: "gap", toCategory: "Clothing" })];
    expect(applyRules([txn({ sourceTransactionId: "sg", payee: "SINGAPORE AIRLINES" })], rules)[0].sourceCategory).toBeNull();
  });
});

describe("deriveRulesFromHistory -- merchant purity", () => {
  const many = (n: number, merchant: string, category: string, from = 0): NormalizedTxn[] =>
    Array.from({ length: n }, (_, i) =>
      txn({ sourceTransactionId: `${merchant}-${category}-${from + i}`, merchant, sourceCategory: category }));

  it("refuses to learn from a merchant whose history is category-mixed", () => {
    // A mixed payment history does not identify a single category.
    const history = [
      ...many(5, "zelle", "Other Income"),
      ...many(4, "zelle", "Rent"),
      ...many(3, "zelle", "Gifts"),
    ];
    const rules = deriveRulesFromHistory(history);
    expect(rules.filter((r) => r.payeeContains === "zelle")).toEqual([]);
  });

  it("still learns from a merchant that is consistently one category", () => {
    // One outlier does not outweigh a consistent history.
    const history = [...many(20, "uber", "Taxi & Ride Shares"), ...many(1, "uber", "Shopping", 900)];
    const rules = deriveRulesFromHistory(history);
    expect(rules.find((r) => r.payeeContains === "uber")?.toCategory).toBe("Taxi & Ride Shares");
  });

  it("never learns a rule from generic bank wording, however pure", () => {
    // "Online Transfer" is not a merchant -- it is the bank describing the
    // mechanism. Even a 100%-pure group of them names no counterparty, so the
    // rule would match unrelated future payments.
    const history = many(40, "online transfer", "Paychecks");
    expect(deriveRulesFromHistory(history).filter((r) => r.payeeContains === "online transfer")).toEqual([]);
  });
});

describe("deriveRulesFromHistory -- generic wording on the memo path", () => {
  it("refuses a memo key that is generic bank wording, however pure the group", () => {
    // Generic wording cannot identify a counterparty, even when all prior payments shared a category.
    const history = Array.from({ length: 6 }, (_, i) => txn({
      sourceTransactionId: `p${i}`, memo: "PAYMENT", merchant: `Card ${i}`,
      sourceCategory: "Credit Card Payment",
    }));
    const rules = deriveRulesFromHistory(history);
    expect(rules.filter((r) => r.memoContains === "payment")).toEqual([]);
  });

  it("still learns a memo key that names a real counterparty", () => {
    const history = Array.from({ length: 6 }, (_, i) => txn({
      sourceTransactionId: `b${i}`, memo: "ZELLE TO CEDAR HALL", merchant: `Zelle ${i}`,
      sourceCategory: "Studio Rent",
    }));
    const rules = deriveRulesFromHistory(history);
    expect(rules.find((r) => r.memoContains?.includes("cedar"))?.toCategory).toBe("Studio Rent");
  });
});

// Lifted here from NowSection and ConnectorSection, which each had their own
// copy. The empty-key contract is the one worth pinning: every caller gates on
// it, because a blank payeeContains would match every transaction in the file.
describe("ruleKeyFor", () => {
  it("prefers the payee", () => {
    expect(ruleKeyFor(txn({ sourceTransactionId: "t1", payee: "Whole Foods", merchant: "WF Market" })))
      .toBe("whole foods");
  });

  it("falls back to the merchant when there is no payee", () => {
    expect(ruleKeyFor(txn({ sourceTransactionId: "t1", payee: null, merchant: "Costco" })))
      .toBe("costco");
  });

  it("lower-cases, because the rules table stores learned keys lower-cased", () => {
    expect(ruleKeyFor(txn({ sourceTransactionId: "t1", payee: "TRADER JOE'S" })))
      .toBe("trader joe's");
  });

  it("trims, so stray feed whitespace cannot produce a key that never matches", () => {
    expect(ruleKeyFor(txn({ sourceTransactionId: "t1", payee: "  Demo Pharmacy  " })))
      .toBe("demo pharmacy");
  });

  it("returns empty when there is nothing to key on, so callers can refuse", () => {
    expect(ruleKeyFor(txn({ sourceTransactionId: "t1", payee: null, merchant: null }))).toBe("");
    expect(ruleKeyFor(txn({ sourceTransactionId: "t1", payee: "   ", merchant: null }))).toBe("");
  });
});
