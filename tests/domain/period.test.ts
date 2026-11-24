import { describe, expect, test } from "vitest";
import {
  periodOf,
  monthIndex,
  periodFromIndex,
  formatPeriodLabel,
  formatMonthShort,
  localDateIso,
  monthBounds,
  formatDateRange,
  formatShortDate,
  isPartialMonth,
  monthHeading,
  DEFAULT_PRESET,
  PERIOD_PRESETS,
  clampToPeriod,
  customPeriod,
  inPeriod,
  periodFromQuery,
  periodLabel,
  periodToQuery,
  resolvePeriod,
  type PeriodPresetId,
} from "../../src/domain/period";

test("periodOf takes the YYYY-MM of a date or timestamp", () => {
  expect(periodOf("2026-09-16")).toBe("2026-09");
  expect(periodOf("2026-01-31T23:59:59.000Z")).toBe("2026-01");
});

test("monthIndex differences are whole months apart, across a year boundary", () => {
  expect(monthIndex("2027-01") - monthIndex("2026-01")).toBe(12);
  expect(monthIndex("2026-12") - monthIndex("2026-11")).toBe(1);
  expect(monthIndex("2026-01") - monthIndex("2025-12")).toBe(1);
});

test("periodFromIndex inverts monthIndex, including December and January", () => {
  for (const p of ["2026-01", "2026-12", "2030-06", "1999-11"]) {
    expect(periodFromIndex(monthIndex(p))).toBe(p);
  }
  expect(periodFromIndex(monthIndex("2026-12") + 1)).toBe("2027-01");
});

test("formatPeriodLabel spells the month out and leaves junk alone", () => {
  expect(formatPeriodLabel("2026-09")).toBe("September 2026");
  expect(formatPeriodLabel("2030-01")).toBe("January 2030");
  expect(formatPeriodLabel("2026-13")).toBe("2026-13");
  expect(formatPeriodLabel("nope")).toBe("nope");
});

