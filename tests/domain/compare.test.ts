// tests/domain/compare.test.ts
//
// Comparisons: a period against a baseline. Modeled on the Bravo for Power BI
// time intelligence set (previous period, same period last year, moving
// averages), with one rule: an unfinished month compares on the SAME DAYS ONLY.
// Sep 1-20 is compared with Aug 1-20, never with all of August.
import { describe, expect, test } from "vitest";
import { baselineFor, baselineOf, baselineSegments, compareFigures, isMonthEnd, monthSegments, shiftMonths, spentMonthToDate, sumForBaseline } from "../../src/domain/compare";
import { customPeriod, resolvePeriod } from "../../src/domain/period";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const AS_OF = "2026-09-20";

describe("date helpers", () => {
  test("shiftMonths keeps the day, clamps to a shorter month, and can follow a month end", () => {
    expect(shiftMonths("2026-09-20", -1, false)).toBe("2026-08-20");
    expect(shiftMonths("2026-03-31", -1, false)).toBe("2026-02-28"); // no Feb 31
    expect(shiftMonths("2024-02-29", -12, false)).toBe("2023-02-28"); // no Feb 29 in 2023
    expect(shiftMonths("2026-02-28", -1, true)).toBe("2026-01-31"); // a whole month maps to a whole month
    expect(shiftMonths("2026-01-15", -2, false)).toBe("2025-11-15"); // across a year
  });

  test("isMonthEnd knows month lengths", () => {
    expect(isMonthEnd("2026-02-28")).toBe(true);
    expect(isMonthEnd("2024-02-28")).toBe(false);
    expect(isMonthEnd("2026-09-20")).toBe(false);
  });

  test("monthSegments splits a range by calendar month and marks the whole ones", () => {
    expect(monthSegments({ from: "2026-07-01", to: "2026-09-20" })).toEqual([
      { from: "2026-07-01", to: "2026-07-31", whole: true },
      { from: "2026-08-01", to: "2026-08-31", whole: true },
      { from: "2026-09-01", to: "2026-09-20", whole: false },
    ]);
    expect(monthSegments({ from: "2026-02-10", to: "2026-02-20" })).toEqual([{ from: "2026-02-10", to: "2026-02-20", whole: false }]);
  });
});

describe("previous period", () => {
  test("an unfinished month compares with the same days of the month before", () => {
    const b = baselineFor(resolvePeriod("this-month", AS_OF), "previous")!;
    expect(b.ranges).toEqual([{ from: "2026-08-01", to: "2026-08-20" }]);
    expect(b.divideBy).toBe(1);
    expect(b.ledgerRange).toEqual({ from: "2026-08-01", to: "2026-08-20" });
    expect(b.caption).toBe("Aug 1 to Aug 20, 2026");
  });

  test("a whole month compares with the whole month before, whatever their lengths", () => {
    expect(baselineFor(resolvePeriod("last-month", "2026-04-10"), "previous")!.ranges).toEqual([{ from: "2026-02-01", to: "2026-02-28" }]);
    expect(baselineFor(resolvePeriod("last-month", "2026-03-10"), "previous")!.ranges).toEqual([{ from: "2026-01-01", to: "2026-01-31" }]);
  });

  test("a period of several months shifts back by its own length, keeping the same days at the end", () => {
    expect(baselineFor(resolvePeriod("last-3", AS_OF), "previous")!.ranges).toEqual([{ from: "2026-04-01", to: "2026-06-20" }]);
    expect(baselineFor(resolvePeriod("last-12", AS_OF), "previous")!.ranges).toEqual([{ from: "2024-10-01", to: "2025-09-20" }]);
    expect(baselineFor(resolvePeriod("last-year", AS_OF), "previous")!.ranges).toEqual([{ from: "2024-01-01", to: "2024-12-31" }]);
    expect(baselineFor(resolvePeriod("this-quarter", AS_OF), "previous")!.ranges).toEqual([{ from: "2026-04-01", to: "2026-06-20" }]);
  });

  test("year to date compares with the previous year to date, not with the nine months before January", () => {
    // Shifting Jan 1-Sep 20 back by its own nine months would give Apr-Dec of
    // last year, which is nobody's idea of the previous period for a year to date.
    expect(baselineFor(resolvePeriod("ytd", AS_OF), "previous")!.ranges).toEqual([{ from: "2025-01-01", to: "2025-09-20" }]);
  });

  test("a typed range that does not start on the 1st shifts back by its own number of days", () => {
    // Aug 10 to Sep 5 is 27 days, so the 27 days before it: Jul 14 to Aug 9.
    expect(baselineFor(customPeriod("2026-08-10", "2026-09-05"), "previous")!.ranges).toEqual([{ from: "2026-07-14", to: "2026-08-09" }]);
  });
});

