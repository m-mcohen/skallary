// tests/domain/merchants.test.ts
//
// Merchants, Monarch's vendor
// feature. One clean name per merchant, worked out at read time from a rename list
// you approve; the only automatic change is leaving the Zelle reference code off
// the end of a name. Suggested merges are offered one pair at a time and nothing is
// applied without a click. Rules and recurring keep reading the bank's name.
//
// Every name below is made up. The Zelle names copy the SHAPE of real ones
// (read masked): "Zelle Payment to <first> <last> " then a 12-character
// code, "JPM", two digits, seven letters and digits.
import { describe, expect, test } from "vitest";

import {
  NO_MERCHANT_NAME,
  bankName,
  bankNamesFor,
  cleanMerchantName,
  merchantFigures,
  merchantOf,
  namesBeforeRenames,
  renameMap,
  shownName,
  suggestMerges,
  suggestionId,
  validateDismissal,
  validateRename,
} from "../../src/domain/merchants";
import { prepareTransactions } from "../../src/domain/pipeline";
import { detectRecurring } from "../../src/domain/recurring";
import { completeMonths, reportEntries } from "../../src/domain/report-view";
import type { CategorizationRule } from "../../src/domain/rules";
import type { Account, NormalizedTxn } from "../../src/domain/types";

let seq = 0;
const t = (payee: string | null, over: Partial<NormalizedTxn> = {}) =>
  ({
    sourceTransactionId: `t${++seq}`,
    accountId: "a1",
    date: "2026-08-01",
    amountCents: -1000,
    sourceCategory: "Shopping",
    merchant: null,
    isTransfer: false,
    sourceUpdatedAt: null,
    payee,
    ...over,
  }) as NormalizedTxn;
const many = (payee: string, n: number) => Array.from({ length: n }, () => t(payee));

describe("the bank's name and the automatic Zelle clean", () => {
  test("the bank's name is what the Transactions list showed: payee, else merchant, else description", () => {
    expect(bankName(t("Lemonade.com", { merchant: "Lemonade", description: "LEMONADE INS" }))).toBe("Lemonade.com");
    expect(bankName(t(null, { merchant: "Whole Foods" }))).toBe("Whole Foods");
    expect(bankName(t(null, { description: "  POS 1234 " }))).toBe("POS 1234");
    expect(bankName(t(null))).toBe("");
    expect(merchantOf(t(null), renameMap([]))).toBe(NO_MERCHANT_NAME);
  });

  test("a Zelle name loses the reference code at its end, so one person reads as one name", () => {
    expect(cleanMerchantName("Zelle Payment to Jane Doe JPM99abc1def")).toBe("Zelle Payment to Jane Doe");
    expect(cleanMerchantName("Zelle Payment to Jane Doe Jpm26x7y8z9w")).toBe("Zelle Payment to Jane Doe");
    expect(cleanMerchantName("zelle payment to Jane Doe jpm99q2rs3tu")).toBe("zelle payment to Jane Doe");
  });

  test("nothing else is cleaned: no code, a code of digits only, a short word, or a name that is not Zelle", () => {
    for (const name of [
      "Zelle Payment From John Roe",
      "Zelle Payment To Jane Doe",
      "Zelle",
      "Zelle Payment to Room 12345678",
      "Zelle Payment to Jane Doe ab12",
      "Amazon Mktp US*AB12CD34E",
      "Transfer To Checking 0000abcd99",
      "Sample Bank Credit Card Payment",
    ]) {
      expect(cleanMerchantName(name), name).toBe(name);
    }
  });
});

