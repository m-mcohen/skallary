// tests/domain/merchant-ledger.test.ts
//
// A merchant's figure on Reports opens the rows behind it.
// The Transactions rows carry the shown merchant name; a ledger can be narrowed to
// some merchants, or to every merchant except some (Reports' Other line); and the
// link carries both, so a bookmark opens the same list.
import { describe, expect, test } from "vitest";

import { EMPTY_FILTER, filterRows, ledgerTotal, toRows } from "../../src/domain/transactions-view";
import { renameMap } from "../../src/domain/merchants";
import { ledgerHref, parseLedgerQuery } from "../../src/ui/lib/ledger-link";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const accounts = [
  { id: "a1", name: "CARD", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
] as Account[];
const t = (id: string, payee: string, amountCents: number) =>
  ({ sourceTransactionId: id, accountId: "a1", date: "2026-08-10", amountCents, sourceCategory: "Shopping", merchant: null, isTransfer: false, sourceUpdatedAt: null, payee }) as NormalizedTxn;

const txns = [
  t("1", "AMZN Mktp US", -2500),
  t("2", "Amazon", -1000),
  t("3", "Amazon Prime", -1499),
  t("4", "Zelle Payment to Jane Doe JPM99aaa1bcd", -5000),
  t("5", "Zelle Payment to Jane Doe JPM99bbb2cde", -7000),
];
const renames = renameMap([{ sourceName: "AMZN Mktp US", displayName: "Amazon" }]);
const rows = toRows(txns, accounts, {}, renames);

describe("rows carry the shown merchant name", () => {
  test("renamed, Zelle code left off, or the bank's name", () => {
    expect(rows.map((r) => r.merchant)).toEqual(["Amazon", "Amazon", "Amazon Prime", "Zelle Payment to Jane Doe", "Zelle Payment to Jane Doe"]);
    // With no list, the bank's own names (and the Zelle clean) show.
    expect(toRows(txns, accounts, {}).map((r) => r.merchant)[0]).toBe("AMZN Mktp US");
  });

  test("a merchant ledger lists its rows and adds up to its figure", () => {
    const amazon = filterRows(rows, { ...EMPTY_FILTER, merchants: ["Amazon"] });
    expect(amazon.map((r) => r.txn.sourceTransactionId).sort()).toEqual(["1", "2"]);
    // 25.00 + 10.00 = 35.00 spent; Amazon Prime is its own merchant.
    expect(ledgerTotal(amazon).expenseCents).toBe(3500);
    const jane = filterRows(rows, { ...EMPTY_FILTER, merchants: ["Zelle Payment to Jane Doe"] });
    // 50.00 + 70.00 = 120.00
    expect(ledgerTotal(jane).expenseCents).toBe(12000);
  });

  test("every merchant except some: what Reports' Other line holds", () => {
    const other = filterRows(rows, { ...EMPTY_FILTER, exceptMerchants: ["Amazon", "Zelle Payment to Jane Doe"] });
    expect(other.map((r) => r.merchant)).toEqual(["Amazon Prime"]);
  });

  test("search finds a row by its shown name too", () => {
    const found = filterRows(rows, { ...EMPTY_FILTER, search: "amazon" });
    expect(found.map((r) => r.txn.sourceTransactionId).sort()).toEqual(["1", "2", "3"]);
  });
});

describe("the ledger link carries the merchants", () => {
  test("one merchant, and every merchant except some, survive the round trip", () => {
    const href = ledgerHref({ label: "Amazon", back: "#/reports?tab=spending&group=merchant", kind: "expense", merchants: ["Amazon"], flow: "out" });
    const parsed = parseLedgerQuery(new URLSearchParams(href.slice(href.indexOf("?") + 1)));
    expect(parsed.initialFilter.merchants).toEqual(["Amazon"]);
    expect(parsed.ledger?.back).toBe("#/reports?tab=spending&group=merchant");
    const other = ledgerHref({ label: "Other (3 merchants)", back: "#/reports", kind: "expense", exceptMerchants: ["Amazon", "Zelle Payment to Jane Doe"] });
    const parsedOther = parseLedgerQuery(new URLSearchParams(other.slice(other.indexOf("?") + 1)));
    expect(parsedOther.initialFilter.exceptMerchants).toEqual(["Amazon", "Zelle Payment to Jane Doe"]);
    expect(parsedOther.initialFilter.merchants).toBeUndefined();
  });
});
