import { expect, test } from "vitest";
import { parseIcs, usNationalHolidays } from "../../src/domain/holidays";

test("US holidays fall on their rule dates, including weekends", () => {
  expect(usNationalHolidays(2027).map(h => [h.key, h.start])).toEqual([
    ["new-years-day", "2027-01-01"], ["martin-luther-king-jr-day", "2027-01-18"],
    ["washingtons-birthday", "2027-02-15"], ["memorial-day", "2027-05-31"],
    ["juneteenth-national-independence-day", "2027-06-19"], ["independence-day", "2027-07-04"],
    ["labor-day", "2027-09-06"], ["columbus-day", "2027-10-11"], ["veterans-day", "2027-11-11"],
    ["thanksgiving-day", "2027-11-25"], ["christmas-day", "2027-12-25"],
  ]);
});

test("a calendar file unfolds names, imports all-day dates and yearly repeats, and reports timed entries", () => {
  const file = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Spring Fes", " tival", "DTSTART;VALUE=DATE:20270405", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Winter Festival 5788", "DTSTART;VALUE=DATE:20271231", "DTEND;VALUE=DATE:20280102", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Harvest Day", "DTSTART;VALUE=DATE:20270910", "RRULE:FREQ=YEARLY;COUNT=3", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Evening lighting", "DTSTART:20270402T190000", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const { holidays, problems } = parseIcs(file, "imported-1");
  expect(holidays.map(h => [h.key, h.start, h.end])).toEqual([
    ["spring-festival", "2027-04-05", "2027-04-05"],
    ["harvest-day", "2027-09-10", "2027-09-10"],
    ["winter-festival", "2027-12-31", "2028-01-01"],
    ["harvest-day", "2028-09-10", "2028-09-10"],
    ["harvest-day", "2029-09-10", "2029-09-10"],
  ]);
  expect(problems).toEqual([expect.stringContaining("Evening lighting")]);
});
