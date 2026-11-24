import { expect, test } from "vitest";
import { renameMap } from "../../src/domain/merchants";
import type { Holiday, HolidayCalendar } from "../../src/domain/holidays";
import { holidayMonths } from "../../src/domain/holidays";
import { projectYearlyCosts, raiseMonths, validateRaise, type Projection, type ProjectionInput, type Raise } from "../../src/domain/yearly-costs";

const hol = (key: string, start: string, end: string): Holiday => ({ calendarId: "imported-1", key, name: key, start, end });
const cal = (id: string, coversThrough: string): HolidayCalendar => ({ id, name: id, source: "imported", on: true, importedAt: null, coversThrough });
const FEST = [hol("spring-festival", "2027-03-30", "2027-04-01"), hol("spring-festival", "2028-04-18", "2028-04-20")];
function raise(over: Partial<Raise> = {}): Raise {
  return { id: 1, planningCategory: "Clothing", label: "Spring wardrobe", amountCents: 25_000, createdAt: "2027-01-05T00:00:00Z", archivedAt: null,
    when: { kind: "once", month: "2027-09" }, ...over };
}
function project(over: Partial<ProjectionInput>): Projection {
  return projectYearlyCosts({ from: "2027-01", to: "2029-12", today: "2027-02-01", bills: [], terms: [], events: [], raises: [],
    holidays: [], calendars: [], txns: [], accounts: [], renames: renameMap([]), ...over });
}

test("a holiday raise follows its holiday each year, counted where it starts unless set to end", () => {
  const r = (countIn: "start" | "end") => raise({ when: { kind: "holiday", calendarId: "imported-1", holidayKey: "spring-festival", countIn } });
  expect(raiseMonths(r("start"), FEST, "2027-01", "2028-12").map((m) => m.month)).toEqual(["2027-03", "2028-04"]);
  expect(raiseMonths(r("end"), FEST, "2027-01", "2028-12").map((m) => m.month)).toEqual(["2027-04", "2028-04"]);
});
test("once and every-year raises land in their months, from the month they were made, and never go late", () => {
  const p = project({ raises: [raise({ id: 1, when: { kind: "once", month: "2027-09" } }),
    raise({ id: 2, createdAt: "2027-12-15T12:00:00Z", when: { kind: "every-year", monthOfYear: "11" } })], to: "2028-12" });
  expect(p.bigMonths.map((b) => [b.origin, b.sourceId, b.month])).toEqual([["raise", 1, "2027-09"], ["raise", 2, "2028-11"]]);
  expect(p.bigMonths.every((b) => b.id < 0)).toBe(true);
  expect(p.occurrences).toEqual([]);
});
test("an archived raise keeps its months before the month it was archived, and none after", () => {
  const r = raise({ archivedAt: "2028-02-10T00:00:00Z", when: { kind: "every-year", monthOfYear: "03" } });
  expect(project({ raises: [r] }).bigMonths.map((b) => b.month)).toEqual(["2027-03"]);
});
test("past the calendar's last date a raise keeps its last known month, and the app says the calendar needs a newer file", () => {
  const when = { kind: "holiday" as const, calendarId: "imported-1", holidayKey: "spring-festival", countIn: "start" as const };
  const p = project({ raises: [raise({ id: 3, when })], holidays: FEST.slice(0, 1), calendars: [cal("imported-1", "2027-03-30")], today: "2027-06-01", to: "2028-12" });
  expect(p.bigMonths.map((b) => b.month)).toEqual(["2027-03", "2028-03"]);
  expect(p.notices).toContainEqual({ kind: "calendar-runs-out", calendarId: "imported-1", coversThrough: "2027-03-30", raiseIds: [3] });
  // a calendar that reaches past a year from today raises no notice
  expect(project({ raises: [raise({ id: 3, when })], holidays: FEST, calendars: [cal("imported-1", "2029-01-01")], today: "2027-06-01" }).notices).toEqual([]);
});
test("a raise is refused without a line, a name, a positive whole-cent amount, or a real when", () => {
  const ok = { planningCategory: "Clothing", label: "x", amountCents: 100, when: { kind: "once", month: "2027-09" } };
  expect(validateRaise(ok)).toEqual(ok);
  for (const bad of [{ ...ok, label: "" }, { ...ok, amountCents: 0 }, { ...ok, amountCents: 1.5 }, { ...ok, when: { kind: "once", month: "2027-13" } }, { ...ok, when: null }]) {
    expect(typeof validateRaise(bad)).toBe("string");
  }
});
test("the dialog's month list holds each month with the holidays starting in it", () => {
  const list = holidayMonths(FEST, "2027-02", 3);
  expect(list.map((m) => [m.month, m.holidays.length])).toEqual([["2027-02", 0], ["2027-03", 1], ["2027-04", 0]]);
  expect(holidayMonths([], "2027-11", 3).map((m) => m.month)).toEqual(["2027-11", "2027-12", "2028-01"]);
});

test("a raise made late on a month's last evening in a western time zone counts from that local month", () => {
  const before = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const made = new Date(2027, 8, 30, 23, 0).toISOString();   // 11 PM local on Sept 30: already October in UTC
    expect(made.slice(0, 7)).toBe("2027-10");
    const r = raise({ createdAt: made, when: { kind: "once", month: "2027-09" } });
    expect(raiseMonths(r, [], "2027-01", "2027-12").map((m) => m.month)).toEqual(["2027-09"]);
    const gone = raise({ createdAt: "2027-01-05T00:00:00Z", archivedAt: made, when: { kind: "every-year", monthOfYear: "09" } });
    expect(raiseMonths(gone, [], "2027-01", "2027-12").map((m) => m.month)).toEqual([]);
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});
