import { describe, it, expect } from "vitest";
import { guessAccountType, accountsNeedingType, drawableLiquidCents } from "../../src/domain/runway";
import type { Account } from "../../src/domain/types";
import type { AccountBalance } from "../../src/domain/plan-types";

const acct = (over: Partial<Account>): Account => ({
  id: "a", name: "Account", type: null, institution: null, currency: "USD",
  isOwned: true, includeInSpend: true, owner: "me", typeSource: "feed", ...over,
});

describe("guessAccountType", () => {
  it("reads the obvious types out of the account name", () => {
    // SimpleFIN sends no type at all, so the name is the only starting signal.
    // This is a first guess for the user to correct, never an answer.
    expect(guessAccountType("Everyday Banking - Checking")).toBe("depository");
    expect(guessAccountType("Online Savings")).toBe("depository");
    expect(guessAccountType("Rewards Credit Card")).toBe("credit");
    expect(guessAccountType("Visa Signature")).toBe("credit");
    expect(guessAccountType("Brokerage Account")).toBe("brokerage");
    expect(guessAccountType("Roth IRA")).toBe("retirement");
    expect(guessAccountType("Auto Loan")).toBe("loan");
    expect(guessAccountType("Mortgage")).toBe("loan");
  });

  it("returns null rather than guessing when the name says nothing", () => {
    expect(guessAccountType("Account 0707")).toBeNull();
    expect(guessAccountType("")).toBeNull();
  });
});

describe("accountsNeedingType", () => {
  it("flags a missing or guessed type, but trusts one a real feed supplied", () => {
    const accounts = [
      acct({ id: "confirmed", type: "credit", typeSource: "user" }),
      acct({ id: "from-feed", type: "credit", typeSource: "feed" }),
      acct({ id: "guessed", type: "credit", typeSource: "guess" }),
      acct({ id: "unknown", type: null, typeSource: "feed" }),
    ];
    // A feed that genuinely reported types is trusted -- asking the
    // user to re-confirm correct accounts just teaches them to click
    // through without reading. A name-based guess and a blank do need it.
    expect(accountsNeedingType(accounts).map((a) => a.id)).toEqual(["guessed", "unknown"]);
  });

  it("ignores accounts the user has excluded from calculations", () => {
    const accounts = [acct({ id: "ignored", type: null, includeInSpend: false })];
    expect(accountsNeedingType(accounts)).toHaveLength(0);
  });
});

describe("drawableLiquidCents with liability signs", () => {
  const balances = (entries: [string, number][]): AccountBalance[] =>
    entries.map(([accountId, balanceCents]) => ({ accountId, balanceCents }) as AccountBalance);

  it("subtracts card debt whichever sign the feed reports it in", () => {
    // One source reported card debt as NEGATIVE. SimpleFIN reports liability
    // balances from the bank's perspective, where POSITIVE means you owe.
    // Feeding the second into code written for the first would add debt to
    // cash. A liability's contribution is always <= 0, magnitude |balance|.
    const accounts = [
      acct({ id: "checking", name: "Checking", type: "depository", typeSource: "user" }),
      acct({ id: "card", name: "Rewards Card", type: "credit", typeSource: "user" }),
    ];
    const negativeDebt = drawableLiquidCents(accounts, balances([["checking", 500000], ["card", -150000]]));
    const positiveDebt = drawableLiquidCents(accounts, balances([["checking", 500000], ["card", 150000]]));
    expect(negativeDebt).toBe(350000);
    expect(positiveDebt).toBe(350000);
  });

  it("still leaves loans out entirely -- principal isn't due this month", () => {
    // Deliberately NOT the same treatment as a card. A card balance is due
    // within the month so netting it is right; a loan's principal is not, and
    // its monthly payment is already a budget line. Subtracting the principal
    // too would double-count it.
    const accounts = [
      acct({ id: "checking", name: "Checking", type: "depository", typeSource: "user" }),
      acct({ id: "loan", name: "Auto Loan", type: "loan", typeSource: "user" }),
    ];
    expect(drawableLiquidCents(accounts, balances([["checking", 500000], ["loan", 200000]]))).toBe(500000);
  });

  it("leaves asset balances exactly as reported, including a genuine overdraft", () => {
    const accounts = [acct({ id: "checking", name: "Checking", type: "depository", typeSource: "user" })];
    expect(drawableLiquidCents(accounts, balances([["checking", -5000]]))).toBe(-5000);
  });

  it("excludes an account whose type the user hasn't confirmed rather than guessing at its sign", () => {
    // Silently counting an untyped account is how a credit card ends up
    // inflating drawable. Better to under-report and flag it.
    const accounts = [
      acct({ id: "checking", name: "Checking", type: "depository", typeSource: "user" }),
      acct({ id: "mystery", name: "Account 0707", type: null, typeSource: "feed" }),
    ];
    expect(drawableLiquidCents(accounts, balances([["checking", 500000], ["mystery", 999999]]))).toBe(500000);
  });

  it("still excludes retirement accounts, however they're typed", () => {
    const accounts = [
      acct({ id: "ira", name: "Roth IRA", type: "brokerage", typeSource: "user" }),
      acct({ id: "ira2", name: "Traditional IRA", type: "retirement", typeSource: "user" }),
    ];
    expect(drawableLiquidCents(accounts, balances([["ira", 5000000], ["ira2", 5000000]]))).toBe(0);
  });
});
