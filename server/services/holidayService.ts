import { coversThrough, parseIcs, US_NATIONAL, usNationalHolidays, type Holiday, type HolidayCalendar } from "../../src/domain/holidays.js";
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";
import { yearlyCostsRepository } from "../repositories/yearlyCostsRepository.js";

const US_SETTING = "holiday_us_national";

function nationalDays(fromYear: number, toYear: number): Holiday[] {
  const days: Holiday[] = [];
  for (let year = fromYear; year <= toYear; year++) days.push(...usNationalHolidays(year));
  return days;
}

function byDate(a: Holiday, b: Holiday): number {
  return a.start.localeCompare(b.start) || a.name.localeCompare(b.name) || a.calendarId.localeCompare(b.calendarId);
}

export function holidayService() {
  const repo = yearlyCostsRepository();
  const settings = sqliteFinanceRepository();
  const usOn = () => settings.getSetting(US_SETTING) === "true";
  const setUsNational = (on: boolean) => settings.setSetting(US_SETTING, String(on));

  function imported(id: string, calendars = repo.listCalendars()): HolidayCalendar {
    const calendar = calendars.find(item => item.id === id);
    if (!calendar) throw new Error("That imported calendar could not be found.");
    return calendar;
  }

  return {
    calendars(): HolidayCalendar[] {
      return [{ id: US_NATIONAL, name: "US national holidays", source: "us-national", on: usOn(), importedAt: null, coversThrough: null }, ...repo.listCalendars()];
    },
    setUsNational,
    importFile(name: string, text: string, calendarId?: string) {
      if (!name.trim()) throw new Error("Enter a name for the calendar.");
      // Parse before taking the database write lock. Assign the permanent ID inside the transaction.
      const { holidays, problems } = parseIcs(text, calendarId ?? "");
      if (!holidays.length) throw new Error("No holidays were found in that file, so nothing was changed.");
      return repo.transaction(() => {
        const calendars = repo.listCalendars();
        const previous = calendarId === undefined ? undefined : imported(calendarId, calendars);
        const ids = new Set(calendars.map(calendar => calendar.id));
        let next = 1;
        while (ids.has(`imported-${next}`)) next++;
        const id = previous?.id ?? `imported-${next}`;
        const calendar: HolidayCalendar = {
          id, name: name.trim(), source: "imported", on: previous?.on ?? true,
          importedAt: new Date().toISOString(), coversThrough: coversThrough(holidays),
        };
        repo.saveCalendar(calendar);
        repo.replaceHolidaysFrom(id, holidays[0].start, holidays.map(day => ({ ...day, calendarId: id })));
        return { calendar, imported: holidays.length, problems };
      });
    },
    setOn(calendarId: string, on: boolean) {
      if (calendarId === US_NATIONAL) return setUsNational(on);
      repo.transaction(() => {
        imported(calendarId);
        repo.setCalendarOn(calendarId, on);
      });
    },
    remove(calendarId: string) {
      repo.transaction(() => {
        imported(calendarId);
        if (repo.listRaises().some(r => r.when.kind === "holiday" && r.when.calendarId === calendarId)) {
          throw new Error("A raise uses this calendar. Remove the raise first.");
        }
        repo.deleteCalendar(calendarId);
      });
    },
    holidaysBetween(fromMonth: string, toMonth: string): Holiday[] {
      const active = repo.listCalendars().filter(calendar => calendar.on).map(calendar => calendar.id);
      const days = active.length ? repo.listHolidays(active) : [];
      if (usOn()) days.push(...nationalDays(Number(fromMonth.slice(0, 4)), Number(toMonth.slice(0, 4))));
      return days.filter(day => day.start.slice(0, 7) <= toMonth && day.end.slice(0, 7) >= fromMonth).sort(byDate);
    },
    forProjection(fromYear: number, toYear: number): Holiday[] {
      return [...nationalDays(fromYear, toYear), ...repo.listHolidays()].sort(byDate);
    },
  };
}