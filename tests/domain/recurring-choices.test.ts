// Choices hide a detected charge or mark a missed charge with its cadence.
import { describe, expect, test } from "vitest";
import { detectRecurring, isRecurringTxn, usualAmount } from "../../src/domain/recurring";
import { CADENCE_LABELS, guessCadence, validateChoice, type RecurringChoice } from "../../src/domain/recurring-choices";
import type { NormalizedTxn } from "../../src/domain/types";

const txn = (over: Partial<NormalizedTxn>): NormalizedTxn =>
  ({
    sourceTransactionId: "t",
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

const run = (prefix: string, accountId: string, payee: string, dates: string[], cents = -2000) =>
  dates.map((d, i) => txn({ sourceTransactionId: `${prefix}${i}`, accountId, date: d, amountCents: cents, payee }));

const choice = (over: Partial<RecurringChoice>): RecurringChoice => ({
  payeeKey: "netflix",
  accountId: "a1",
  choice: "not_recurring",
  cadence: null,
  label: "Netflix",
  createdAt: "2026-10-01T12:00:00.000Z",
  ...over,
});

const netflix = run("n", "a1", "Netflix", ["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"]);
const ASOF = "2026-10-01";

describe("Not recurring", () => {
  test("hides a charge the app found", () => {
    expect(detectRecurring(netflix, {}, ASOF)).toHaveLength(1);
    expect(detectRecurring(netflix, {}, ASOF, [choice({})])).toEqual([]);
  });

  test("still hides it after it moves to a new account record", () => {
    const moved = [
      ...run("o", "old", "Netflix", ["2026-04-15", "2026-05-15"]),
      ...run("n", "new", "Netflix", ["2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"]),
    ];
    expect(detectRecurring(moved, {}, ASOF)[0].accountIds).toEqual(["old", "new"]);
    expect(detectRecurring(moved, {}, ASOF, [choice({ accountId: "old" })])).toEqual([]);
  });

  // When a joined run splits, hiding one part leaves the other visible.
  test("hides only the charge it was pressed on when a joined run is shown as two", () => {
    const rows = [
      ...run("o", "old", "Gym", ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"], -1000),
      ...run("w", "new", "Gym", ["2026-08-10", "2026-08-17", "2026-08-24"], -6000),
    ];
    const shown = detectRecurring(rows, {}, "2026-08-25");
    expect(shown.map((s) => [s.accountId, s.cadence]).sort()).toEqual([["new", "weekly"], ["old", "monthly"]]);
    const afterHide = detectRecurring(rows, {}, "2026-08-25", [choice({ payeeKey: "gym", accountId: "new", label: "Gym" })]);
    expect(afterHide.map((s) => [s.accountId, s.cadence])).toEqual([["old", "monthly"]]);
  });

  test("on another account of the same merchant leaves this one alone", () => {
    expect(detectRecurring(netflix, {}, ASOF, [choice({ accountId: "elsewhere" })])).toHaveLength(1);
  });
});

describe("Mark as recurring", () => {
  // Two payments and a refund do not qualify for automatic detection.
  const lemonade = [
    txn({ sourceTransactionId: "l1", accountId: "new", date: "2026-08-02", amountCents: -4000, payee: "Demo Cover" }),
    txn({ sourceTransactionId: "l2", accountId: "new", date: "2026-08-21", amountCents: 700, payee: "Demo Cover" }),
    txn({ sourceTransactionId: "l3", accountId: "new", date: "2026-09-02", amountCents: -2200, payee: "Demo Cover" }),
  ];
  const mark = choice({ payeeKey: "demo cover", accountId: "new", choice: "recurring", cadence: "monthly", label: "Demo Cover" });

  test("makes a charge from 2 payments at the chosen rhythm, leaving the refund out", () => {
    expect(detectRecurring(lemonade, {}, ASOF)).toEqual([]);
    const [s] = detectRecurring(lemonade, {}, ASOF, [mark]);
    expect(s.source).toBe("marked");
    expect(s.cadence).toBe("monthly");
    expect(s.nextExpected).toBe("2026-10-02");
    expect(s.occurrenceCount).toBe(2);
    expect(s.typicalAmountCents).toBe(usualAmount([-4000, -2200]));
    expect(s.charges.map((c) => c.id)).toEqual(["l1", "l3"]);
  });

  test("a marked charge that has stopped still lists, naming the date it missed, and is one charge once it starts again", () => {
    const old = [txn({ sourceTransactionId: "s1", accountId: "new", date: "2026-05-02", amountCents: -4000, payee: "Demo Cover" })];
    expect(detectRecurring(old, {}, ASOF, [mark]).map((s) => [s.source, s.nextExpected])).toEqual([["marked", "2026-06-02"]]);
    const restarted = [...old, txn({ sourceTransactionId: "s2", accountId: "new", date: "2026-09-20", amountCents: -4000, payee: "Demo Cover" })];
    expect(detectRecurring(restarted, {}, ASOF, [mark])).toHaveLength(1);
  });

  test("replaces the charge the app found instead of listing it twice", () => {
    const series = detectRecurring(netflix, {}, ASOF, [choice({ choice: "recurring", cadence: "quarterly" })]);
    expect(series).toHaveLength(1);
    expect(series[0].source).toBe("marked");
    expect(series[0].cadence).toBe("quarterly");
  });

  test("the newer of two choices on one charge wins", () => {
    const hidden = choice({ accountId: "old", createdAt: "2026-10-01T10:00:00.000Z" });
    const marked = choice({ accountId: "new", choice: "recurring", cadence: "monthly", createdAt: "2026-10-01T11:00:00.000Z" });
    const moved = [
      ...run("o", "old", "Netflix", ["2026-04-15", "2026-05-15"]),
      ...run("n", "new", "Netflix", ["2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"]),
    ];
    expect(detectRecurring(moved, {}, ASOF, [hidden, marked])).toHaveLength(1);
    expect(detectRecurring(moved, {}, ASOF, [{ ...hidden, createdAt: "2026-10-01T12:00:00.000Z" }, marked])).toEqual([]);
  });

  test("isRecurringTxn says whether a transaction belongs to a recurring charge", () => {
    const series = detectRecurring(lemonade, {}, ASOF, [mark]);
    expect(isRecurringTxn(series, lemonade[2])).toBe(true);
    expect(isRecurringTxn(series, { ...lemonade[2], accountId: "other" })).toBe(false);
    expect(isRecurringTxn(series, { ...lemonade[2], payee: "Someone else" })).toBe(false);
  });
});

describe("validateChoice", () => {
  const good = { payeeKey: "demo cover", accountId: "new", choice: "recurring", cadence: "monthly", label: "Demo Cover" };

  test("accepts a good choice and fills in a missing label from the merchant key", () => {
    expect(validateChoice(good)).toEqual(good);
    expect(validateChoice({ ...good, label: "  " })).toEqual({ ...good, label: "demo cover" });
  });

  test("Not recurring carries no rhythm", () => {
    expect(validateChoice({ ...good, choice: "not_recurring", cadence: "monthly" })).toEqual({ ...good, choice: "not_recurring", cadence: null });
  });

  test("refuses bad input in plain words", () => {
    expect(validateChoice(null)).toBe("Unknown choice.");
    expect(validateChoice({ ...good, choice: "maybe" })).toBe("Unknown choice.");
    expect(validateChoice({ ...good, payeeKey: " " })).toBe("This charge has no merchant name, so it cannot be recurring.");
    expect(validateChoice({ ...good, accountId: "" })).toBe("This charge has no account.");
    expect(validateChoice({ ...good, cadence: "fortnightly" })).toBe("Pick how often it repeats.");
    expect(validateChoice({ ...good, cadence: null })).toBe("Pick how often it repeats.");
  });
});

describe("guessCadence and the rhythm names", () => {
  test("guesses from the gaps between payments", () => {
    expect(guessCadence(["2026-08-02", "2026-09-02"])).toBe("monthly");
    expect(guessCadence(["2026-09-01", "2026-09-08", "2026-09-15"])).toBe("weekly");
    expect(guessCadence(["2026-09-01"])).toBeNull();
    expect(guessCadence(["2026-01-01", "2026-02-20"])).toBeNull(); // 50 days: no rhythm within 20 percent
  });

  test("every rhythm has a plain name", () => {
    expect(CADENCE_LABELS).toEqual({
      weekly: "Every week",
      biweekly: "Every 2 weeks",
      monthly: "Every month",
      quarterly: "Every 3 months",
      annual: "Every year",
    });
  });
});

describe("a mark with an amount: only that merchant's charges near the amount", () => {
  const mark = (amountCents: number | null, cadence: "monthly" = "monthly", choice: "recurring" | "not_recurring" = "recurring", createdAt = "2026-10-07T20:00:00.000Z"): RecurringChoice =>
    ({ payeeKey: "demo cloud", accountId: "a1", choice, cadence: choice === "recurring" ? cadence : null, label: "Demo Cloud", amountCents, createdAt });
  const cloud = [
    ...run("a", "a1", "Demo Cloud", ["2026-06-30"], -6000),
    ...run("b", "a1", "Demo Cloud", ["2026-07-30", "2026-08-31"], -12000),
    ...run("c", "a1", "Demo Cloud", ["2026-09-30"], -6000),
    ...run("d", "a1", "Demo Cloud", ["2026-10-03"], -7000),
  ];
  test("validateChoice carries a whole-cent amount above zero, or none; anything else is refused in words", () => {
    expect(validateChoice({ ...mark(12000) })).toMatchObject({ amountCents: 12000 });
    expect((validateChoice({ payeeKey: "x", accountId: "a1", choice: "recurring", cadence: "monthly", label: "X" }) as { amountCents?: number | null }).amountCents ?? null).toBeNull();
    for (const bad of [-1, 0, 12.5, "200"]) expect(validateChoice({ ...mark(12000), amountCents: bad })).toMatch(/amount/i);
  });
  test("the $120 mark lists the $120 charges alone, at $120, and the odd plan-switch charges stay out", () => {
    const [s, ...rest] = detectRecurring(cloud, {}, "2026-10-07", [mark(12000)]);
    expect(rest).toEqual([]);
    expect(s.source).toBe("marked");
    expect(s.markAmountCents).toBe(12000);
    expect(s.typicalAmountCents).toBe(-12000);
    expect(s.charges.map((c) => c.id)).toEqual(["b0", "b1"]);
  });
  test("one merchant, two marks: the rent and the wifi are two charges, each with its own usual amount", () => {
    const cedar = [
      ...run("r", "a1", "Zelle Transfer To Cedar Hall", ["2026-07-01", "2026-08-03", "2026-10-01"], -70000),
      ...run("w", "a1", "Zelle Transfer To Cedar Hall", ["2026-07-01", "2026-08-03"], -5000),
    ];
    const key = "zelle transfer to cedar hall";
    const marks = [
      { ...mark(70000), payeeKey: key, label: "Cedar rent" },
      { ...mark(5000), payeeKey: key, label: "Cedar wifi" },
    ];
    const series = detectRecurring(cedar, {}, "2026-08-20", marks).sort((a, b) => a.typicalAmountCents - b.typicalAmountCents);
    expect(series.map((s) => [s.markAmountCents, s.typicalAmountCents, s.occurrenceCount])).toEqual([[70000, -70000, 3], [5000, -5000, 2]]);
  });
  test("Not recurring with an amount hides that amount's charges only; the whole-merchant path still runs for the rest", () => {
    const cedar = [
      ...run("r", "a1", "Zelle Transfer To Cedar Hall", ["2026-07-01", "2026-08-01", "2026-09-01"], -70000),
      ...run("w", "a1", "Zelle Transfer To Cedar Hall", ["2026-07-01", "2026-08-01", "2026-09-01"], -5000),
    ];
    const key = "zelle transfer to cedar hall";
    const series = detectRecurring(cedar, {}, "2026-09-20", [{ ...mark(5000, "monthly", "not_recurring"), payeeKey: key }]);
    expect(series.map((s) => [s.source, s.typicalAmountCents, s.markAmountCents])).toEqual([["found", -70000, null]]);
  });
  test("a mark with no amount still covers every charge of the merchant, as before", () => {
    const [s] = detectRecurring(cloud, {}, "2026-10-07", [mark(null)]);
    expect(s.occurrenceCount).toBe(5);
    expect(s.markAmountCents).toBeNull();
  });
});

describe("a manually marked charge never lapses", () => {
  const wifi = run("w", "a1", "Zelle Transfer To Cedar Hall", ["2026-07-01", "2026-08-03"], -5000);
  const mark: RecurringChoice = { payeeKey: "zelle transfer to cedar hall", accountId: "a1", choice: "recurring", cadence: "monthly", amountCents: 5000, label: "Cedar wifi", createdAt: "2026-10-07T20:00:00.000Z" };
  test("a marked charge a whole cycle past its next date still lists, with the missed date for the screen to name", () => {
    const [s, ...rest] = detectRecurring(wifi, {}, "2026-10-07", [mark]);
    expect(rest).toEqual([]);
    expect(s.source).toBe("marked");
    expect(s.nextExpected).toBe("2026-09-03");
  });
  test("a charge the app found still lapses as before", () => {
    const found = run("f", "a1", "Old Gym", ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"], -4000);
    expect(detectRecurring(found, {}, "2026-10-07", [])).toEqual([]);
  });
});