describe("same period last year", () => {
  test.each(["2025-02-28", "2025-02-15"])("a partial February starting %s keeps the same last day in a leap year", (from) => {
    const period = customPeriod(from, "2025-02-28");
    const expected = { from: from.replace("2025", "2024"), to: "2024-02-28" };
    expect(baselineFor(period, "last-year")!.ranges).toEqual([expected]);
    expect(baselineFor(period, "last-year")!.ledgerRange).toEqual(expected);
    expect(baselineSegments(period, "last-year")![0].ranges).toEqual([expected]);
  });

  test("shifts back 12 months, same days; a whole February stays whole across a leap year", () => {
    expect(baselineFor(resolvePeriod("this-month", AS_OF), "last-year")!.ranges).toEqual([{ from: "2025-09-01", to: "2025-09-20" }]);
    expect(baselineFor(resolvePeriod("ytd", AS_OF), "last-year")!.ranges).toEqual([{ from: "2025-01-01", to: "2025-09-20" }]);
    expect(baselineFor(customPeriod("2025-02-01", "2025-02-28"), "last-year")!.ranges).toEqual([{ from: "2024-02-01", to: "2024-02-29" }]);
  });
});

describe("averages", () => {
  test("an unfinished month compares with the same days of each of the months before", () => {
    const b = baselineFor(resolvePeriod("this-month", AS_OF), "avg-3")!;
    expect(b.ranges).toEqual([
      { from: "2026-08-01", to: "2026-08-20" },
      { from: "2026-07-01", to: "2026-07-20" },
      { from: "2026-06-01", to: "2026-06-20" },
    ]);
    expect(b.divideBy).toBe(3);
    // Three separate stretches of days cannot open as one ledger.
    expect(b.ledgerRange).toBeNull();
    expect(b.caption).toBe("the average of the same days in the 3 months before");
  });

  test("a whole month compares with the average whole month, which CAN open as one ledger", () => {
    const b = baselineFor(resolvePeriod("last-month", AS_OF), "avg-12")!;
    expect(b.ranges).toHaveLength(12);
    expect(b.ranges[0]).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(b.ranges[11]).toEqual({ from: "2025-08-01", to: "2025-08-31" });
    expect(b.divideBy).toBe(12);
    expect(b.ledgerRange).toEqual({ from: "2025-08-01", to: "2026-07-31" });
    expect(b.caption).toBe("the average month over the 12 months before");
  });

  test("days past the end of a shorter month are clamped, not dropped", () => {
    // Mar 1-30, compared with the same days of February (which has 28).
    const b = baselineFor(customPeriod("2026-03-01", "2026-03-30"), "avg-3")!;
    expect(b.ranges[0]).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(b.ranges[1]).toEqual({ from: "2026-01-01", to: "2026-01-30" });
  });

  test("a period of several months: each of its months is compared with the months BEFORE THE PERIOD", () => {
    // Jul, Aug whole and Sep 1-20, against the 3 months before July: Jun, May, Apr.
    const b = baselineFor(resolvePeriod("last-3", AS_OF), "avg-3")!;
    expect(b.ranges).toHaveLength(9);
    expect(b.ranges.filter((r) => r.from === "2026-06-01" && r.to === "2026-06-30")).toHaveLength(2); // once for Jul, once for Aug
    expect(b.ranges.filter((r) => r.from === "2026-06-01" && r.to === "2026-06-20")).toHaveLength(1); // for Sep 1-20
    expect(b.ledgerRange).toBeNull();
  });
});

describe("when there is nothing to compare", () => {
  test("no comparison, all time, and a range with an open end have no baseline", () => {
    expect(baselineFor(resolvePeriod("this-month", AS_OF), "none")).toBeNull();
    expect(baselineFor(resolvePeriod("all", AS_OF), "previous")).toBeNull();
    expect(baselineFor(customPeriod("2026-01-01", null), "last-year")).toBeNull();
  });
});

