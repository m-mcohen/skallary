// tests/domain/recurring.test.ts
//
// The bill detector. Rules the tests pin, in order of what would break if
// wrong: a series needs >=3 occurrences and consistent cadence, amounts are
// tolerated within a band, and the audit surfaces both a detected series with
// no budget line AND a budget line with no detected series.
import { describe, expect, test } from "vitest";
import {
  auditAgainstBudget,
  detectRecurring,
  nextDate,
  usualAmount,
} from "../../src/domain/recurring";
import type { NormalizedTxn } from "../../src/domain/types";

const txn = (over: Partial<NormalizedTxn>): NormalizedTxn =>
  ({
    sourceTransactionId: over.sourceTransactionId ?? "t1",
    accountId: "a1",
    date: "2026-01-01",
    amountCents: -1000,
    sourceCategory: null,
    merchant: null,
    isTransfer: false,
    sourceUpdatedAt: null,
    payee: null,
    ...over,
  }) as NormalizedTxn;

// A monthly Netflix, six months, consistent amount.
const netflix = (): NormalizedTxn[] =>
  ["2026-03-15", "2026-04-15", "2026-05-16", "2026-06-15", "2026-07-15", "2026-08-15"].map((d, i) =>
    txn({ sourceTransactionId: `n${i}`, date: d, amountCents: -2000, payee: "Netflix", sourceCategory: "Business Software" })
  );

describe("detectRecurring", () => {
  test("finds a monthly series", () => {
    const [series] = detectRecurring(netflix(), {});
    expect(series.cadence).toBe("monthly");
    expect(series.typicalAmountCents).toBe(-2000);
    expect(series.occurrenceCount).toBe(6);
  });

  test("predicts the next date one interval past the last seen", () => {
    const [series] = detectRecurring(netflix(), {});
    expect(series.lastSeen).toBe("2026-08-15");
    // Monthly cadence keeps the day of the month.
    expect(series.nextExpected).toBe("2026-09-15");
  });

  test("refuses to call two occurrences a series", () => {
    // Two rows can be anything -- a one-off followed by another. Three is the
    // minimum where a cadence is even a claim.
    const two = netflix().slice(0, 2);
    expect(detectRecurring(two, {})).toEqual([]);
  });

  test("refuses when the intervals do not agree", () => {
    // Same payee, but the gaps are 30, 90, 30 -- no consistent cadence.
    const inconsistent = [
      txn({ sourceTransactionId: "x1", date: "2026-01-01", payee: "Random", amountCents: -100 }),
      txn({ sourceTransactionId: "x2", date: "2026-01-31", payee: "Random", amountCents: -100 }),
      txn({ sourceTransactionId: "x3", date: "2026-04-30", payee: "Random", amountCents: -100 }),
      txn({ sourceTransactionId: "x4", date: "2026-05-30", payee: "Random", amountCents: -100 }),
    ];
    expect(detectRecurring(inconsistent, {})).toEqual([]);
  });

  test("tolerates amount jitter within a band", () => {
    // A utility whose bill drifts +/- 15% is still one series; a $5 charge
    // then a $500 one is not.
    const jitter = [
      txn({ sourceTransactionId: "u1", date: "2026-01-05", payee: "Toy Power", amountCents: -8000 }),
      txn({ sourceTransactionId: "u2", date: "2026-02-05", payee: "Toy Power", amountCents: -9200 }),
      txn({ sourceTransactionId: "u3", date: "2026-03-05", payee: "Toy Power", amountCents: -7100 }),
      txn({ sourceTransactionId: "u4", date: "2026-04-05", payee: "Toy Power", amountCents: -8500 }),
    ];
    const [series] = detectRecurring(jitter, {});
    expect(series.cadence).toBe("monthly");
    expect(series.amountBandCents).toBeGreaterThan(0);
  });

  test("resolves the category through the mapping the budget uses", () => {
    const rows = netflix().map((t) => ({ ...t, sourceCategory: "Streaming" }));
    const [series] = detectRecurring(rows, { Streaming: "Business Software" });
    expect(series.planningCategory).toBe("Business Software");
  });
});

describe("auditAgainstBudget", () => {
  test("flags a detected series whose category is not budgeted as recurring", () => {
    const series = detectRecurring(netflix(), {});
    const audit = auditAgainstBudget(series, ["Rent", "Internet & Cable"]);
    expect(audit.unbudgetedSeries.map((s) => s.label)).toContain("Netflix");
  });

  test("flags a budget line marked recurring with no detected series", () => {
    // The bill you think you have but the feed no longer sees -- a dead
    // subscription, or a missing account. This is the value of the audit.
    const series = detectRecurring(netflix(), {});
    const audit = auditAgainstBudget(series, ["Business Software", "Gym Membership"]);
    expect(audit.missingActuals).toContain("Gym Membership");
    expect(audit.unbudgetedSeries).toEqual([]);
  });
});

describe("card payments are not bills", () => {
  test("a monthly Credit Card Payment is money moving, not a recurring bill", () => {
    const autopay = [0, 1, 2, 3].map((i) =>
      txn({ sourceTransactionId: `cc${i}`, date: `2026-0${i + 3}-05`, amountCents: -150000, payee: "Demo Card Autopay", sourceCategory: "Credit Card Payment" })
    );
    expect(detectRecurring(autopay, {})).toEqual([]);
    // The same payments filed under a spending category still count as a bill.
    const rent = autopay.map((t) => ({ ...t, sourceCategory: "Rent" }));
    expect(detectRecurring(rent, {})).toHaveLength(1);
  });
});

