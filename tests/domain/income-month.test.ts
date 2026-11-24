// tests/domain/income-month.test.ts
//
// The Dashboard Income card: the
// spending card's twin. Income from the 1st through today against the same days
// of last month, the top sources by payer, and what investments paid on a line
// of their own. Every figure goes through the same rollup as Reports, so each
// equals the ledger it opens.
import { describe, expect, test } from "vitest";
import { incomeMonthToDate } from "../../src/domain/income-month";
import { EMPTY_FILTER, filterRows, toRows } from "../../src/domain/transactions-view";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const accounts = [
  { id: "a", name: "A", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  { id: "x", name: "X", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
] as Account[];

const t = (id: string, date: string, amountCents: number, sourceCategory: string | null, over: Partial<NormalizedTxn> = {}) =>
  ({ sourceTransactionId: id, accountId: "a", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over }) as NormalizedTxn;

// A September of income: a $2,000 check on the 21st, a client payment on the 29th.
const txns = [
  t("chk", "2026-09-21", 200000, "Business Income", { merchant: "Online Deposit Check #1" }),
  t("st1", "2026-09-29", 500000, "Business Income", { payee: "Acme Consulting" }),
  t("st0", "2026-09-02", 100000, "Business Income", { payee: "ACME CONSULTING " }), // same payer, other spelling
  t("int", "2026-09-30", 7000, "Interest"), // what the money earned
  t("rent", "2026-09-05", -200000, "Rent"), // spending is not income
  t("mv", "2026-09-22", 500000, "Transfer", { isTransfer: true }), // moving money is not income
  t("x1", "2026-09-10", 999900, "Business Income", { accountId: "x" }), // not counted
  t("late", "2026-10-01", 777700, "Business Income"), // tomorrow does not count
  t("aug", "2026-08-15", 300000, "Business Income", { payee: "Acme Consulting" }),
  t("aug2", "2026-08-31", 111100, "Business Income"), // counts only when today is a month end
  t("old", "2026-07-01", 1, "Business Income"), // history reaches back past the baseline
];

describe("incomeMonthToDate: the Dashboard Income card", () => {
  test("income from the 1st through today, against the same days of last month", () => {
    const m = incomeMonthToDate(txns, accounts, {}, "2026-09-30");
    expect(m.period).toEqual({ preset: "this-month", from: "2026-09-01", to: "2026-09-30" });
    expect(m.cents).toBe(200000 + 500000 + 100000);
    // Sep 30 is a month end, so the shared rule compares with ALL of August.
    expect(m.baseline).toEqual({ range: { from: "2026-08-01", to: "2026-08-31" }, cents: 300000 + 111100 });
  });

  test("mid-month it compares with the same days of last month only", () => {
    const m = incomeMonthToDate(txns, accounts, {}, "2026-09-21");
    expect(m.cents).toBe(200000 + 100000);
    expect(m.baseline).toEqual({ range: { from: "2026-08-01", to: "2026-08-21" }, cents: 300000 });
  });

  test("what investments paid is its own figure, never part of income", () => {
    const m = incomeMonthToDate(txns, accounts, {}, "2026-09-30");
    expect(m.investmentIncomeCents).toBe(7000);
  });

  test("top sources are grouped by payer, largest first, named as the bank names them", () => {
    const m = incomeMonthToDate(txns, accounts, {}, "2026-09-30");
    expect(m.topSources).toEqual([
      { payeeKey: "acme consulting", label: "Acme Consulting", cents: 600000 },
      { payeeKey: "online deposit check #1", label: "Online Deposit Check #1", cents: 200000 },
    ]);
  });

  test("with no history reaching back to the baseline, there is nothing to compare", () => {
    const m = incomeMonthToDate(txns.filter((x) => x.date >= "2026-09-01"), accounts, {}, "2026-09-30");
    expect(m.baseline).toBeNull();
  });

  test("a month with no income yet reads zero with no sources", () => {
    const m = incomeMonthToDate([t("rent", "2026-09-05", -200000, "Rent")], accounts, {}, "2026-09-30");
    expect(m.cents).toBe(0);
    expect(m.investmentIncomeCents).toBe(0);
    expect(m.topSources).toEqual([]);
  });
});

describe("a source's ledger", () => {
  // Originally the payer filter matched money going OUT only (it was built
  // for Bills), so a link from an income source would have opened an empty list.
  test("the payer filter on an income ledger lists that payer's deposits and adds up to the source", () => {
    const rows = toRows(txns, accounts, {});
    const landed = filterRows(rows, {
      ...EMPTY_FILTER,
      kind: "income",
      payeeKey: "acme consulting",
      countedAccountsOnly: true,
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(landed.map((r) => r.txn.sourceTransactionId).sort()).toEqual(["st0", "st1"]);
    expect(landed.reduce((s, r) => s + r.txn.amountCents, 0)).toBe(600000);
  });

  test("on a spending ledger the payer filter still lists payments only", () => {
    const rows = toRows([...txns, t("refund", "2026-09-09", 500, "Rent", { payee: "Acme Consulting" }), t("pay", "2026-09-09", -800, "Rent", { payee: "Acme Consulting" })], accounts, {});
    const landed = filterRows(rows, { ...EMPTY_FILTER, payeeKey: "acme consulting" });
    expect(landed.map((r) => r.txn.sourceTransactionId)).toEqual(["pay"]);
  });
});