describe("compareFigures", () => {
  test("change in dollars and in percent", () => {
    expect(compareFigures(300000, 290000, "expense")).toMatchObject({ changeCents: 10000, direction: "up" });
    expect(compareFigures(300000, 290000, "expense").changePct).toBeCloseTo(3.448, 2);
    expect(compareFigures(250000, 500000, "income")).toMatchObject({ changeCents: -250000, changePct: -50, direction: "down" });
    expect(compareFigures(100, 100, "expense")).toMatchObject({ changeCents: 0, changePct: 0, direction: "flat" });
  });

  test("percent is not applicable against a zero or negative baseline; dollars always show", () => {
    expect(compareFigures(5000, 0, "expense")).toMatchObject({ changeCents: 5000, changePct: null });
    expect(compareFigures(5000, -2000, "expense")).toMatchObject({ changeCents: 7000, changePct: null });
  });

  test("more spending is unfavorable, more income is favorable, more net is favorable, flat is neither", () => {
    expect(compareFigures(2, 1, "expense").favorable).toBe(false);
    expect(compareFigures(1, 2, "expense").favorable).toBe(true);
    expect(compareFigures(2, 1, "income").favorable).toBe(true);
    expect(compareFigures(1, 2, "income").favorable).toBe(false);
    expect(compareFigures(2, 1, "net").favorable).toBe(true);
    expect(compareFigures(1, 1, "net").favorable).toBeNull();
  });
});

