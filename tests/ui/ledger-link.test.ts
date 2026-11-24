// tests/ui/ledger-link.test.ts
//
// A ledger link carries a whole filter in the hash query. Two things matter:
// what a screen builds is exactly what Transactions reads back, and nothing a
// person can type into the address bar turns into a wrong filter or an
// off-site "Back" link.
import { describe, expect, test } from "vitest";
import { ledgerHref, parseLedgerQuery, type LedgerSpec } from "../../src/ui/lib/ledger-link";

const queryOf = (href: string) => new URLSearchParams(href.slice(href.indexOf("?") + 1));

test("an empty category remains a category filter instead of opening every category", () => {
  const href = ledgerHref({ label: "Category", back: "#/reports", categories: [""], kind: "expense" });
  expect(parseLedgerQuery(queryOf(href)).initialFilter.categories).toEqual([""]);
});

describe("ledgerHref and parseLedgerQuery round trip", () => {
  test("a category cell: one category, a side, a month, counted accounts only", () => {
    const spec: LedgerSpec = {
      label: "Groceries",
      back: "#/reports?tab=spending",
      categories: ["Groceries"],
      kind: "expense",
      from: "2026-08-01",
      to: "2026-08-31",
    };
    const href = ledgerHref(spec);
    expect(href.startsWith("#/transactions?")).toBe(true);
    expect(parseLedgerQuery(queryOf(href))).toEqual({
      initialFilter: {
        categories: ["Groceries"],
        kind: "expense",
        from: "2026-08-01",
        to: "2026-08-31",
        countedAccountsOnly: true,
      },
      ledger: { label: "Groceries", back: "#/reports?tab=spending" },
    });
  });

  test("category names with &, ?, #, = and spaces survive, and several categories stay separate", () => {
    const categories = ["Food & Dining", "What? #1", "A=B", "Kids / School"];
    const parsed = parseLedgerQuery(queryOf(ledgerHref({ label: "Other (4 categories)", back: "#/reports", categories, kind: "expense" })));
    expect(parsed.initialFilter.categories).toEqual(categories);
    expect(parsed.ledger?.label).toBe("Other (4 categories)");
  });

  test("a whole-month total has no category and no side; an account ledger turns counted-only off", () => {
    const month = parseLedgerQuery(queryOf(ledgerHref({ label: "Net, August 2026", back: "#/reports?tab=cashflow", from: "2026-08-01", to: "2026-08-31" })));
    expect(month.initialFilter).toEqual({ from: "2026-08-01", to: "2026-08-31", countedAccountsOnly: true });

    const account = parseLedgerQuery(queryOf(ledgerHref({ label: "Joint Checking", back: "#/accounts", accountId: "acc-1", countedAccountsOnly: false, transfers: "include" })));
    expect(account.initialFilter).toEqual({ accountIds: ["acc-1"], transfers: "include" });
  });
});

describe("parseLedgerQuery on input nobody built", () => {
  test("the older ?category= link still works and is not a ledger", () => {
    expect(parseLedgerQuery(new URLSearchParams("category=Groceries"))).toEqual({
      initialFilter: { categories: ["Groceries"] },
      ledger: null,
    });
  });

  test("an empty query is no filter and no ledger", () => {
    expect(parseLedgerQuery(new URLSearchParams(""))).toEqual({ initialFilter: {}, ledger: null });
  });

  test("malformed dates, an unknown side, and an unknown transfers value are dropped, not passed through", () => {
    const parsed = parseLedgerQuery(new URLSearchParams("ledger=1&label=X&from=2026-8-1&to=yesterday&kind=profit&transfers=all&counted=yes&back=%23%2Freports"));
    // Nothing survives: counted must be exactly "1", which is what ledgerHref
    // writes. Absent means off, because an account's own ledger relies on that.
    expect(parsed.initialFilter).toEqual({});
    expect(parsed.ledger).toEqual({ label: "X", back: "#/reports" });
  });

  test("an impossible calendar date is dropped even though it has the right shape", () => {
    const parsed = parseLedgerQuery(new URLSearchParams("ledger=1&label=X&from=2026-02-30&to=2026-13-01"));
    expect(parsed.initialFilter.from).toBeUndefined();
    expect(parsed.initialFilter.to).toBeUndefined();
  });

  test("Back can only ever point inside the app", () => {
    for (const hostile of ["https://evil.example/", "javascript:alert(1)", "//evil.example", "#notaroute", ""]) {
      const parsed = parseLedgerQuery(new URLSearchParams({ ledger: "1", label: "X", back: hostile }));
      expect(parsed.ledger?.back).toBe("#/reports");
    }
  });

  test("a missing label reads as a plain word rather than blank", () => {
    expect(parseLedgerQuery(new URLSearchParams("ledger=1")).ledger?.label).toBe("Transactions");
  });
});

