// tests/domain/recurring-ledger.test.ts
//
// A Bills series opens a ledger of the payments in it. A series' figure is a
// TYPICAL amount (a median), not a sum, so there is no dollar total to tie to.
// What must agree is membership: the ledger lists exactly the payments the
// detector counted, no more and no fewer, and their median is the typical amount.
import { describe, expect, test } from "vitest";
import { detectRecurring, usualAmount } from "../../src/domain/recurring";
import { EMPTY_FILTER, filterRows, toRows } from "../../src/domain/transactions-view";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const accounts = [
  { id: "checking", name: "Checking", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  { id: "card", name: "Card", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
  // The checking account also has an older record.
  { id: "old-checking", name: "Checking (old record)", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me", archived: true },
] as Account[];

const t = (id: string, date: string, amountCents: number, payee: string, over: Partial<NormalizedTxn> = {}) =>
  ({ sourceTransactionId: id, accountId: "checking", date, amountCents, sourceCategory: "Subscriptions", merchant: null, isTransfer: false, sourceUpdatedAt: null, payee, ...over }) as NormalizedTxn;

const monthly = (prefix: string, payee: string, cents: number[], over: Partial<NormalizedTxn> = {}) =>
  cents.map((c, i) => t(`${prefix}${i}`, `2026-0${i + 3}-05`, c, payee, over));

const txns: NormalizedTxn[] = [
  ...monthly("n", "Netflix", [-2000, -2000, -2000, -2400, -2400, -2400]),
  // The same payee on ANOTHER account is another series, and that account is not counted.
  ...monthly("c", "Netflix", [-1200, -1200, -1200, -1200], { accountId: "card" }),
  // A refund from the same payee is money in: never part of a bill.
  t("refund", "2026-05-20", 2000, "Netflix"),
  // A transfer to the same payee key is not a payment either.
  t("xfer", "2026-06-20", -2000, "Netflix", { isTransfer: true }),
  ...monthly("g", "City Gym", [-4500, -4500, -4500, -4500, -4500]),
  // A look-alike payee in the same account: a loose match on the key would mix the two.
  ...monthly("w", "Netflix Studio", [-2000, -2000, -2000, -2000]),
  t("one-off", "2026-04-11", -25000, "Hardware Store"),
  // One bill across an account move: two payments on the old record, two on the new one.
  t("l0", "2026-03-09", -4000, "Demo Cover", { accountId: "old-checking" }),
  t("l1", "2026-04-09", -4000, "Demo Cover", { accountId: "old-checking" }),
  t("l2", "2026-05-09", -4000, "Demo Cover"),
  t("l3", "2026-06-09", -4000, "Demo Cover"),
];

const rows = toRows(txns, accounts, {});
// The ledger uses the last three payments in date order.
const usualOf = (ledger: { txn: NormalizedTxn }[]) =>
  usualAmount([...ledger].sort((a, b) => a.txn.date.localeCompare(b.txn.date)).map((r) => r.txn.amountCents));

describe("a series ledger lists exactly the payments the detector counted", () => {
  const series = detectRecurring(txns, {});

  test("the fixture really yields the series it is meant to", () => {
    expect(series.map((s) => `${s.accountId}|${s.label}`).sort()).toEqual(["card|Netflix", "checking|City Gym", "checking|Demo Cover", "checking|Netflix", "checking|Netflix Studio"]);
  });

  test("same count, same typical amount, for every series", () => {
    for (const s of series) {
      const ledger = filterRows(rows, { ...EMPTY_FILTER, accountIds: s.accountIds, payeeKey: s.key });
      expect(ledger.length, s.label).toBe(s.occurrenceCount);
      expect(usualOf(ledger), s.label).toBe(s.typicalAmountCents);
      expect(ledger.every((r) => r.txn.amountCents < 0 && r.kind !== "transfer"), s.label).toBe(true);
    }
  });

  test("the refund and the transfer are left out, and the other account's payments are not mixed in", () => {
    const netflix = series.find((s) => s.accountId === "checking" && s.label === "Netflix")!;
    const ids = filterRows(rows, { ...EMPTY_FILTER, accountIds: ["checking"], payeeKey: netflix.key }).map((r) => r.txn.sourceTransactionId).sort();
    expect(ids).toEqual(["n0", "n1", "n2", "n3", "n4", "n5"]);
    // Even when the screen is asked to show transfers, a transfer is not a payment in a series.
    const withTransfers = filterRows(rows, { ...EMPTY_FILTER, transfers: "include", accountIds: ["checking"], payeeKey: netflix.key });
    expect(withTransfers.map((r) => r.txn.sourceTransactionId).sort()).toEqual(ids);
  });

  test("an account that is not counted still lists its series: a bill is a bill whoever pays it", () => {
    const card = series.find((s) => s.accountId === "card")!;
    expect(filterRows(rows, { ...EMPTY_FILTER, accountIds: ["card"], payeeKey: card.key })).toHaveLength(4);
  });

  test("a bill joined across an account move lists the payments from both records", () => {
    const lemonade = series.find((s) => s.label === "Demo Cover")!;
    expect(lemonade.accountIds).toEqual(["old-checking", "checking"]);
    const ids = filterRows(rows, { ...EMPTY_FILTER, accountIds: lemonade.accountIds, payeeKey: lemonade.key }).map((r) => r.txn.sourceTransactionId).sort();
    expect(ids).toEqual(["l0", "l1", "l2", "l3"]);
  });

  test("with no payee key the filter behaves exactly as before", () => {
    expect(EMPTY_FILTER.payeeKey).toBeNull();
    expect(filterRows(rows, EMPTY_FILTER)).toHaveLength(txns.length - 1); // everything but the transfer
  });
});