describe("the rename list: exact name, ignoring case, at read time", () => {
  const renames = renameMap([
    { sourceName: "AMZN Mktp US", displayName: "Amazon" },
    { sourceName: "Zelle Payment to Jane Doe", displayName: "Jane Doe" },
    { sourceName: "netflix", displayName: "Netflix" },
  ]);

  test("a bank name on the list shows its new name, whatever its capital letters", () => {
    expect(shownName("AMZN Mktp US", renames)).toBe("Amazon");
    expect(shownName("amzn mktp us", renames)).toBe("Amazon");
    expect(shownName("NETFLIX", renames)).toBe("Netflix");
  });

  test("only an exact name matches: a longer or shorter name is not renamed", () => {
    expect(shownName("AMZN Mktp US*1234", renames)).toBe("AMZN Mktp US*1234");
    expect(shownName("AMZN", renames)).toBe("AMZN");
  });

  test("a cleaned Zelle name is looked up too, so every future payment to that person follows the rename", () => {
    expect(shownName("Zelle Payment to Jane Doe JPM99abc1def", renames)).toBe("Jane Doe");
    expect(shownName("Zelle Payment to Jane Doe JPM99zzz9zzz", renames)).toBe("Jane Doe");
  });

  test("an entry that names another entry is followed, and two entries naming each other stop", () => {
    const chain = renameMap([
      { sourceName: "AMZN Mktp US", displayName: "Amazon Marketplace" },
      { sourceName: "Amazon Marketplace", displayName: "Amazon" },
    ]);
    expect(shownName("AMZN Mktp US", chain)).toBe("Amazon");
    const loop = renameMap([
      { sourceName: "A", displayName: "B" },
      { sourceName: "B", displayName: "A" },
    ]);
    expect(shownName("A", loop)).toBe("A");
    expect(shownName("B", loop)).toBe("B");
    // A case-only rename is how "AMAZON" and "Amazon" become one name.
    expect(shownName("AMAZON", renameMap([{ sourceName: "amazon", displayName: "Amazon" }]))).toBe("Amazon");
  });

  test("removing an entry undoes it: with an empty list every name is its bank name (Zelle code left off)", () => {
    expect(shownName("AMZN Mktp US", renameMap([]))).toBe("AMZN Mktp US");
    expect(shownName("Zelle Payment to Jane Doe JPM99abc1def", renameMap([]))).toBe("Zelle Payment to Jane Doe");
  });

  test("nothing in a transaction is rewritten", () => {
    const row = t("AMZN Mktp US", { merchant: "AMZN Mktp US" });
    const copy = { ...row };
    expect(merchantOf(row, renames)).toBe("Amazon");
    expect(row).toEqual(copy);
  });

  test("a rename is refused in plain words when a name is missing, and trimmed when kept", () => {
    expect(validateRename({ sourceName: "  ", displayName: "Amazon" })).toBe("Pick the bank's name to rename.");
    expect(validateRename({ sourceName: "AMZN", displayName: " " })).toBe("Type the name to show.");
    expect(validateRename(null)).toBe("Pick the bank's name to rename.");
    expect(validateRename({ sourceName: " AMZN Mktp US ", displayName: " Amazon " })).toEqual({ sourceName: "AMZN Mktp US", displayName: "Amazon" });
  });
});

