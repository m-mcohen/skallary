// tests/domain/networth.test.ts
//
// Net worth over time comes from the balance READINGS the app stores at each
// sync. The transaction back-cast it replaced could not be trusted,
// so these tests pin the reading rules: one point per month, the latest reading
// of each account by that month, the same accounts and signs as the headline,
// and a last point equal to the headline. Expected values are worked by hand.
import { describe, expect, test } from "vitest";
import { countsTowardNetWorth, netWorthByDay, netWorthCents, netWorthRows, pointsInPeriod } from "../../src/domain/networth";
import { customPeriod, type Period } from "../../src/domain/period";
import type { Account } from "../../src/domain/types";
import type { AccountBalance, BalanceReading } from "../../src/domain/plan-types";

const acct = (id: string, type: string, extra: Partial<Account> = {}): Account =>
  ({ id, name: id, type, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me", ...extra }) as Account;

const reading = (accountId: string, recordedOn: string, balanceCents: number): BalanceReading => ({
  accountId,
  recordedOn,
  balanceCents,
  asOf: `${recordedOn}T12:00:00Z`,
});

describe("countsTowardNetWorth", () => {
  test("an archived record never counts", () => {
    expect(countsTowardNetWorth(acct("old", "depository", { archived: true }), true)).toBe(false);
  });

  test("the partner's own accounts follow the Include switch; shared and the user's always count", () => {
    const partner = acct("p1", "depository", { owner: "partner" });
    expect(countsTowardNetWorth(partner, false)).toBe(false);
    expect(countsTowardNetWorth(partner, true)).toBe(true);
    expect(countsTowardNetWorth(acct("j", "depository", { owner: "joint" }), false)).toBe(true);
    expect(countsTowardNetWorth(acct("m", "depository"), false)).toBe(true);
  });

  test("the spending switch does not decide net worth: money not counted as spending is still the user's", () => {
    expect(countsTowardNetWorth(acct("b", "brokerage", { includeInSpend: false }), false)).toBe(true);
  });
});

describe("netWorthRows with the Include switch", () => {
  test("the partner's account is left out of the headline while the switch is off", () => {
    const accounts = [acct("chk", "depository"), acct("p1", "depository", { owner: "partner" })];
    const balances: AccountBalance[] = [
      { accountId: "chk", balanceCents: 100_000, asOf: "2026-10-01T00:00:00Z" },
      { accountId: "p1", balanceCents: 4_700_000, asOf: "2026-09-10T00:00:00Z" },
    ];
    expect(netWorthCents(accounts, balances, false)).toBe(100_000);
    // 100,000 + 4,700,000 = 4,800,000
    expect(netWorthCents(accounts, balances, true)).toBe(4_800_000);
    expect(netWorthRows(accounts, balances, false).map((r) => r.account.id)).toEqual(["chk"]);
  });
});

describe("netWorthByDay", () => {
  const chk = acct("chk", "depository");
  const visa = acct("visa", "credit");
  const loan = acct("loan", "loan");

  test("one point per day with a reading: each account's latest reading carries forward, debt subtracting", () => {
    const readings = [
      reading("chk", "2026-09-30", 1_000_00),
      reading("chk", "2026-10-01", 1_300_00),
      // The feed reports this card positive; it is still owed.
      reading("visa", "2026-10-01", 200_00),
      reading("loan", "2026-09-30", -9_000_00),
    ];
    expect(netWorthByDay([chk, visa, loan], readings, false)).toEqual([
      // Sep 30: chk 1,000.00 less the loan's 9,000.00; the card has no reading yet.
      { period: "2026-09-30", cents: -8_000_00, lastRecordedOn: "2026-09-30" },
      // Oct 1: chk 1,300.00 less the card's 200.00 less the loan carried forward.
      { period: "2026-10-01", cents: -7_900_00, lastRecordedOn: "2026-10-01" },
    ]);
  });

  test("the last point equals the headline when the latest readings are today's balances", () => {
    const accounts = [chk, visa, loan, acct("ira", "retirement"), acct("p1", "depository", { owner: "partner" })];
    const today = [
      reading("chk", "2026-10-01", 2_500_00),
      reading("visa", "2026-10-01", -300_00),
      reading("loan", "2026-09-30", 9_000_00),
      reading("ira", "2026-09-30", 12_000_00),
      reading("p1", "2026-09-10", 47_000_00),
    ];
    const balances: AccountBalance[] = today.map((r) => ({ accountId: r.accountId, balanceCents: r.balanceCents, asOf: r.asOf }));
    const line = netWorthByDay(accounts, [reading("chk", "2026-09-01", 1_00), ...today], false);
    // 2,500.00 - 300.00 - 9,000.00 + 12,000.00 = 5,200.00
    expect(line.at(-1)?.cents).toBe(5_200_00);
    expect(line.at(-1)?.cents).toBe(netWorthCents(accounts, balances, false));
  });
});

describe("pointsInPeriod", () => {
  const points = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((period) => ({ period, n: 1 }));
  const months = (p: Period) => pointsInPeriod(points, p).map((x) => x.period);

  test("keeps the months the period touches, including a month it only partly covers", () => {
    expect(months(customPeriod("2026-06-15", "2026-08-10"))).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  test("all time keeps everything, and one open end is respected", () => {
    expect(months({ preset: "all", from: null, to: null })).toHaveLength(5);
    expect(months({ preset: "custom", from: "2026-08-01", to: null })).toEqual(["2026-08", "2026-09"]);
    expect(months({ preset: "custom", from: null, to: "2026-06-30" })).toEqual(["2026-05", "2026-06"]);
  });

  test("a period before or after all history keeps nothing, and the input is not changed", () => {
    expect(months(customPeriod("2030-01-01", "2030-12-31"))).toEqual([]);
    expect(points).toHaveLength(5);
  });
});