describe("a ledger whose figure is an average", () => {
  test.each([2, 60])("accepts a divisor of %s at the allowed limits", (divideBy) => {
    const href = ledgerHref({ label: "Spending", back: "#/reports", kind: "expense", divideBy });
    expect(parseLedgerQuery(queryOf(href)).ledger?.divideBy).toBe(divideBy);
  });

  test("divideBy rides in the link and comes back as a whole number of months", () => {
    const href = ledgerHref({ label: "Groceries", back: "#/reports", categories: ["Groceries"], kind: "expense", from: "2025-09-01", to: "2026-08-31", divideBy: 12 });
    expect(queryOf(href).get("div")).toBe("12");
    expect(parseLedgerQuery(queryOf(href)).ledger).toEqual({ label: "Groceries", back: "#/reports", divideBy: 12 });
  });

  test("an ordinary ledger carries no divisor", () => {
    const href = ledgerHref({ label: "Groceries", back: "#/reports" });
    expect(queryOf(href).get("div")).toBeNull();
    expect(parseLedgerQuery(queryOf(href)).ledger?.divideBy).toBeUndefined();
  });

  test("a divisor that is not a whole number from 2 to 60 is ignored, so a typed link cannot shrink a total to nothing", () => {
    for (const bad of ["0", "1", "-12", "1.5", "abc", "61", "1e3", ""]) {
      const parsed = parseLedgerQuery(new URLSearchParams({ ledger: "1", label: "X", div: bad }));
      expect(parsed.ledger?.divideBy, bad).toBeUndefined();
    }
  });
});

describe("ledgers that are not a category total", () => {
  test("an account's own activity and a recurring series both round trip", () => {
    const account = parseLedgerQuery(queryOf(ledgerHref({ label: "Joint Checking", back: "#/accounts", accountId: "acc-1", countedAccountsOnly: false, transfers: "include", view: "account", from: "2026-08-01", to: "2026-08-31" })));
    expect(account.initialFilter).toEqual({ accountIds: ["acc-1"], transfers: "include", from: "2026-08-01", to: "2026-08-31" });
    expect(account.ledger).toEqual({ label: "Joint Checking", back: "#/accounts", view: "account" });

    const series = parseLedgerQuery(queryOf(ledgerHref({ label: "Netflix", back: "#/bills", accountId: "acc-1", payeeKey: "netflix & co", countedAccountsOnly: false, view: "series" })));
    expect(series.initialFilter).toEqual({ accountIds: ["acc-1"], payeeKey: "netflix & co" });

    // A recurring bill that changes accounts includes both account records.
    const joined = parseLedgerQuery(queryOf(ledgerHref({ label: "Office Depot", back: "#/recurring", accountIds: ["old", "new"], payeeKey: "office depot", countedAccountsOnly: false, view: "series" })));
    expect(joined.initialFilter).toEqual({ accountIds: ["old", "new"], payeeKey: "office depot" });
    expect(series.ledger).toEqual({ label: "Netflix", back: "#/bills", view: "series" });
  });

  test("an unknown view is ignored", () => {
    expect(parseLedgerQuery(new URLSearchParams({ ledger: "1", label: "X", view: "everything" })).ledger?.view).toBeUndefined();
  });
});