describe("suggested merges: one pair at a time, nothing applied", () => {
  const txns = [
    ...many("Netflix", 3),
    ...many("NETFLIX", 1),
    ...many("Net-flix", 1),
    ...many("Amazon", 5),
    ...many("Amazon Prime", 2),
    ...many("Sample Bank", 2),
    ...many("Sample Bank Credit Card", 1),
    ...many("Sample Bank Credit Card Payment", 4),
    t("Zelle Payment to Jane Doe JPM99aaa1bcd"),
    t("Zelle Payment to Jane Doe JPM99bbb2cde"),
    ...many("Zelle Payment To Jane Doe", 3),
    ...many("Zelle Payment From Jane Doe", 1),
    ...many("Zelle", 4),
    ...many("Zelle Payment to John Roe", 1),
  ];
  const pairs = (list: ReturnType<typeof suggestMerges>) => list.map((s) => `${s.kind}: ${s.from} -> ${s.into}`);

  test("names that differ only in capital letters, spaces or punctuation fold into the one used most", () => {
    const list = suggestMerges(txns, renameMap([]), new Set());
    expect(pairs(list)).toEqual(
      expect.arrayContaining(["same-letters: NETFLIX -> Netflix", "same-letters: Net-flix -> Netflix"])
    );
    const netflix = list.find((s) => s.from === "NETFLIX")!;
    expect(netflix.fromCount).toBe(1);
    expect(netflix.intoCount).toBe(3);
  });

  test("the Zelle code family: once codes are left off, the same person written differently is offered", () => {
    const list = pairs(suggestMerges(txns, renameMap([]), new Set()));
    // The two coded payments are already one name; that name and "To" with a capital differ in one letter.
    expect(list).toContain("same-letters: Zelle Payment to Jane Doe -> Zelle Payment To Jane Doe");
    // Money from the same person is offered too, as a Zelle pair: the owner's call.
    expect(list).toContain("same-person: Zelle Payment From Jane Doe -> Zelle Payment To Jane Doe");
    // The bank writes "Zelle Transfer to" and "Zelle Transfer from": the same person either way.
    const transfers = pairs(
      suggestMerges([...many("Zelle Transfer to Jane Doe", 2), t("Zelle Transfer from Jane Doe JPM99ccc3def")], renameMap([]), new Set())
    );
    expect(transfers).toEqual(["same-person: Zelle Transfer from Jane Doe -> Zelle Transfer to Jane Doe"]);
    // A different person, and Monarch's bare "Zelle", are never offered.
    expect(list.filter((p) => /John Roe|: Zelle ->|-> Zelle$/.test(p))).toEqual([]);
  });

  test("a name that starts with another and ends in Payment folds into the closest one", () => {
    const list = pairs(suggestMerges(txns, renameMap([]), new Set()));
    expect(list).toContain("payment: Sample Bank Credit Card Payment -> Sample Bank Credit Card");
    expect(list).not.toContain("payment: Sample Bank Credit Card Payment -> Sample Bank");
    // Without "Payment", one company's products stay apart.
    expect(list.filter((p) => /Sample Bank Credit Card -> Sample Bank$/.test(p))).toEqual([]);
  });

  test("Amazon and Amazon Prime are two different things: never folded, never even offered", () => {
    const list = suggestMerges(txns, renameMap([]), new Set());
    expect(list.filter((s) => /Amazon/.test(s.from) || /Amazon/.test(s.into))).toEqual([]);
    expect(merchantOf(t("Amazon Prime"), renameMap([]))).toBe("Amazon Prime");
  });

  test("a suggestion changes nothing until it is accepted as a rename", () => {
    const empty = renameMap([]);
    suggestMerges(txns, empty, new Set());
    expect(empty.size).toBe(0);
    expect(merchantOf(t("NETFLIX"), empty)).toBe("NETFLIX");
    // Accepting writes one entry, from -> into; the pair then reads as one name and is no longer offered.
    const accepted = renameMap([{ sourceName: "NETFLIX", displayName: "Netflix" }]);
    expect(merchantOf(t("NETFLIX"), accepted)).toBe("Netflix");
    expect(pairs(suggestMerges(txns, accepted, new Set()))).not.toContain("same-letters: NETFLIX -> Netflix");
  });

  test("a dismissed suggestion stays dismissed", () => {
    const id = suggestionId("same-letters", "NETFLIX", "Netflix");
    const list = pairs(suggestMerges(txns, renameMap([]), new Set([id])));
    expect(list).not.toContain("same-letters: NETFLIX -> Netflix");
    expect(list).toContain("same-letters: Net-flix -> Netflix");
    // The id is the pair, not its direction: if the counts change and the pair turns
    // round, it is still the same dismissal. A different spelling is a different pair.
    expect(suggestionId("same-letters", "Netflix", "NETFLIX")).toBe(id);
    expect(suggestionId("same-letters", "NetFlix", "Netflix")).not.toBe(id);
  });

  test("a dismissal is refused in plain words when it is not a suggestion", () => {
    expect(validateDismissal({ kind: "nope", fromName: "A", intoName: "B" })).toBe("Unknown suggestion.");
    expect(validateDismissal({ kind: "payment", fromName: "", intoName: "B" })).toBe("Unknown suggestion.");
    expect(validateDismissal({ kind: "payment", fromName: "A Payment", intoName: "A" })).toEqual({
      id: suggestionId("payment", "A Payment", "A"),
      kind: "payment",
      fromName: "A Payment",
      intoName: "A",
    });
  });

  test("the names to pick from are the names before any rename, A to Z, Zelle codes left off", () => {
    const names = namesBeforeRenames([t("Zelle Payment to Jane Doe JPM99aaa1bcd"), t("Netflix"), t("Netflix"), t("AMZN")]);
    expect(names).toEqual(["AMZN", "Netflix", "Zelle Payment to Jane Doe"]);
  });

  test("the bank names behind a merchant are listed, so a rename can be traced", () => {
    const renames = renameMap([{ sourceName: "NETFLIX", displayName: "Netflix" }]);
    expect(bankNamesFor([t("Netflix"), t("NETFLIX"), t("Hulu")], renames, "Netflix")).toEqual(["NETFLIX", "Netflix"]);
  });
});

