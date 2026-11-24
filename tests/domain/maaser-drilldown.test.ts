// tests/domain/maaser-drilldown.test.ts -- a click on a charity ledger figure lists the rows behind it.
// The list and the figure share one membership rule, maaserFiguresOf.
import { describe, expect, test } from "vitest";
import { EMPTY_FILTER, filterRows, toRows } from "../../src/domain/transactions-view";
import { maaserLedger } from "../../src/domain/maaser-pot";
import type { MaaserMark } from "../../src/domain/maaser-marks";
import { ledgerHref, parseLedgerQuery } from "../../src/ui/lib/ledger-link";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const CHK: Account = { id: "chk", name: "Checking", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" };
const POT: Account = { ...CHK, id: "pot", name: "Giving", includeInSpend: false, maaserPot: true };
const OTHER: Account = { ...CHK, id: "other", name: "Partner Checking", owner: "partner" };
const accounts = [CHK, POT, OTHER];
let n = 0;
const row = (accountId: string, date: string, amountCents: number, sourceCategory: string | null, over: Partial<NormalizedTxn> = {}): NormalizedTxn => ({
  sourceTransactionId: `d${++n}`, accountId, date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over,
});

const prepared = [
  row("pot", "2026-10-02", 150000, "Maaser"),
  row("chk", "2026-09-21", 200000, "Other Income"),
  row("chk", "2026-10-08", -50000, "Charity"),
  row("other", "2026-10-08", -3000, "Charity"),
  row("pot", "2026-10-15", -4000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" }),
  row("pot", "2026-10-15", 50000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" }),
  row("pot", "2026-10-18", -50000, null, { description: "ZELLE PAYMENT TO A CHARITY" }),
  row("chk", "2026-10-12", -3000, "Groceries"),
];
const marked = (r: NormalizedTxn): MaaserMark => ({ sourceTransactionId: r.sourceTransactionId, kind: "not_maaser", countedCents: null, updatedAt: "" });

describe("a figure's rows add up to the figure", () => {
  const rows = toRows(prepared, accounts, {});
  const only = (...maaser: ("income" | "setAside" | "givenCards" | "givenPot" | "reimbursed")[]) =>
    filterRows(rows, { ...EMPTY_FILTER, transfers: "include", maaser });
  const ledger = maaserLedger({ prepared, accounts, mapping: {}, marks: [], maaserRate: 0.1, from: "2026-01-01", to: "2026-12-31", availableCents: 0 });

  test("each figure lists exactly its rows, and their amounts sum to it", () => {
    expect(only("givenCards").reduce((s, r) => s - r.txn.amountCents, 0)).toBe(ledger.givenFromCardsCents);
    expect(only("givenPot").reduce((s, r) => s - r.txn.amountCents, 0)).toBe(ledger.givenFromPotCents);
    expect(only("reimbursed").reduce((s, r) => s - r.txn.amountCents, 0)).toBe(ledger.reimbursedCents);
    expect(only("setAside").reduce((s, r) => s + r.txn.amountCents, 0)).toBe(ledger.setAsideCents);
    expect(only("income").reduce((s, r) => s + r.txn.amountCents, 0)).toBe(ledger.countedIncomeCents);
  });
  test("two figures together list each row once: the pot owes you reads the cards' gifts and the paybacks", () => {
    const both = only("givenCards", "reimbursed");
    expect(both).toHaveLength(2);
    expect(new Set(both.map((r) => r.txn.sourceTransactionId)).size).toBe(2);
  });
  test("a gift marked not for the pot, and another owner's gift, are in no figure", () => {
    const gift = prepared[2];
    const withMark = toRows(prepared, accounts, {}, new Map(), new Map(), new Map([[gift.sourceTransactionId, marked(gift)]]));
    expect(filterRows(withMark, { ...EMPTY_FILTER, maaser: ["givenCards"] })).toHaveLength(0);
  });
  test("no figure chosen: no limit", () => {
    expect(filterRows(rows, { ...EMPTY_FILTER, transfers: "include" })).toHaveLength(prepared.length);
  });
});

describe("the link carries the figures and the window", () => {
  test("round trip, with unknown figure names dropped", () => {
    const href = ledgerHref({ label: "Given, from your cards and checking", back: "#/budget/month", maaser: ["givenCards", "reimbursed"], from: "2026-01-01", to: "2026-10-20", transfers: "include", countedAccountsOnly: false, view: "maaser" });
    const parsed = parseLedgerQuery(new URLSearchParams(href.split("?")[1] + "&maaser=bogus"));
    expect(parsed.initialFilter.maaser).toEqual(["givenCards", "reimbursed"]);
    expect(parsed.initialFilter.from).toBe("2026-01-01");
    expect(parsed.initialFilter.transfers).toBe("include");
    expect(parsed.initialFilter.countedAccountsOnly).toBeUndefined();
    expect(parsed.ledger?.view).toBe("maaser");
  });
});

describe("review fixes", () => {
  test("a gift paid from the pot lists under Charity and counts, so the ordinary Charity links find it", () => {
    const potGift = row("pot", "2026-10-20", -10000, null, { description: "ATM WITHDRAWAL" });
    const rows = toRows([potGift, row("chk", "2026-10-21", -5000, "Groceries")], accounts, {});
    expect(rows[0].planningCategory).toBe("Charity");
    expect(rows[0].kind).toBe("expense");
    expect(rows[0].counted).toBe(true);
    const found = filterRows(rows, { ...EMPTY_FILTER, categories: ["Charity"], kind: "expense", countedAccountsOnly: true });
    expect(found.map((r) => r.txn.sourceTransactionId)).toEqual([potGift.sourceTransactionId]);
  });
  test("a payback and a set-aside keep their own kind and are not relabelled as Charity", () => {
    const payback = row("pot", "2026-10-15", -4000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" });
    const [r] = toRows([payback], accounts, {});
    expect(r.planningCategory).not.toBe("Charity");
  });
  test("a row stamped with a time on the window's last day is in the list, as it is in the figure", () => {
    const stamped = row("chk", "2026-10-20T12:00:00Z", -10000, "Charity");
    const rows = toRows([stamped], accounts, {});
    expect(filterRows(rows, { ...EMPTY_FILTER, maaser: ["givenCards"], to: "2026-10-20" })).toHaveLength(1);
    expect(filterRows(rows, { ...EMPTY_FILTER, from: "2026-10-20", to: "2026-10-20" })).toHaveLength(1);
  });
});
