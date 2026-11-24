// tests/domain/transactions-view.test.ts
//
// The filter engine behind the Transactions screen. Pure, so the whole of what
// the screen does to thousands of rows is testable without a DOM.
//
// The invariant that matters most is the first one: the category shown here is
// the category the BUDGET uses, because both go through classify(). A second
// categorisation path would let the list and the budget disagree, which is the
// one thing a finance app must never do.
import { describe, expect, test } from "vitest";
import {
  EMPTY_FILTER,
  filterRows,
  ledgerTotal,
  summarise,
  toRows,
  withRunningTotal,
  type TxnFilter,
} from "../../src/domain/transactions-view";
import { classify } from "../../src/domain/dedup";
import { ledgerHref, parseLedgerQuery } from "../../src/ui/lib/ledger-link";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const acct = (id: string, name: string): Account =>
  ({
    id,
    name,
    type: "depository",
    institution: null,
    currency: "USD",
    isOwned: true,
    includeInSpend: true,
    owner: "me",
  }) as Account;

const accounts = [acct("a1", "JOINT CHECKING (0101)"), acct("a2", "Rewards Card (0303)")];

const txn = (over: Partial<NormalizedTxn>): NormalizedTxn =>
  ({
    sourceTransactionId: "t1",
    accountId: "a1",
    date: "2026-08-15",
    amountCents: -5000,
    sourceCategory: "Groceries",
    merchant: null,
    isTransfer: false,
    sourceUpdatedAt: null,
    ...over,
  }) as NormalizedTxn;

const mapping = { "Whole Foods": "Groceries" };

test("a ledger with two category prefixes includes only the exact categories", () => {
  const href = ledgerHref({ label: "Food", back: "#/reports", categories: ["Food", "Food Delivery"], kind: "expense" });
  const parsed = parseLedgerQuery(new URLSearchParams(href.split("?")[1]));
  const input = toRows([
    txn({ sourceTransactionId: "a", sourceCategory: "Food", amountCents: -100 }),
    txn({ sourceTransactionId: "b", sourceCategory: "Food Delivery", amountCents: -200 }),
    txn({ sourceTransactionId: "c", sourceCategory: "Food Delivery Tips", amountCents: -900 }),
  ], accounts, {});
  const listed = filterRows(input, { ...EMPTY_FILTER, ...parsed.initialFilter });
  expect(listed.map((row) => row.txn.sourceTransactionId)).toEqual(["b", "a"]);
  expect(ledgerTotal(listed).expenseCents).toBe(300);
});

describe("toRows", () => {
  test("carries each row's maaser role and mark", () => {
    const pot: Account = { ...accounts[0], id: "pot", name: "GIVING", maaserPot: true };
    const gift = txn({ sourceTransactionId: "g", sourceCategory: "Charity" });
    const income = txn({ sourceTransactionId: "i", amountCents: 200000, sourceCategory: "Other Income" });
    const marks = new Map([["i", { sourceTransactionId: "i", kind: "income" as const, countedCents: 160000, updatedAt: "" }]]);
    const rows = toRows([gift, income, txn({ sourceTransactionId: "r", sourceCategory: "Groceries" })], [...accounts, pot], {}, new Map(), new Map(), marks);
    expect(rows.map((r) => [r.maaserRole, r.maaserMark?.countedCents ?? null])).toEqual([["gift", null], ["income", 160000], [null, null]]);
  });
  test("resolves the same category the budget uses", () => {
    const t = txn({ sourceCategory: "Whole Foods" });
    const [row] = toRows([t], accounts, mapping);
    expect(row.planningCategory).toBe(classify(t, mapping).planningCategory);
    expect(row.planningCategory).toBe("Groceries");
  });

  test("resolves the account name", () => {
    const [row] = toRows([txn({ accountId: "a2" })], accounts, mapping);
    expect(row.accountName).toBe("Rewards Card (0303)");
  });

  test("names the account by its short name", () => {
    const caps = [{ ...accounts[0], id: "caps", name: "PERSONAL CHECKING (0404)" }];
    const [row] = toRows([txn({ accountId: "caps" })], caps, mapping);
    expect(row.accountName).toBe("Personal Checking (0404)");
  });

  test("names an unknown account rather than rendering blank", () => {
    const [row] = toRows([txn({ accountId: "gone" })], accounts, mapping);
    expect(row.accountName).toBe("Unknown account");
  });

  test("marks a row with no source category as needing one", () => {
    const [row] = toRows([txn({ sourceCategory: null })], accounts, mapping);
    expect(row.needsCategory).toBe(true);
    expect(row.planningCategory).toBe("Uncategorized");
  });

  // A move to or from a savings destination is already filed by the app, as the
  // review queue in Settings says (connectorService.getUncategorized), so it
  // must not read "Investing" on Needs a category.
  test("a move filed as saving, a wash, or a transfer does not need a category", () => {
    const filed = toRows(
      [
        txn({ sourceTransactionId: "s", sourceCategory: null, savingBucket: "Investing" }),
        txn({ sourceTransactionId: "w", sourceCategory: null, isWash: true }),
        txn({ sourceTransactionId: "x", sourceCategory: null, isTransfer: true }),
      ],
      accounts,
      mapping
    );
    expect(filed.map((r) => [r.planningCategory, r.needsCategory])).toEqual([
      ["Investing", false],
      ["Uncategorized", false],
      ["Uncategorized", false],
    ]);
  });

  test("carries the transfer kind through", () => {
    const [row] = toRows([txn({ isTransfer: true })], accounts, mapping);
    expect(row.kind).toBe("transfer");
  });
});

