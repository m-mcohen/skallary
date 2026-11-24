// tests/domain/scope.test.ts
//
// The one definition of what "counts". rollupMonthly and the Transactions
// ledger filter both call it, so these four rules are the whole contract.
import { expect, test } from "vitest";
import { countedByAccount, inSpendScope } from "../../src/domain/scope";
import type { Account } from "../../src/domain/types";

const acct = (id: string, includeInSpend: boolean): Account =>
  ({
    id,
    name: id,
    type: null,
    institution: null,
    currency: "USD",
    isOwned: true,
    includeInSpend,
    owner: "me",
  }) as Account;

const counted = countedByAccount([acct("in", true), acct("out", false)]);

test("account scope is keyed by id even when two accounts share a name", () => {
  const byId = countedByAccount([
    { ...acct("in", true), name: "Checking" },
    { ...acct("out", false), name: "Checking" },
  ]);
  expect([...byId.entries()]).toEqual([["in", true], ["out", false]]);
});

test("a transfer never counts", () => {
  expect(inSpendScope("in", "transfer", counted)).toBe(false);
});

test("an account that is not counted never counts", () => {
  expect(inSpendScope("out", "expense", counted)).toBe(false);
  expect(inSpendScope("out", "income", counted)).toBe(false);
});

test("an unknown account counts, matching rollupMonthly's long-standing default", () => {
  expect(inSpendScope("ghost", "income", counted)).toBe(true);
});

test("a counted account's spending and income count", () => {
  expect(inSpendScope("in", "expense", counted)).toBe(true);
  expect(inSpendScope("in", "income", counted)).toBe(true);
});
