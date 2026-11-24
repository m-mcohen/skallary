// tests/domain/recurring-month.test.ts
//
// One month of recurring charges: what was paid, what is
// still to come, and Remaining due. Paid is real charges at their real amounts;
// still to come is predicted dates at the usual amount.
import { describe, expect, test } from "vitest";
import { endedRecurringMonth, missedDate, recurringMonth, whenText } from "../../src/domain/recurring-month";
import type { RecurringSeries } from "../../src/domain/recurring";

const series = (over: Partial<RecurringSeries> & { charges: RecurringSeries["charges"] }): RecurringSeries => {
  const last = over.charges[over.charges.length - 1];
  return {
    key: "netflix",
    label: "Netflix",
    accountId: "a1",
    accountIds: ["a1"],
    cadence: "monthly",
    typicalAmountCents: -1599,
    amountBandCents: 0,
    lastSeen: last.date,
    nextExpected: "",
    occurrenceCount: over.charges.length,
    lastFewAmounts: [],
    planningCategory: null,
    source: "found",
    ...over,
  };
};
const c = (id: string, date: string, amountCents = -1599) => ({ id, date, amountCents });

describe("recurringMonth", () => {
  test("a charge paid this month is Paid at its real amount, with nothing still to come", () => {
    const s = series({ charges: [c("1", "2026-09-02"), c("2", "2026-10-02", -1650)] });
    const m = recurringMonth([s], "2026-10", "2026-10-10");
    expect(m.items).toEqual([{ series: s, status: "paid", date: "2026-10-02", amountCents: 1650 }]);
    expect([m.paidCents, m.remainingCents, m.expectedCents]).toEqual([1650, 0, 1650]);
  });

  test("a charge due later this month is upcoming at its usual amount", () => {
    const s = series({ charges: [c("1", "2026-08-15"), c("2", "2026-09-15")] });
    const m = recurringMonth([s], "2026-10", "2026-10-01");
    expect(m.items).toEqual([{ series: s, status: "upcoming", date: "2026-10-15", amountCents: 1599 }]);
    expect(m.remainingCents).toBe(1599);
  });

  test("a date already passed this month with no charge seen is Not charged yet, and still counts as due", () => {
    const s = series({ charges: [c("1", "2026-08-15"), c("2", "2026-09-15")] });
    const m = recurringMonth([s], "2026-10", "2026-10-20");
    expect(m.items[0].status).toBe("late");
    expect(m.remainingCents).toBe(1599);
  });

  test("a weekly charge appears once for each week left in the month", () => {
    const s = series({ cadence: "weekly", typicalAmountCents: -500, charges: [c("1", "2026-09-22", -500), c("2", "2026-09-29", -500)] });
    const m = recurringMonth([s], "2026-10", "2026-10-01");
    expect(m.items.map((i) => i.date)).toEqual(["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]);
    expect(m.remainingCents).toBe(2000);
  });

  test("a charge that missed last month is not counted this month", () => {
    const s = series({ charges: [c("1", "2026-07-06"), c("2", "2026-08-06")] });
    const m = recurringMonth([s], "2026-10", "2026-10-01");
    expect(m.items).toEqual([]);
    expect(missedDate(s, "2026-10-01")).toBe("2026-09-06");
  });

  test("next month has nothing paid, and a date still ahead before it starts is not a miss", () => {
    const s = series({ charges: [c("1", "2026-08-15"), c("2", "2026-09-15")] });
    const m = recurringMonth([s], "2026-11", "2026-10-01");
    expect(m.items).toEqual([{ series: s, status: "upcoming", date: "2026-11-15", amountCents: 1599 }]);
    expect(m.paidCents).toBe(0);
    expect(missedDate(s, "2026-10-01")).toBeNull();
  });

  test("a charge not charged yet this month is still expected next month", () => {
    const s = series({ charges: [c("1", "2026-08-05"), c("2", "2026-09-05")] });
    expect(recurringMonth([s], "2026-10", "2026-10-10").items[0].status).toBe("late");
    expect(recurringMonth([s], "2026-11", "2026-10-10").items).toEqual([{ series: s, status: "upcoming", date: "2026-11-05", amountCents: 1599 }]);
  });

  test("a refund from the merchant inside the month is not a payment", () => {
    // Charges hold money out only; a stray positive amount must still not count as Paid.
    const s = series({ charges: [c("1", "2026-09-02"), c("2", "2026-10-02", -1599), c("r", "2026-10-05", 659)] });
    const m = recurringMonth([s], "2026-10", "2026-10-10");
    expect(m.items.filter((i) => i.status === "paid").map((i) => i.amountCents)).toEqual([1599]);
    expect(m.paidCents).toBe(1599);
  });

  test("Expected is Paid plus Remaining due, and the still-to-come rows come first", () => {
    const paid = series({ key: "a", label: "A", charges: [c("1", "2026-09-03"), c("2", "2026-10-03", -1000)] });
    const late = series({ key: "b", label: "B", typicalAmountCents: -2000, charges: [c("3", "2026-08-05"), c("4", "2026-09-05")] });
    const soon = series({ key: "c", label: "C", typicalAmountCents: -3000, charges: [c("5", "2026-08-25"), c("6", "2026-09-25")] });
    const m = recurringMonth([paid, late, soon], "2026-10", "2026-10-10");
    expect(m.items.map((i) => [i.series.label, i.status])).toEqual([["B", "late"], ["C", "upcoming"], ["A", "paid"]]);
    expect([m.paidCents, m.remainingCents, m.expectedCents]).toEqual([1000, 5000, 6000]);
  });
});

describe("whenText", () => {
  const s = series({ charges: [c("1", "2026-09-15")] });
  const item = (status: "paid" | "late" | "upcoming", date: string) => ({ series: s, status, date, amountCents: 1 });

  test("reads like Monarch's", () => {
    expect(whenText(item("upcoming", "2026-10-01"), "2026-10-01")).toBe("Today");
    expect(whenText(item("upcoming", "2026-10-02"), "2026-10-01")).toBe("Tomorrow");
    expect(whenText(item("upcoming", "2026-10-04"), "2026-10-01")).toBe("In 3 days");
    expect(whenText(item("upcoming", "2026-10-08"), "2026-10-01")).toBe("In 7 days");
    expect(whenText(item("upcoming", "2026-10-14"), "2026-10-01")).toBe("Oct 14");
    expect(whenText(item("late", "2026-10-03"), "2026-10-10")).toBe("Not charged yet, due Oct 3");
    expect(whenText(item("paid", "2026-10-02"), "2026-10-10")).toBe("Paid Oct 2");
  });
});

// A past month on the Dashboard shows what recurring charges
// took that month, and nothing as still to come: a past month is over.
describe("endedRecurringMonth: a past month's recurring charges", () => {
  test("only what was paid, at the real amounts; nothing remaining", () => {
    const weekly = series({ key: "gym", label: "Gym", cadence: "weekly", typicalAmountCents: -1000, charges: [c("g1", "2026-08-03", -1000), c("g2", "2026-08-10", -1000)] });
    const monthly = series({ charges: [c("1", "2026-07-15"), c("2", "2026-08-15", -1650), c("3", "2026-09-15")] });
    const m = endedRecurringMonth([weekly, monthly], "2026-08");
    // Paid by hand: $10.00 + $10.00 + $16.50 = $36.50. The gym's later August dates
    // (17th, 24th, 31st) were predicted after its last charge, but August is over.
    expect(m.items.map((i) => [i.series.label, i.status, i.date])).toEqual([
      ["Gym", "paid", "2026-08-03"],
      ["Gym", "paid", "2026-08-10"],
      ["Netflix", "paid", "2026-08-15"],
    ]);
    expect([m.paidCents, m.remainingCents, m.expectedCents]).toEqual([3650, 0, 3650]);
  });
});
