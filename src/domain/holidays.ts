export interface HolidayCalendar { id: string; name: string; source: "us-national" | "imported"; on: boolean; importedAt: string | null; coversThrough: string | null }
export interface Holiday { calendarId: string; key: string; name: string; start: string; end: string }

export const US_NATIONAL = "us-national";
const DAY = 86_400_000;

export function holidayKey(name: string): string {
  return name.toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "").replace(/(?:^|-)\d{4,}$/, "");
}

export function usNationalHolidays(year: number): Holiday[] {
  function date(month: number, day: number): Date {
    const d = new Date(0);
    d.setUTCFullYear(year, month - 1, day);
    return d;
  }
  function nth(month: number, weekday: number, n: number): number {
    return 1 + (weekday - date(month, 1).getUTCDay() + 7) % 7 + 7 * (n - 1);
  }
  function holiday(name: string, month: number, day: number): Holiday {
    const start = date(month, day).toISOString().slice(0, 10);
    return { calendarId: US_NATIONAL, key: holidayKey(name), name, start, end: start };
  }
  const lastMondayOfMay = 31 - (date(5, 31).getUTCDay() - 1 + 7) % 7;
  return [
    holiday("New Year's Day", 1, 1),
    holiday("Martin Luther King Jr. Day", 1, nth(1, 1, 3)),
    holiday("Washington's Birthday", 2, nth(2, 1, 3)),
    holiday("Memorial Day", 5, lastMondayOfMay),
    holiday("Juneteenth National Independence Day", 6, 19),
    holiday("Independence Day", 7, 4),
    holiday("Labor Day", 9, nth(9, 1, 1)),
    holiday("Columbus Day", 10, nth(10, 1, 2)),
    holiday("Veterans Day", 11, 11),
    holiday("Thanksgiving Day", 11, nth(11, 4, 4)),
    holiday("Christmas Day", 12, 25),
  ];
}

// Calendar dates are whole days. UTC arithmetic preserves the duration across clock changes.
function dayNumber(value: string): number | null {
  if (!/^\d{8}$/.test(value)) return null;
  const iso = value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6);
  const ms = Date.parse(iso + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(iso) ? ms / DAY : null;
}

function recurrence(rule: string | undefined, year: number) {
  if (rule === undefined) return { count: 1, lastYear: year, until: Infinity };
  const parts = rule.toUpperCase().split(";");
  if (!parts.includes("FREQ=YEARLY") || parts.length > 2) return null;
  if (parts.length === 1) return { count: Infinity, lastYear: year + 9, until: Infinity };
  const limit = parts.find(p => p !== "FREQ=YEARLY") ?? "";
  if (/^COUNT=[1-9]\d*$/.test(limit)) return { count: Number(limit.slice(6)), lastYear: 9999, until: Infinity };
  if (limit.startsWith("UNTIL=")) {
    const until = dayNumber(limit.slice(6));
    if (until !== null) return { count: Infinity, lastYear: Number(limit.slice(6, 10)), until };
  }
  return null;
}

export const MAX_FILE_HOLIDAYS = 5000;
const MAX_YEARS_AHEAD = 10;

// One file may produce at most MAX_FILE_HOLIDAYS dates, none later than 10 years after `today`.
export function parseIcs(text: string, calendarId: string, today: Date = new Date()): { holidays: Holiday[]; problems: string[] } {
  const holidays: Holiday[] = [];
  const problems: string[] = [];
  const lastDay = Date.UTC(today.getUTCFullYear() + MAX_YEARS_AHEAD, today.getUTCMonth(), today.getUTCDate()) / DAY;

  function readEvent(fields: Map<string, string>) {
    const name = (fields.get("SUMMARY") ?? "").replace(/\\([nN,;\\])/g, (_, ch: string) =>
      ch.toLowerCase() === "n" ? " " : ch).trim();
    function skip(reason: string) {
      problems.push('Skipped "' + (name || "Unnamed entry") + '": ' + reason + ".");
    }
    const key = holidayKey(name);
    if (!key) return skip("it needs a name");
    const raw = fields.get("DTSTART") ?? "";
    const rawEnd = fields.get("DTEND");
    if (raw.includes("T") || rawEnd?.includes("T")) return skip("it has a time of day");
    const start = dayNumber(raw);
    if (start === null) return skip("its start date could not be read");
    const endExclusive = rawEnd === undefined ? start + 1 : dayNumber(rawEnd);
    if (endExclusive === null || endExclusive <= start) return skip("its end date could not be read");
    const duration = endExclusive - start - 1;
    const firstYear = Number(raw.slice(0, 4));
    const repeat = recurrence(fields.get("RRULE"), firstYear);
    if (!repeat || ["EXDATE", "RDATE", "RECURRENCE-ID", "EXRULE"].some(k => fields.has(k))) {
      return skip("its repeat pattern is not supported");
    }
    for (let year = firstYear, emitted = 0; year <= Math.min(9999, repeat.lastYear, new Date(lastDay * DAY).getUTCFullYear()) && emitted < repeat.count; year++) {
      const day = dayNumber(String(year).padStart(4, "0") + raw.slice(4));
      if (day === null) continue; // A February 29 recurrence skips years without that date.
      if (day > repeat.until || day > lastDay || day + duration > dayNumberMax) break;
      if (holidays.length >= MAX_FILE_HOLIDAYS) {
        throw new Error("That file would create more than " + MAX_FILE_HOLIDAYS.toLocaleString("en-US") +
          " holiday dates, so nothing was changed. Try a file with fewer or shorter repeating entries.");
      }
      holidays.push({ calendarId, key, name, start: new Date(day * DAY).toISOString().slice(0, 10),
        end: new Date((day + duration) * DAY).toISOString().slice(0, 10) });
      emitted++;
    }
  }

  const dayNumberMax = Date.UTC(9999, 11, 31) / DAY;
  let fields: Map<string, string> | undefined;
  let nested = 0;
  for (const line of text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const property = line.slice(0, separator).split(";", 1)[0].toUpperCase();
    const value = line.slice(separator + 1);
    if (property === "BEGIN" && value.toUpperCase() === "VEVENT") {
      fields = new Map();
      nested = 0;
    } else if (fields) {
      if (property === "END" && value.toUpperCase() === "VEVENT") {
        readEvent(fields);
        fields = undefined;
      } else if (property === "BEGIN") nested++;
      else if (property === "END") nested--;
      else if (nested === 0) fields.set(property, value);
    }
  }
  holidays.sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
  return { holidays, problems };
}

export function coversThrough(holidays: Holiday[]): string | null {
  return holidays.reduce<string | null>((last, h) => last === null || h.start > last ? h.start : last, null);
}

// The raise dialog's list: `count` months from `fromMonth`, each with the holidays that start in it.
export function holidayMonths(holidays: Holiday[], fromMonth: string, count: number): { month: string; holidays: Holiday[] }[] {
  const [year, month] = fromMonth.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const index = year * 12 + month - 1 + i;
    const label = Math.floor(index / 12) + "-" + String(index % 12 + 1).padStart(2, "0");
    return { month: label, holidays: holidays.filter(h => h.start.slice(0, 7) === label) };
  });
}