describe("sumForBaseline", () => {
  const accounts = [
    { id: "a", name: "A", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
    { id: "x", name: "X", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
  ] as Account[];
  const t = (id: string, date: string, amountCents: number, sourceCategory: string, over: Partial<NormalizedTxn> = {}) =>
    ({ sourceTransactionId: id, accountId: "a", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over }) as NormalizedTxn;
  const txns = [
    t("1", "2026-08-05", -30000, "Groceries"),
    t("2", "2026-08-20", -10000, "Groceries"), // the 20th is inside "through the 20th"
    t("3", "2026-08-21", -99900, "Groceries"), // the 21st is not
    t("4", "2026-07-10", -20000, "Groceries"),
    t("5", "2026-06-10", -10000, "Groceries"),
    t("6", "2026-08-10", -5000, "Groceries", { accountId: "x" }), // an account that is not counted
    t("7", "2026-08-11", -7000, "Groceries", { isTransfer: true }),
    t("8", "2026-08-01", 800000, "Paychecks"),
  ];

  test("previous period: the same days, the same scope as every other figure", () => {
    const b = baselineFor(resolvePeriod("this-month", AS_OF), "previous")!;
    const sums = sumForBaseline(txns, accounts, {}, b);
    expect(sums.byCategory.get("expense|Groceries")).toBe(40000);
    expect(sums.byCategory.get("income|Paychecks")).toBe(800000);
    expect(sums.expenseCents).toBe(40000);
    expect(sums.incomeCents).toBe(800000);
    expect(sums.netCents).toBe(760000);
  });

  test("an average divides the total by the number of months, rounded to the cent", () => {
    const b = baselineFor(resolvePeriod("this-month", AS_OF), "avg-3")!;
    const sums = sumForBaseline(txns, accounts, {}, b);
    // Aug 1-20: 40000. Jul 1-20: 20000. Jun 1-20: 10000. Total 70000 / 3 = 23333.33
    expect(sums.byCategory.get("expense|Groceries")).toBe(23333);
    expect(sums.expenseCents).toBe(23333);
  });

  // Saving/Investing is its own bucket. A baseline that files every
  // non-income row as spending turns money put away into spending, and makes
  // "last month, same days" on the Dashboard jump by whatever was saved.
  test("saving and investment income stay out of spending, and the bottom line is Left over", () => {
    const withSaving = [
      ...txns,
      t("9", "2026-08-12", -250000, "Investing"), // put away
      t("10", "2026-08-13", 7000, "Interest"), // what the money earned
    ];
    const b = baselineFor(resolvePeriod("this-month", AS_OF), "previous")!;
    const sums = sumForBaseline(withSaving, accounts, {}, b);
    expect(sums.expenseCents).toBe(40000);
    expect(sums.incomeCents).toBe(800000);
    expect(sums.savingCents).toBe(250000);
    expect(sums.investmentIncomeCents).toBe(7000);
    // Income + investment income - spending, the same as the cash flow table.
    // Saving is its own figure, not part of Left over .
    expect(sums.netCents).toBe(800000 + 7000 - 40000);
  });
});

describe("baselineOf: several categories at once, such as the Other row", () => {
  const accounts = [
    { id: "a", name: "A", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  ] as Account[];
  const t = (id: string, date: string, amountCents: number, sourceCategory: string) =>
    ({ sourceTransactionId: id, accountId: "a", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null }) as NormalizedTxn;

  test("an average is rounded ONCE over the group, so it equals its ledger total divided by the months", () => {
    // Pets 100 and Hobbies 100 over 3 months: each rounds to 33, but together they are 67, not 66.
    const txns = [t("1", "2026-07-10", -100, "Pets"), t("2", "2026-07-11", -100, "Hobbies")];
    const b = baselineFor(resolvePeriod("last-month", "2026-09-20"), "avg-3")!; // Aug, against May-Jul
    const sums = sumForBaseline(txns, accounts, {}, b);
    expect(sums.byCategory.get("expense|Pets")).toBe(33);
    expect(sums.byCategory.get("expense|Hobbies")).toBe(33);
    expect(baselineOf(sums, ["expense|Pets", "expense|Hobbies"])).toBe(67);
    expect(baselineOf(sums, ["expense|Nothing"])).toBe(0);
  });
});

describe("baselineSegments: the baseline month by month, for the chart marker", () => {
  test("previous period and last year shift each month by the same amount, same days at the end", () => {
    const prev = baselineSegments(resolvePeriod("last-3", AS_OF), "previous")!;
    expect(prev.map((s) => [s.month, s.ranges])).toEqual([
      ["2026-07", [{ from: "2026-04-01", to: "2026-04-30" }]],
      ["2026-08", [{ from: "2026-05-01", to: "2026-05-31" }]],
      ["2026-09", [{ from: "2026-06-01", to: "2026-06-20" }]],
    ]);
    const ly = baselineSegments(resolvePeriod("this-month", AS_OF), "last-year")!;
    expect(ly).toEqual([{ month: "2026-09", ranges: [{ from: "2025-09-01", to: "2025-09-20" }], divideBy: 1 }]);
  });

  test("a whole SHORT month maps to a whole LONGER month: all of February against all of January", () => {
    // Keeping the day number would stop at Jan 28 and drop three days of January.
    const feb = resolvePeriod("last-month", "2026-03-10");
    expect(baselineSegments(feb, "previous")).toEqual([
      { month: "2026-02", ranges: [{ from: "2026-01-01", to: "2026-01-31" }], divideBy: 1 },
    ]);
    expect(baselineSegments(customPeriod("2026-02-01", "2026-04-30"), "last-year")!.map((s) => s.ranges[0].to)).toEqual([
      "2025-02-28", "2025-03-31", "2025-04-30",
    ]);
  });

  test("the month-by-month ranges add up to exactly the whole baseline", () => {
    for (const compare of ["previous", "last-year", "avg-3", "avg-12"] as const) {
      for (const preset of ["this-month", "last-month", "this-quarter", "last-3", "last-12", "ytd", "last-year"] as const) {
        const period = resolvePeriod(preset, AS_OF);
        const whole = baselineFor(period, compare)!;
        const parts = baselineSegments(period, compare)!;
        const flat = parts.flatMap((p) => p.ranges);
        const days = (rs: { from: string; to: string }[]) => rs.map((r) => `${r.from}..${r.to}`).sort();
        if (compare === "previous" || compare === "last-year") {
          expect(flat[0].from, `${compare} ${preset}`).toBe(whole.ranges[0].from);
          expect(flat[flat.length - 1].to, `${compare} ${preset}`).toBe(whole.ranges[0].to);
        } else {
          expect(days(flat), `${compare} ${preset}`).toEqual(days(whole.ranges));
        }
      }
    }
  });

  test("an average is flat across whole months and lower for the month in progress", () => {
    const parts = baselineSegments(resolvePeriod("last-3", AS_OF), "avg-3")!;
    expect(parts.map((p) => p.divideBy)).toEqual([3, 3, 3]);
    expect(parts[0].ranges).toEqual(parts[1].ranges); // Jul and Aug: the same three whole months
    expect(parts[2].ranges[0]).toEqual({ from: "2026-06-01", to: "2026-06-20" });
  });

  test("there is no month-by-month baseline where there is no baseline, or where the shift is in days", () => {
    expect(baselineSegments(resolvePeriod("all", AS_OF), "previous")).toBeNull();
    expect(baselineSegments(resolvePeriod("this-month", AS_OF), "none")).toBeNull();
    expect(baselineSegments(customPeriod("2026-08-10", "2026-09-05"), "previous")).toBeNull();
  });
});

describe("spentMonthToDate: the Dashboard tile", () => {
  const accounts = [
    { id: "a", name: "A", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
    { id: "x", name: "X", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
  ] as Account[];
  const t = (id: string, date: string, amountCents: number, sourceCategory: string, over: Partial<NormalizedTxn> = {}) =>
    ({ sourceTransactionId: id, accountId: "a", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over }) as NormalizedTxn;
  const txns = [
    t("s1", "2026-09-03", -20000, "Groceries"),
    t("s2", "2026-09-20", -10000, "Groceries"), // today counts
    t("s3", "2026-09-21", -99900, "Groceries"), // tomorrow does not (a pending row dated ahead)
    t("in", "2026-09-15", 500000, "Paychecks"), // income is not spending
    t("x1", "2026-09-10", -5000, "Groceries", { accountId: "x" }), // not counted
    t("mv", "2026-09-11", -7000, "Savings", { isTransfer: true }), // moving money
    t("b1", "2026-08-05", -25000, "Groceries"),
    t("b2", "2026-08-20", -1000, "Groceries"), // the 20th is inside "same days"
    t("b3", "2026-08-21", -88800, "Groceries"), // the 21st is not
    t("old", "2026-07-01", -1, "Groceries"), // history reaches back past the baseline
  ];

  test("month to date against the same days of last month, in the shared scope", () => {
    const m = spentMonthToDate(txns, accounts, {}, "2026-09-20");
    expect(m.period).toEqual({ preset: "this-month", from: "2026-09-01", to: "2026-09-20" });
    expect(m.cents).toBe(30000);
    // The baseline also carries each top category on those days. Groceries $250.00 + $10.00.
    expect(m.baseline).toEqual({ range: { from: "2026-08-01", to: "2026-08-20" }, cents: 26000, byCategory: { Groceries: 26000 } });
  });

  test("with no history reaching back to the baseline, there is nothing to compare", () => {
    const m = spentMonthToDate(txns.filter((x) => x.date >= "2026-09-01"), accounts, {}, "2026-09-20");
    expect(m.cents).toBe(30000);
    expect(m.baseline).toBeNull();
  });

  test("left over and the top categories come from the same rollup as the spending", () => {
    const month = [
      t("a", "2026-09-02", -30000, "Groceries"),
      t("b", "2026-09-03", -50000, "Rent"),
      t("c", "2026-09-04", -10000, "Coffee Shops"),
      t("d", "2026-09-05", 200000, "Paychecks"),
      t("r", "2026-09-06", 4000, "Shopping"), // a refund month for Shopping: not a top spend
    ];
    const m = spentMonthToDate(month, accounts, {}, "2026-09-20");
    expect(m.cents).toBe(90000 - 4000);
    expect(m.leftOverCents).toBe(200000 - (90000 - 4000));
    expect(m.topCategories).toEqual([
      { category: "Rent", cents: 50000 },
      { category: "Groceries", cents: 30000 },
      { category: "Coffee Shops", cents: 10000 },
    ]);
  });

  test("a month with nothing yet reads zero, with no categories", () => {
    const m = spentMonthToDate([], accounts, {}, "2026-09-01");
    expect(m).toMatchObject({ cents: 0, leftOverCents: 0, topCategories: [] });
  });

  test("never more than five categories, largest first", () => {
    const month = ["A", "B", "C", "D", "E", "F", "G"].map((c, i) => t(c, "2026-09-02", -(1000 + i), c));
    const top = spentMonthToDate(month, accounts, {}, "2026-09-20").topCategories;
    expect(top.map((x) => x.category)).toEqual(["G", "F", "E", "D", "C"]);
  });

  test("on the first of the month it is one day against one day", () => {
    const m = spentMonthToDate([t("a", "2026-09-01", -100, "Groceries"), t("b", "2026-08-01", -300, "Groceries"), t("c", "2026-08-02", -500, "Groceries"), t("old", "2026-07-01", -1, "Groceries")], accounts, {}, "2026-09-01");
    expect(m.cents).toBe(100);
    expect(m.baseline).toEqual({ range: { from: "2026-08-01", to: "2026-08-01" }, cents: 300, byCategory: { Groceries: 300 } });
  });
});
