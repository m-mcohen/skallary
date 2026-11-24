import { describe, it, expect } from "vitest";
import { drawableLiquidCents, defaultDrawableFor } from "../../src/domain/runway";
import type { Account } from "../../src/domain/types";
import type { AccountBalance } from "../../src/domain/plan-types";

const acct = (over: Partial<Account>): Account => ({
  id: "a", name: "Account", type: "depository", institution: null, currency: "USD",
  isOwned: true, includeInSpend: true, owner: "me", typeSource: "user", ...over,
});
const bal = (entries: [string, number][]): AccountBalance[] =>
  entries.map(([accountId, balanceCents]) => ({ accountId, balanceCents }) as AccountBalance);

describe("defaultDrawableFor -- what a new account starts as", () => {
  it("counts everyday cash and taxable brokerages", () => {
    expect(defaultDrawableFor(acct({ name: "JOINT CHECKING", type: "depository" }))).toBe(true);
    expect(defaultDrawableFor(acct({ name: "Brokerage Account", type: "brokerage" }))).toBe(true);
  });

  it("leaves retirement, loans and untyped accounts out", () => {
    // Penalty-locked, not spendable runway cash.
    expect(defaultDrawableFor(acct({ name: "Roth IRA", type: "brokerage" }))).toBe(false);
    expect(defaultDrawableFor(acct({ name: "Traditional IRA", type: "retirement" }))).toBe(false);
    expect(defaultDrawableFor(acct({ name: "Auto Loan", type: "loan" }))).toBe(false);
    expect(defaultDrawableFor(acct({ name: "Mystery", type: null }))).toBe(false);
  });

  it("counts a credit card, because its balance nets against your cash", () => {
    expect(defaultDrawableFor(acct({ name: "Cash Back Card", type: "credit" }))).toBe(true);
  });
});

describe("drawableLiquidCents honours the per-account flag", () => {
  it("counts an account the user switched ON that the default would exclude", () => {
    // Retirement accounts and the charity pot are the typical cases: whether they're
    // spendable is a judgement about the user's own money, not the app's call.
    const accounts = [
      acct({ id: "checking", type: "depository", drawable: true }),
      acct({ id: "ira", name: "Roth IRA", type: "retirement", drawable: true }),
    ];
    expect(drawableLiquidCents(accounts, bal([["checking", 500000], ["ira", 1200000]]))).toBe(1700000);
  });

  it("excludes an account the user switched OFF that the default would count", () => {
    const accounts = [
      acct({ id: "checking", type: "depository", drawable: true }),
      acct({ id: "giving", name: "Giving", type: "depository", drawable: false }),
    ];
    expect(drawableLiquidCents(accounts, bal([["checking", 500000], ["giving", 650000]]))).toBe(500000);
  });

  it("still subtracts a card that is switched on, whichever sign the feed reports", () => {
    const accounts = [
      acct({ id: "checking", type: "depository", drawable: true }),
      acct({ id: "card", name: "Rewards Card", type: "credit", drawable: true }),
    ];
    // The flag decides WHETHER a balance counts; the type still decides HOW.
    expect(drawableLiquidCents(accounts, bal([["checking", 500000], ["card", -120000]]))).toBe(380000);
    expect(drawableLiquidCents(accounts, bal([["checking", 500000], ["card", 120000]]))).toBe(380000);
  });

  it("subtracts a card even when its switch was turned off", () => {
    // A card is never money you can spend, so "drawable" is not a question it
    // can answer. Switching one off only made the picture rosier: cards switched
    // off put their debt back into cash. The flag is ignored for cards.
    const accounts = [
      acct({ id: "checking", type: "depository", drawable: true }),
      acct({ id: "card", name: "Rewards Card", type: "credit", drawable: false }),
    ];
    expect(drawableLiquidCents(accounts, bal([["checking", 500000], ["card", -135000]]))).toBe(365000);
  });

  it("falls back to the default rule when no flag has been set", () => {
    // Existing rows and freshly synced accounts have no explicit choice yet;
    // they must behave exactly as they did before the toggle existed.
    const accounts = [
      acct({ id: "checking", type: "depository", drawable: undefined }),
      acct({ id: "ira", name: "Roth IRA", type: "retirement", drawable: undefined }),
    ];
    expect(drawableLiquidCents(accounts, bal([["checking", 500000], ["ira", 1200000]]))).toBe(500000);
  });

  it("leaves an archived record out, even when a feed has put a balance on it", () => {
    // An archived account is the superseded record of a live one. Counting both
    // counts the money twice: a pull that puts fresh balances back on archived
    // rows would make the head read double.
    const accounts = [
      acct({ id: "checking", name: "Joint Checking (...0101)", type: "depository" }),
      acct({ id: "old", name: "Joint Checking (...0101) old", type: "depository", archived: true }),
    ];
    expect(drawableLiquidCents(accounts, bal([["checking", 500000], ["old", 500000]]))).toBe(500000);
  });

  it("an excluded account stays out even when switched drawable", () => {
    // includeInSpend and drawable are different questions, but "don't count
    // this account at all" has to win over "count its balance".
    const accounts = [acct({ id: "excluded", type: "depository", includeInSpend: false, drawable: true })];
    expect(drawableLiquidCents(accounts, bal([["excluded", 4500000]]))).toBe(0);
  });
});