// Separate an account move from two accounts paying at the same time.
describe("the account move, calendar dates and the usual amount", () => {
  const run = (prefix: string, accountId: string, payee: string, dates: string[], cents = -4000) =>
    dates.map((d, i) => txn({ sourceTransactionId: `${prefix}${i}`, accountId, date: d, amountCents: cents, payee }));

  test("joins a merchant's run across an account move", () => {
    const rows = [
      ...run("o", "old", "Demo Cover", ["2026-04-05", "2026-05-05"]),
      ...run("n", "new", "Demo Cover", ["2026-06-05", "2026-07-05"]),
    ];
    const series = detectRecurring(rows, {});
    expect(series).toHaveLength(1);
    expect(series[0].occurrenceCount).toBe(4);
    expect(series[0].accountId).toBe("new");
    expect(series[0].accountIds).toEqual(["old", "new"]);
    expect(series[0].charges.map((c) => c.id)).toEqual(["o0", "o1", "n0", "n1"]);
    expect(series[0].source).toBe("found");
  });

  test("does not join two accounts charged at the same time", () => {
    const rows = [
      ...run("a", "a", "Spotify", ["2026-03-18", "2026-04-18", "2026-05-18", "2026-06-18", "2026-07-18", "2026-08-18"], -1800),
      ...run("b", "b", "Spotify", ["2026-06-22", "2026-07-22", "2026-08-22", "2026-09-22"], -1800),
    ];
    const series = detectRecurring(rows, {});
    expect(series.map((s) => s.accountId).sort()).toEqual(["a", "b"]);
    expect(series.every((s) => s.accountIds.length === 1)).toBe(true);
  });

  test("does not join across a gap longer than 62 days", () => {
    const rows = [
      ...run("o", "old", "Demo Cover", ["2026-02-05", "2026-03-05"]),
      ...run("n", "new", "Demo Cover", ["2026-06-05", "2026-07-05", "2026-08-05"]),
    ];
    const series = detectRecurring(rows, {});
    expect(series).toHaveLength(1);
    expect(series[0].accountIds).toEqual(["new"]);
    expect(series[0].occurrenceCount).toBe(3);
  });

  // Mixed history can hide distinct payment patterns.
  test("a run that qualifies on its own is still found when its older history would fail the tests", () => {
    const wild = [-9000, -2000, -24000, -9500, -12500, -10000].map((c, i) =>
      txn({ sourceTransactionId: `w${i}`, accountId: "old", date: `2026-0${i + 1}-15`, amountCents: c, payee: "Toy Power" })
    );
    const steady = run("s", "new", "Toy Power", ["2026-07-15", "2026-08-15", "2026-09-15"], -20000);
    const series = detectRecurring([...wild, ...steady], {}, "2026-10-01");
    expect(series).toHaveLength(1);
    expect(series[0].accountIds).toEqual(["new"]);
    expect(series[0].occurrenceCount).toBe(3);
    const gap = [
      ...run("g", "old", "Toy Wash", ["2025-01-13", "2025-02-13", "2025-11-12", "2025-12-12"], -3000),
      ...run("h", "new", "Toy Wash", ["2026-02-13", "2026-03-13", "2026-04-13", "2026-05-13"], -3000),
    ];
    expect(detectRecurring(gap, {}, "2026-06-01").map((s) => s.accountIds)).toEqual([["new"]]);
  });

  test("predicts a monthly charge on the same day of the month", () => {
    const rows = run("f", "a", "Toy Power", ["2026-06-15", "2026-07-16", "2026-08-15", "2026-09-15"], -18000);
    expect(detectRecurring(rows, {})[0].nextExpected).toBe("2026-10-15");
  });

  test("a charge on the 31st falls on the last day of a short month, and back on the 31st after", () => {
    expect(nextDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDate("2026-01-31", "monthly", 2)).toBe("2026-03-31");
    expect(nextDate("2026-11-30", "quarterly")).toBe("2027-02-28");
    expect(nextDate("2024-02-29", "annual")).toBe("2025-02-28");
    expect(nextDate("2026-09-29", "weekly", 2)).toBe("2026-10-13");
    expect(nextDate("2026-09-29", "biweekly")).toBe("2026-10-13");
    const rows = run("e", "a", "Gym", ["2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31"], -4500);
    expect(detectRecurring(rows, {})[0].nextExpected).toBe("2026-02-28");
  });

  test("the usual amount is the middle of the last 3 charges", () => {
    const cents = [-2000, -2000, -2000, -2000, -2400, -2400];
    const rows = cents.map((c, i) => txn({ sourceTransactionId: `p${i}`, date: `2026-0${i + 3}-15`, amountCents: c, payee: "Netflix" }));
    expect(detectRecurring(rows, {})[0].typicalAmountCents).toBe(-2400);
    expect(usualAmount([-2000, -2000, -2400, -2400])).toBe(-2400);
    expect(usualAmount([-1000, -3000])).toBe(-2000);
  });
});
