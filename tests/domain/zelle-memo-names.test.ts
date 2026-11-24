// tests/domain/zelle-memo-names.test.ts
//
// The Monarch-era
// rows named just "Zelle" are named by the person in their bank note, behind a
// setting that starts OFF ("Name old Zelle payments by the person in the note",
// Settings, Merchants) until the household has looked over the names.
//
// Every memo here is MADE UP, in the shapes the bank writes (read masked on a copy):
// "Zelle payment to <name> <reference code>", "Zelle payment from
// <name> Conf# <code>", "... for <what it was for> Conf# <code>". No real name is used.
import { describe, expect, test } from "vitest";
import {
  merchantOf,
  namesBeforeRenames,
  renameMap,
  suggestMerges,
  zelleMemoNames,
  zelleNameFromMemo,
} from "../../src/domain/merchants";
import type { NormalizedTxn } from "../../src/domain/types";

const row = (id: string, name: string | null, memo: string | null, over: Partial<NormalizedTxn> = {}) =>
  ({ sourceTransactionId: id, accountId: "a1", date: "2025-03-01", amountCents: -5000, sourceCategory: "Transfer", merchant: name, isTransfer: false, sourceUpdatedAt: null, memo, ...over }) as NormalizedTxn;

describe("the parsing rule, on made-up notes", () => {
  test.each([
    ["Zelle payment to Jane Doe JPM99abc1def", "Zelle payment to Jane Doe"],
    ["Zelle payment to JANE DOE 12345678901", "Zelle payment to JANE DOE"],
    ["Zelle payment from JOHN Q PUBLIC Conf# a1b2c3d4e", "Zelle payment from JOHN Q PUBLIC"],
    ["Zelle payment from JOHN Q PUBLIC conf# abcdefgh", "Zelle payment from JOHN Q PUBLIC"],
    ["Zelle payment to Acme Tutoring llc for Piano lessons Conf# x9y8z7w6v", "Zelle payment to Acme Tutoring llc"],
    ["Zelle payment from SAM ROE for Rent Conf# q1w2e3r4t", "Zelle payment from SAM ROE"],
    ["Zelle payment to Pat 12345678901", "Zelle payment to Pat"],
    ["  Zelle   payment  to   Jane   Doe   JPM99abc1def ", "Zelle payment to Jane Doe"],
    ["ZELLE PAYMENT TO JANE DOE JPM99ABC1DEF", "Zelle payment to JANE DOE"],
    // A short word with a digit is part of the name, not a code.
    ["Zelle payment to Room 12 Rentals Conf# a1b2c3d4e", "Zelle payment to Room 12 Rentals"],
  ])("%s", (memo, name) => {
    expect(zelleNameFromMemo(memo)).toBe(name);
  });

  test.each([[null], [""], ["Online transfer to savings"], ["Zelle payment to Conf# a1b2c3d4e"], ["Zelle payment to JPM99abc1def"], ["Zelle"], ["Payment to Jane Doe"]])(
    "no person in %s: not named, the row stays Zelle",
    (memo) => {
      expect(zelleNameFromMemo(memo)).toBeNull();
    }
  );
});

describe("behind the setting, which starts off", () => {
  const monarch = row("m1", "Zelle", "Zelle payment to Jane Doe JPM99abc1def");

  test("off: a row named just Zelle stays Zelle", () => {
    expect(merchantOf(monarch, renameMap([]))).toBe("Zelle");
    expect(merchantOf(monarch, renameMap([], { zelleByMemo: false }))).toBe("Zelle");
  });

  test("on: it reads as the person in its note", () => {
    expect(merchantOf(monarch, renameMap([], { zelleByMemo: true }))).toBe("Zelle payment to Jane Doe");
  });

  test("on: only rows named exactly Zelle change; a note it cannot read leaves the row as Zelle", () => {
    const on = renameMap([], { zelleByMemo: true });
    expect(merchantOf(row("s1", "Zelle Transfer to Jane Doe JPM99abc1def", "Zelle payment to Someone Else 12345678901"), on)).toBe("Zelle Transfer to Jane Doe");
    expect(merchantOf(row("p1", "Publix", "Zelle payment to Jane Doe 12345678901"), on)).toBe("Publix");
    expect(merchantOf(row("m2", "Zelle", "Online transfer"), on)).toBe("Zelle");
  });

  test("on: a rename made on the person's name applies to it", () => {
    const on = renameMap([{ sourceName: "Zelle payment to Jane Doe", displayName: "Jane (tutor)" }], { zelleByMemo: true });
    expect(merchantOf(monarch, on)).toBe("Jane (tutor)");
  });

  test("on: the names a rename can start from include the people; off they do not", () => {
    expect(namesBeforeRenames([monarch])).toEqual(["Zelle"]);
    expect(namesBeforeRenames([monarch], { zelleByMemo: true })).toEqual(["Zelle payment to Jane Doe"]);
  });

  test("on: the same person in both eras is offered as one merge", () => {
    const simplefin = row("s1", "Zelle Transfer to Jane Doe JPM99abc1def", null, { date: "2026-09-01" });
    const offers = suggestMerges([monarch, simplefin], renameMap([], { zelleByMemo: true }), new Set());
    expect(offers.map((o) => [o.kind, [o.from, o.into].sort()])).toEqual([["same-person", ["Zelle Transfer to Jane Doe", "Zelle payment to Jane Doe"].sort()]]);
  });
});

describe("the list for a once-over", () => {
  test("every name it would create, with how many rows, and how many notes it could not read", () => {
    const txns = [
      row("1", "Zelle", "Zelle payment to Jane Doe JPM99abc1def"),
      row("2", "Zelle", "Zelle payment to Jane Doe 12345678901"),
      row("3", "Zelle", "Zelle payment from SAM ROE Conf# q1w2e3r4t"),
      row("4", "Zelle", "Online transfer"),
      row("5", "Publix", "Zelle payment to Jane Doe 12345678901"),
    ];
    expect(zelleMemoNames(txns)).toEqual({
      rows: 4,
      unparsed: 1,
      names: [
        { name: "Zelle payment to Jane Doe", rows: 2 },
        { name: "Zelle payment from SAM ROE", rows: 1 },
      ],
    });
  });
});
