// tests/domain/defect-fixes.test.ts -- domain fixes.
// Each block names the defect it pins. Expected values are worked by hand in
// the comments; none is read back from the code.
import { describe, expect, test } from "vitest";

import { netWorthRows, netWorthCents } from "../../src/domain/networth";
import { isHeldBackAccount, isLoanAccount } from "../../src/domain/runway";
import { monthlyLoanPaymentCents } from "../../src/domain/loan";
import { detectRecurring } from "../../src/domain/recurring";

import { isGoalFundingAccount } from "../../src/domain/goals";
import { parseLooseDollarsToCents, percentInputValue } from "../../src/domain/money";
import { trailingMonthlyBurnCents } from "../../src/domain/burn";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { AccountBalance, WishlistItem } from "../../src/domain/plan-types";

function acct(id: string, name: string, type: string | null, extra: Partial<Account> = {}): Account {
  return { id, name, type, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me", ...extra };
}
const bal = (accountId: string, balanceCents: number): AccountBalance => ({ accountId, balanceCents, asOf: "2026-09-18T00:00:00Z" });

describe("Net worth: archived balances were counted twice, and debt trusted the feed's sign", () => {
  const accounts = [
    acct("chk", "Checking", "depository"),
    acct("chk-old", "Checking (old record)", "depository", { archived: true }),
    acct("visa", "Rewards Card", "credit"),
    acct("amex", "Cash Back Card", "credit"),
    acct("loan", "Car loan", "loan"),
    acct("ira", "Roth IRA", "retirement"),
    acct("nobal", "Never synced", "depository"),
  ];
  const balances = [bal("chk", 500_000), bal("chk-old", 480_000), bal("visa", -40_000), bal("amex", 25_000), bal("loan", 900_000), bal("ira", 1_000_000)];

  test("an archived record's balance is the same money its live record reports, so it is left out", () => {
    expect(netWorthRows(accounts, balances, false).map((r) => r.account.id)).toEqual(["chk", "visa", "amex", "loan", "ira"]);
  });

  test("card and loan balances always subtract, whichever sign the feed reports", () => {
    const by = Object.fromEntries(netWorthRows(accounts, balances, false).map((r) => [r.account.id, r.cents]));
    expect(by).toEqual({ chk: 500_000, visa: -40_000, amex: -25_000, loan: -900_000, ira: 1_000_000 });
    // 500,000 - 40,000 - 25,000 - 900,000 + 1,000,000 = 535,000
    expect(netWorthCents(accounts, balances, false)).toBe(535_000);
  });

  test("isLoanAccount reads the type, not the name", () => {
    expect(isLoanAccount(acct("m", "Home", "mortgage"))).toBe(true);
    expect(isLoanAccount(acct("s", "Loan payoff savings", "depository"))).toBe(false);
  });
});

describe("Held back: one rule for the Dashboard tile and the Position rows", () => {
  test("retirement money that is NOT counted as drawable, by type or by a whole-word name match", () => {
    expect(isHeldBackAccount(acct("a", "Roth IRA", "brokerage"))).toBe(true); // name
    expect(isHeldBackAccount(acct("b", "Ridgeline Retirement", "retirement"))).toBe(true); // type alone (the Position rows used to miss this)
    expect(isHeldBackAccount(acct("c", "Miraculous Savings", "depository"))).toBe(false); // "ira" inside a word is not a match (the tile used to catch this)
    expect(isHeldBackAccount(acct("d", "Roth IRA", "brokerage", { drawable: true }))).toBe(false); // switched on: it is in Drawable, so it cannot also be held back
    expect(isHeldBackAccount(acct("e", "Old 401k", "retirement", { archived: true }))).toBe(false);
  });
});

describe("Loan math: a zero rate or a zero term produced a broken number", () => {
  test("at 0 percent the payment is the principal spread evenly", () => {
    expect(monthlyLoanPaymentCents(90_000_00, 0, 10)).toBe(75_000); // 9,000,000 cents / 120 months
  });
  test("a term of zero or less has no payment schedule, so the payment is 0, never NaN or Infinity", () => {
    expect(monthlyLoanPaymentCents(90_000_00, 0.105, 0)).toBe(0);
    expect(monthlyLoanPaymentCents(90_000_00, 0, 0)).toBe(0);
  });
  test("the normal case is unchanged: 60,000 at 10.5 percent over 10 years is 809.61 a month", () => {
    expect(monthlyLoanPaymentCents(6_000_000, 0.105, 10)).toBe(80_961);
  });
});

describe("Percent boxes showed 3.5000000000000004", () => {
  test("a stored rate reads back as the number that was typed", () => {
    expect(percentInputValue(0.035)).toBe("3.5");
    expect(percentInputValue(0.105)).toBe("10.5");
    expect(percentInputValue(0.1)).toBe("10");
    expect(percentInputValue(0.07 / 12 * 12)).toBe("7");
    expect(percentInputValue(0.12345678)).toBe("12.3457"); // four decimals at most
  });
});

describe("Try a salary: a comma or a dollar sign read as zero", () => {
  test("loose parsing accepts what people type and never throws", () => {
    expect(parseLooseDollarsToCents("170,000")).toBe(17_000_000);
    expect(parseLooseDollarsToCents("$170,000.50")).toBe(17_000_050);
    expect(parseLooseDollarsToCents(" 95000 ")).toBe(9_500_000);
    expect(parseLooseDollarsToCents("")).toBe(0);
    expect(parseLooseDollarsToCents("abc")).toBe(0);
    expect(parseLooseDollarsToCents("-5")).toBe(0); // a salary is never negative
  });
});

describe("Bills: a paycheck was listed as a bill, and a canceled subscription never left", () => {
  const t = (id: string, date: string, amountCents: number, payee: string): NormalizedTxn => ({
    sourceTransactionId: id, accountId: "chk", date, amountCents, sourceCategory: "X", merchant: payee, payee, isTransfer: false, sourceUpdatedAt: null,
  });
  const monthly = (payee: string, amount: number, months: string[]) => months.map((m, i) => t(`${payee}-${i}`, `${m}-05`, amount, payee));

  test("money coming in is not a bill", () => {
    const txns = [...monthly("Employer Payroll", 500_000, ["2026-05", "2026-06", "2026-07", "2026-08"]), ...monthly("Spotify", -1_199, ["2026-05", "2026-06", "2026-07", "2026-08"])];
    expect(detectRecurring(txns, {}, "2026-09-01").map((s) => s.label)).toEqual(["Spotify"]);
  });

  test("a series that has missed a whole cycle beyond its next expected date is dropped", () => {
    const old = monthly("Old Gym", -4_000, ["2025-01", "2025-02", "2025-03", "2025-04"]); // next expected about 2025-05-05
    const live = monthly("Spotify", -1_199, ["2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(detectRecurring([...old, ...live], {}, "2026-09-01").map((s) => s.label)).toEqual(["Spotify"]);
    // One day late is not lapsed: due 2026-09-04, asked on 2026-09-20 (16 days late, under one 30.5 day cycle).
    expect(detectRecurring(live, {}, "2026-09-20").map((s) => s.label)).toEqual(["Spotify"]);
    // Without a date the old behavior holds, so other callers are unaffected.
    expect(detectRecurring(old, {}).map((s) => s.label)).toEqual(["Old Gym"]);
  });
});

describe("Goals: an account switched off under Counted could still fund a goal", () => {
  test("an account that takes no part anywhere else takes no part here", () => {
    expect(isGoalFundingAccount(acct("s", "Savings", "savings"))).toBe(true);
    expect(isGoalFundingAccount(acct("s", "Savings", "savings", { includeInSpend: false }))).toBe(false);
  });
});

describe("Snapshots: the Burn columns held 3 and 12 month TOTALS beside older monthly figures", () => {
  const rollups = [
    ...["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"].map((period) => ({ period, kind: "expense" as const, amountCents: 600_000 })),
    { period: "2026-06", kind: "expense" as const, amountCents: 900_000 },
    { period: "2026-07", kind: "expense" as const, amountCents: 600_000 },
    { period: "2026-08", kind: "expense" as const, amountCents: 300_000 },
    { period: "2026-09", kind: "expense" as const, amountCents: 50_000 }, // the current, partial month
    { period: "2026-08", kind: "income" as const, amountCents: 999_999 },
  ];
  test("a monthly average over the last N COMPLETE months; income and the current month stay out", () => {
    // Jun 9,000 + Jul 6,000 + Aug 3,000 = 18,000 over 3 months = 6,000.00
    expect(trailingMonthlyBurnCents(rollups, 3, "2026-09")).toBe(600_000);
    // Sep 2025 .. Aug 2026: nine months at 6,000 + 9,000 + 6,000 + 3,000 = 72,000 over 12 = 6,000.00
    expect(trailingMonthlyBurnCents(rollups, 12, "2026-09")).toBe(600_000);
  });
  test("a month with no spending counts as zero, and the divisor is always N", () => {
    expect(trailingMonthlyBurnCents([{ period: "2026-08", kind: "expense", amountCents: 300_000 }], 3, "2026-09")).toBe(100_000);
  });
});