describe("rules and recurring keep the bank's name", () => {
  const accounts = [
    { id: "a1", name: "CARD", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  ] as Account[];
  const rule: CategorizationRule = { id: 1, priority: 100, payeeContains: "netflix.com", action: "categorize", toCategory: "Streaming" };
  const rows = [
    t("Netflix.com", { sourceCategory: null, date: "2026-06-15", amountCents: -1599 }),
    t("Netflix.com", { sourceCategory: null, date: "2026-07-15", amountCents: -1599 }),
    t("Netflix.com", { sourceCategory: null, date: "2026-08-15", amountCents: -1599 }),
  ];

  test("a rename changes no category and no recurring result, only the name shown", () => {
    const renames = renameMap([{ sourceName: "Netflix.com", displayName: "Netflix" }]);
    const prepared = prepareTransactions(rows, { rules: [rule], adjustments: [], accounts, mapping: {} });
    expect(prepared.map((r) => r.sourceCategory)).toEqual(["Streaming", "Streaming", "Streaming"]);
    const series = detectRecurring(prepared, {}, "2026-09-01");
    expect(series.map((s) => [s.key, s.cadence])).toEqual([["netflix.com", "monthly"]]);
    // The report entries carry the shown name beside the category, never in place of it.
    const entries = reportEntries(prepared, accounts, {}, "expense", (x) => merchantOf(x, renames));
    expect(entries.map((e) => [e.category, e.merchant])).toEqual([
      ["Streaming", "Netflix"],
      ["Streaming", "Netflix"],
      ["Streaming", "Netflix"],
    ]);
  });
});

describe("a merchant's page: monthly average over complete months only", () => {
  // Today Oct 2, 2026; the period runs Jul 15 to Oct 2.
  const range = { from: "2026-07-15", to: "2026-10-02" };
  const today = "2026-10-02";

  test("a month counts when it lies wholly inside the period and has ended", () => {
    // July is cut short at the start; October is not over.
    expect(completeMonths(range, today)).toEqual(["2026-08", "2026-09"]);
    // A month that ends today is not over yet.
    expect(completeMonths({ from: "2026-09-01", to: "2026-09-30" }, "2026-09-30")).toEqual([]);
    expect(completeMonths({ from: "2026-09-01", to: "2026-09-30" }, "2026-10-01")).toEqual(["2026-09"]);
  });

  test("total, purchases, refunds, by month and the average of the complete months, worked by hand", () => {
    const e = (date: string, cents: number) => ({ date, category: "Shopping", merchant: "Shop", cents });
    const spent = [
      e("2026-07-20", 4000),
      e("2026-08-03", 10000),
      e("2026-08-20", 2000),
      e("2026-08-25", -1000), // came back
      e("2026-09-10", 6000),
      e("2026-10-01", 50000),
      e("2026-07-01", 99900), // before the period: not counted
    ];
    const got = merchantFigures(spent, [e("2026-09-12", 2500)], range, today);
    // 40.00 + 100.00 + 20.00 - 10.00 + 60.00 + 500.00 = 710.00
    expect(got.spentCents).toBe(71000);
    // 40.00 + 100.00 + 20.00 + 60.00 + 500.00 = 720.00 of purchases, 10.00 back
    expect(got.purchasesCents).toBe(72000);
    expect(got.refundsCents).toBe(1000);
    expect(got.receivedCents).toBe(2500);
    expect(got.months).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(got.byMonth).toEqual({ "2026-07": 4000, "2026-08": 11000, "2026-09": 6000, "2026-10": 50000 });
    // August 110.00 + September 60.00 = 170.00, over 2 complete months = 85.00.
    // Counting October would read 223.33; counting July, 70.00.
    expect(got.completeMonths).toEqual(["2026-08", "2026-09"]);
    expect(got.averageCents).toBe(8500);
  });

  test("no complete month yet: no average, rather than one that changes every day", () => {
    const got = merchantFigures([{ date: "2026-10-01", category: "Shopping", merchant: "Shop", cents: 1000 }], [], { from: "2026-10-01", to: "2026-10-02" }, today);
    expect(got.completeMonths).toEqual([]);
    expect(got.averageCents).toBeNull();
  });
});