test("monthBounds is inclusive and knows month lengths and leap years", () => {
  expect(monthBounds("2026-08")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  expect(monthBounds("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  expect(monthBounds("2026-04")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
});

test("monthBounds throws on a malformed period rather than producing a silent wrong range", () => {
  expect(() => monthBounds("2026-13")).toThrow();
  expect(() => monthBounds("2026-00")).toThrow();
  expect(() => monthBounds("26-1")).toThrow();
  expect(() => monthBounds("2026-08-01")).toThrow();
});

test("formatDateRange reads the way a person would say it", () => {
  expect(formatDateRange("2026-08-01", "2026-08-31")).toBe("Aug 1 to Aug 31, 2026");
  expect(formatDateRange("2025-12-01", "2026-01-31")).toBe("Dec 1, 2025 to Jan 31, 2026");
  expect(formatDateRange("2026-08-05", "2026-08-05")).toBe("Aug 5, 2026");
  expect(formatDateRange("2026-08-01", null)).toBe("From Aug 1, 2026");
  expect(formatDateRange(null, "2026-08-31")).toBe("Through Aug 31, 2026");
  expect(formatDateRange(null, null)).toBe("All dates");
});

describe("period presets", () => {
  const at = (preset: Exclude<PeriodPresetId, "custom">, asOf: string) => {
    const p = resolvePeriod(preset, asOf);
    return [p.from, p.to];
  };

  test("every preset on an ordinary day, 2026-09-20", () => {
    const asOf = "2026-09-20";
    expect(at("this-month", asOf)).toEqual(["2026-09-01", "2026-09-20"]);
    expect(at("last-month", asOf)).toEqual(["2026-08-01", "2026-08-31"]);
    expect(at("this-quarter", asOf)).toEqual(["2026-07-01", "2026-09-20"]);
    // The current month to date plus the 2 (or 11) complete months before it.
    expect(at("last-3", asOf)).toEqual(["2026-07-01", "2026-09-20"]);
    expect(at("last-12", asOf)).toEqual(["2025-10-01", "2026-09-20"]);
    expect(at("ytd", asOf)).toEqual(["2026-01-01", "2026-09-20"]);
    expect(at("last-year", asOf)).toEqual(["2025-01-01", "2025-12-31"]);
    expect(at("all", asOf)).toEqual([null, null]);
  });

  test("across a year boundary, 2026-01-15", () => {
    const asOf = "2026-01-15";
    expect(at("last-month", asOf)).toEqual(["2025-12-01", "2025-12-31"]);
    expect(at("last-3", asOf)).toEqual(["2025-11-01", "2026-01-15"]);
    expect(at("last-12", asOf)).toEqual(["2025-02-01", "2026-01-15"]);
    expect(at("this-quarter", asOf)).toEqual(["2026-01-01", "2026-01-15"]);
    expect(at("ytd", asOf)).toEqual(["2026-01-01", "2026-01-15"]);
  });

  test("on a leap day, and the month after one", () => {
    expect(at("this-month", "2024-02-29")).toEqual(["2024-02-01", "2024-02-29"]);
    expect(at("last-month", "2024-03-10")).toEqual(["2024-02-01", "2024-02-29"]);
    expect(at("last-month", "2026-03-10")).toEqual(["2026-02-01", "2026-02-28"]);
  });

  test("a preset remembers which one it is; the default is the last 12 months", () => {
    expect(resolvePeriod("ytd", "2026-09-20").preset).toBe("ytd");
    expect(DEFAULT_PRESET).toBe("last-12");
    expect(PERIOD_PRESETS.map((p) => p.id)).toEqual([
      "this-month", "last-month", "this-quarter", "last-3", "last-12", "ytd", "last-year", "all",
    ]);
  });

  test("a custom range is kept in order even when typed backwards", () => {
    expect(customPeriod("2026-08-31", "2026-08-01")).toEqual({ preset: "custom", from: "2026-08-01", to: "2026-08-31" });
    expect(customPeriod("2026-08-01", "2026-08-31")).toEqual({ preset: "custom", from: "2026-08-01", to: "2026-08-31" });
  });
});

describe("a period in the link", () => {
  const asOf = "2026-09-20";
  test("a preset and a custom range both round trip", () => {
    const preset = resolvePeriod("last-3", asOf);
    expect(periodToQuery(preset)).toEqual({ period: "last-3" });
    expect(periodFromQuery(new URLSearchParams(periodToQuery(preset)), asOf)).toEqual(preset);

    const custom = customPeriod("2026-02-10", "2026-03-05");
    expect(periodToQuery(custom)).toEqual({ from: "2026-02-10", to: "2026-03-05" });
    expect(periodFromQuery(new URLSearchParams(periodToQuery(custom)), asOf)).toEqual(custom);
  });

  test("a preset is re-resolved against today, so an old bookmark of 'This month' means this month", () => {
    expect(periodFromQuery(new URLSearchParams("period=this-month"), "2027-03-04")).toEqual({
      preset: "this-month", from: "2027-03-01", to: "2027-03-04",
    });
  });

  test("nothing usable in the link is null, never a guess", () => {
    for (const q of ["", "period=fortnight", "period=custom", "from=2026-02-30&to=2026-03-05", "from=yesterday", "tab=income"]) {
      expect(periodFromQuery(new URLSearchParams(q), asOf), q).toBeNull();
    }
  });

  test("one end alone is a real range: from a date on, or through a date", () => {
    expect(periodFromQuery(new URLSearchParams("from=2026-01-01"), asOf)).toEqual({ preset: "custom", from: "2026-01-01", to: null });
    expect(periodFromQuery(new URLSearchParams("to=2026-01-31"), asOf)).toEqual({ preset: "custom", from: null, to: "2026-01-31" });
  });
});

describe("a period in words, on a date, and against a month", () => {
  const last12 = resolvePeriod("last-12", "2026-09-20");
  test("periodLabel", () => {
    expect(periodLabel(last12)).toBe("Last 12 months");
    expect(periodLabel(resolvePeriod("all", "2026-09-20"))).toBe("All time");
    expect(periodLabel(customPeriod("2026-08-01", "2026-08-31"))).toBe("Aug 1 to Aug 31, 2026");
  });

  test("inPeriod is inclusive at both ends, and all time includes everything", () => {
    expect(inPeriod("2025-10-01", last12)).toBe(true);
    expect(inPeriod("2026-09-20", last12)).toBe(true);
    expect(inPeriod("2025-09-30", last12)).toBe(false);
    expect(inPeriod("2026-09-21", last12)).toBe(false);
    expect(inPeriod("1999-01-01", resolvePeriod("all", "2026-09-20"))).toBe(true);
  });

  test("clampToPeriod cuts a month to the part the period covers", () => {
    expect(clampToPeriod(monthBounds("2026-09"), last12)).toEqual({ from: "2026-09-01", to: "2026-09-20" });
    expect(clampToPeriod(monthBounds("2026-03"), last12)).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    const midMonth = customPeriod("2026-02-10", "2026-03-05");
    expect(clampToPeriod(monthBounds("2026-02"), midMonth)).toEqual({ from: "2026-02-10", to: "2026-02-28" });
    expect(clampToPeriod(monthBounds("2026-03"), midMonth)).toEqual({ from: "2026-03-01", to: "2026-03-05" });
    expect(clampToPeriod(monthBounds("2026-03"), resolvePeriod("all", "2026-09-20"))).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });
});

describe("formatMonthShort", () => {
  test("a month key reads as a short month and year", () => {
    expect(formatMonthShort("2026-09")).toBe("Sep 2026");
    expect(formatMonthShort("2025-10")).toBe("Oct 2025");
  });
  test("anything that is not a month key comes back unchanged", () => {
    expect(formatMonthShort("2026")).toBe("2026");
    expect(formatMonthShort("2026-13")).toBe("2026-13");
    expect(formatMonthShort("Total")).toBe("Total");
  });
});

describe("localDateIso", () => {
  test("is the local calendar date, not the UTC one", () => {
    const prev = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 02:00 UTC on Oct 1 is the evening of Sep 30 in Florida.
      expect(localDateIso(new Date("2026-10-01T02:00:00Z"))).toBe("2026-09-30");
      expect(localDateIso(new Date("2026-10-01T14:00:00Z"))).toBe("2026-10-01");
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });
});

test("a short date carries its year only outside the current year", () => {
  expect(formatShortDate("2026-09-30", "2026-10-01")).toBe("Sep 30");
  expect(formatShortDate("2025-11-02", "2026-10-01")).toBe("Nov 2, 2025");
});

// October's one day sat beside full months in Reports.
test("a month the range ends inside is marked with the day it runs through", () => {
  expect(monthHeading("2026-10", "2026-10-01")).toBe("Oct 2026 (through Oct 1)");
  expect(isPartialMonth("2026-10", "2026-10-01")).toBe(true);
});

test("a month the range covers to its last day is not marked", () => {
  expect(monthHeading("2026-09", "2026-09-30")).toBe("Sep 2026");
  expect(isPartialMonth("2026-09", "2026-09-30")).toBe(false);
  expect(monthHeading("2026-09", "2026-10-01")).toBe("Sep 2026");
  expect(isPartialMonth("2026-02", null)).toBe(false);
});