const rows = () =>
  toRows(
    [
      txn({ sourceTransactionId: "a", date: "2026-08-01", amountCents: -1200, payee: "Whole Foods", sourceCategory: "Groceries" }),
      txn({ sourceTransactionId: "b", date: "2026-08-15", amountCents: -25000, payee: "Rent Co", sourceCategory: "Rent" }),
      txn({ sourceTransactionId: "c", date: "2026-09-02", amountCents: 800000, payee: "Payroll", sourceCategory: "Paychecks" }),
      txn({ sourceTransactionId: "d", date: "2026-09-03", amountCents: -4000, payee: "Mystery", sourceCategory: null }),
      txn({ sourceTransactionId: "e", date: "2026-09-04", amountCents: -900, payee: "Ridgeline", isTransfer: true, accountId: "a2" }),
    ],
    accounts,
    mapping
  );

const ids = (f: Partial<TxnFilter>) =>
  filterRows(rows(), { ...EMPTY_FILTER, ...f }).map((r) => r.txn.sourceTransactionId);

describe("filterRows", () => {
  test("hides transfers by default -- they are not spending", () => {
    // Money into investment accounts is a transfer.
    expect(ids({})).not.toContain("e");
  });

  test("shows transfers when asked", () => {
    expect(ids({ transfers: "include" })).toContain("e");
  });

  test("can show transfers alone, for auditing what the matcher claimed", () => {
    expect(ids({ transfers: "only" })).toEqual(["e"]);
  });

  test("searches payee case-insensitively", () => {
    expect(ids({ search: "whole" })).toEqual(["a"]);
  });

  test("searches the category too", () => {
    expect(ids({ search: "rent" })).toEqual(["b"]);
  });

  test("filters by account", () => {
    expect(ids({ accountIds: ["a2"], transfers: "include" })).toEqual(["e"]);
  });

  test("filters by planning category", () => {
    expect(ids({ categories: ["Groceries"] })).toEqual(["a"]);
  });

  test("filters by date range, inclusive at both ends", () => {
    expect(ids({ from: "2026-08-15", to: "2026-09-02" })).toEqual(["c", "b"]);
  });

  test("filters on the absolute amount, so a range means size not sign", () => {
    // Without abs, "at least $100" would exclude a $250 expense for being
    // negative -- the opposite of what someone hunting big charges wants.
    expect(ids({ minCents: 10000 }).sort()).toEqual(["b", "c"]);
  });

  test("filters by maximum amount", () => {
    expect(ids({ maxCents: 5000 }).sort()).toEqual(["a", "d"]);
  });

  test("isolates the rows that need a category", () => {
    expect(ids({ needsCategory: true })).toEqual(["d"]);
  });

  test("combines filters conjunctively", () => {
    expect(ids({ from: "2026-09-01", maxCents: 5000 })).toEqual(["d"]);
  });

  test("an empty filter returns everything except transfers", () => {
    expect(ids({}).sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("returns newest first", () => {
    expect(ids({ transfers: "include" })[0]).toBe("e");
  });
});

describe("summarise", () => {
  test("splits money in from money out and nets them", () => {
    const s = summarise(filterRows(rows(), EMPTY_FILTER));
    expect(s.count).toBe(4);
    expect(s.inCents).toBe(800000);
    expect(s.outCents).toBe(1200 + 25000 + 4000);
    expect(s.netCents).toBe(800000 - (1200 + 25000 + 4000));
  });

  test("is zero for an empty set rather than NaN", () => {
    expect(summarise([])).toEqual({ count: 0, inCents: 0, outCents: 0, netCents: 0 });
  });
});

describe("ledger scope: the two fields only a click-through link turns on", () => {
  const notCounted = { ...acct("a3", "SECOND CHECKING (0505)"), includeInSpend: false } as Account;
  const scopedRows = () =>
    toRows(
      [
        txn({ sourceTransactionId: "g1", date: "2026-08-02", amountCents: -10000, sourceCategory: "Groceries" }),
        txn({ sourceTransactionId: "g2", date: "2026-08-20", amountCents: 2500, sourceCategory: "Groceries" }), // refund
        txn({ sourceTransactionId: "g3", date: "2026-08-21", amountCents: -7000, sourceCategory: "Groceries", accountId: "a3" }),
        txn({ sourceTransactionId: "p1", date: "2026-08-25", amountCents: 500000, sourceCategory: "Paychecks" }),
        txn({ sourceTransactionId: "x1", date: "2026-08-26", amountCents: -3000, isTransfer: true }),
      ],
      [...accounts, notCounted],
      mapping
    );
  const scopedIds = (f: Partial<TxnFilter>) =>
    filterRows(scopedRows(), { ...EMPTY_FILTER, ...f }).map((r) => r.txn.sourceTransactionId).sort();

  test("the empty filter behaves as before: both kinds, and accounts that are not counted still listed", () => {
    expect(EMPTY_FILTER.kind).toBeNull();
    expect(EMPTY_FILTER.countedAccountsOnly).toBe(false);
    expect(scopedIds({})).toEqual(["g1", "g2", "g3", "p1"]);
  });

  test("kind keeps one side only; a refund stays with its spending category", () => {
    expect(scopedIds({ kind: "expense" })).toEqual(["g1", "g2", "g3"]);
    expect(scopedIds({ kind: "income" })).toEqual(["p1"]);
  });

  test("countedAccountsOnly drops rows from an account that is not counted", () => {
    expect(scopedIds({ countedAccountsOnly: true })).toEqual(["g1", "g2", "p1"]);
  });

  test("toRows marks each row counted or not; an unknown account counts", () => {
    const byId = new Map(scopedRows().map((r) => [r.txn.sourceTransactionId, r.counted]));
    expect(byId.get("g1")).toBe(true);
    expect(byId.get("g3")).toBe(false);
    const [ghost] = toRows([txn({ accountId: "gone" })], accounts, mapping);
    expect(ghost.counted).toBe(true);
  });
});

describe("ledgerTotal", () => {
  test("nets a refund against spending, the way the rollup does, not by sign", () => {
    const groceries = filterRows(
      toRows(
        [
          txn({ sourceTransactionId: "g1", amountCents: -10000, sourceCategory: "Groceries" }),
          txn({ sourceTransactionId: "g2", amountCents: 2500, sourceCategory: "Groceries" }),
        ],
        accounts,
        mapping
      ),
      EMPTY_FILTER
    );
    expect(ledgerTotal(groceries)).toEqual({ incomeCents: 0, expenseCents: 7500, savingCents: 0, investmentIncomeCents: 0, netCents: -7500 });
    // summarise answers a different question (money in vs money out by sign).
    expect(summarise(groceries).outCents).toBe(10000);
  });

  test("ignores transfers and is zero for an empty set", () => {
    const withTransfer = filterRows(rows(), { ...EMPTY_FILTER, transfers: "include" });
    expect(ledgerTotal(withTransfer)).toEqual({ incomeCents: 800000, expenseCents: 1200 + 25000 + 4000, savingCents: 0, investmentIncomeCents: 0, netCents: 800000 - 30200 });
    expect(ledgerTotal([])).toEqual({ incomeCents: 0, expenseCents: 0, savingCents: 0, investmentIncomeCents: 0, netCents: 0 });
  });
});

describe("withRunningTotal", () => {
  test("orders oldest first, breaks date ties by id, and accumulates signed cents", () => {
    const ledger = withRunningTotal(
      toRows(
        [
          txn({ sourceTransactionId: "z", date: "2026-08-10", amountCents: -300 }),
          txn({ sourceTransactionId: "b", date: "2026-08-01", amountCents: -100 }),
          txn({ sourceTransactionId: "a", date: "2026-08-01", amountCents: 50 }),
        ],
        accounts,
        mapping
      )
    );
    expect(ledger.map((r) => r.txn.sourceTransactionId)).toEqual(["a", "b", "z"]);
    expect(ledger.map((r) => r.runningCents)).toEqual([50, -50, -350]);
  });

  test("a spending ledger counts up in spending terms, so it ends on the header figure", () => {
    const groceries = toRows(
      [
        txn({ sourceTransactionId: "g1", date: "2026-08-02", amountCents: -10000 }),
        txn({ sourceTransactionId: "g2", date: "2026-08-20", amountCents: 2500 }), // refund
      ],
      accounts,
      mapping
    );
    expect(withRunningTotal(groceries, "expense").map((r) => r.runningCents)).toEqual([10000, 7500]);
    expect(withRunningTotal(groceries, "expense").at(-1)?.runningCents).toBe(ledgerTotal(groceries).expenseCents);
    // Income and two-sided ledgers stay signed: money in is positive.
    expect(withRunningTotal(groceries, "income").map((r) => r.runningCents)).toEqual([-10000, -7500]);
    expect(withRunningTotal(groceries).map((r) => r.runningCents)).toEqual([-10000, -7500]);
  });

  test("does not mutate its input", () => {
    const input = filterRows(rows(), EMPTY_FILTER);
    const before = input.map((r) => r.txn.sourceTransactionId);
    withRunningTotal(input);
    expect(input.map((r) => r.txn.sourceTransactionId)).toEqual(before);
  });
});

// Reports shows refunds on their own line, so a category's
// figure is its purchases and the refunds line is what came back. Each opens a
// ledger that must add up to it: money out only, or money in only.
describe("a ledger of one direction", () => {
  const a = [{ id: "a1", name: "JOINT", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }] as Account[];
  const r = (id: string, amountCents: number, sourceCategory: string) =>
    ({ sourceTransactionId: id, accountId: "a1", date: "2026-08-10", amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null }) as NormalizedTxn;
  const list = toRows([r("buy", -102000, "Groceries"), r("back", 2500, "Groceries"), r("pay", 900000, "Paychecks")], a, {});

  test("both directions by default", () => {
    expect(EMPTY_FILTER.flow).toBeNull();
    // $1,020.00 spent less $25.00 back = $995.00, as always
    expect(ledgerTotal(filterRows(list, { ...EMPTY_FILTER, kind: "expense" })).expenseCents).toBe(99500);
  });

  test("money out only: the purchases, $1,020.00", () => {
    const out = filterRows(list, { ...EMPTY_FILTER, kind: "expense", flow: "out" });
    expect(out.map((x) => x.txn.sourceTransactionId)).toEqual(["buy"]);
    expect(ledgerTotal(out).expenseCents).toBe(102000);
  });

  test("money in only: what came back, -$25.00 of spending", () => {
    const back = filterRows(list, { ...EMPTY_FILTER, kind: "expense", flow: "in" });
    expect(back.map((x) => x.txn.sourceTransactionId)).toEqual(["back"]);
    expect(ledgerTotal(back).expenseCents).toBe(-2500);
  });

  test("the link carries it, and junk is ignored", () => {
    const href = ledgerHref({ label: "Refunds and credits", back: "#/reports", kind: "expense", flow: "in" });
    expect(parseLedgerQuery(new URLSearchParams(href.split("?")[1])).initialFilter.flow).toBe("in");
    const out = ledgerHref({ label: "Groceries", back: "#/reports", kind: "expense", flow: "out" });
    expect(parseLedgerQuery(new URLSearchParams(out.split("?")[1])).initialFilter.flow).toBe("out");
    expect(parseLedgerQuery(new URLSearchParams("ledger=1&flow=sideways")).initialFilter.flow).toBeUndefined();
    expect(ledgerHref({ label: "Groceries", back: "#/reports", kind: "expense" })).not.toContain("flow=");
  });
});

describe("notes on transactions", () => {
  test("each row carries its note, and search finds a row by the words in it", () => {
    const rows = toRows(
      [txn({ sourceTransactionId: "t1", merchant: "Venmo", payee: "Venmo" }), txn({ sourceTransactionId: "t2", merchant: "Venmo", payee: "Venmo" })],
      accounts,
      {},
      new Map(),
      new Map([["t1", "Split dinner with Sam"]])
    );
    expect(rows.map((r) => r.note)).toEqual(["Split dinner with Sam", null]);
    expect(filterRows(rows, { ...EMPTY_FILTER, search: "sam" }).map((r) => r.txn.sourceTransactionId)).toEqual(["t1"]);
    expect(filterRows(rows, { ...EMPTY_FILTER, search: "bowling" })).toHaveLength(0);
  });
});
