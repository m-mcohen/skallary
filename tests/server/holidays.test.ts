import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Holiday, HolidayCalendar } from "../../src/domain/holidays.js";

let server: Server;
let base: string;
let folder: string;
let closeDb: () => void;

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "toy-holidays-"));
  vi.stubEnv("LOCALAPPDATA", folder);
  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  const db = openRepo().connection();
  closeDb = () => db.close();
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  closeDb?.();
  vi.unstubAllEnvs();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const event = (name: string, start: string) =>
  ["BEGIN:VEVENT", "SUMMARY:" + name, "DTSTART:" + start, "END:VEVENT"].join("\r\n");

function postCalendar(name: string, events: string[], calendarId?: string) {
  const params = new URLSearchParams({ name });
  if (calendarId) params.set("calendarId", calendarId);
  return fetch(base + "/holiday-calendars/import?" + params, {
    method: "POST",
    headers: { "Content-Type": "text/calendar" },
    body: ["BEGIN:VCALENDAR", ...events, "END:VCALENDAR"].join("\r\n"),
  });
}

async function holidays() {
  const response = await fetch(base + "/holidays?from=2027-01&to=2029-12");
  expect(response.status).toBe(200);
  return await response.json() as Holiday[];
}

test("a large calendar import keeps older dates on re-import and refuses an empty replacement", async () => {
  const name = "Toy festivals";
  const filler = Array.from({ length: 3000 }, (_, i) => event(`Toy ${i} day`, "20281201"));
  const first = await postCalendar(name, [
    event("Spring Festival", "20270330"), event("Spring Festival", "20280418"), ...filler,
  ]);
  expect(first.status).toBe(200);
  const { calendar } = await first.json() as { calendar: HolidayCalendar };
  const timed = event("Evening gathering", "20290406T200000");
  const next = await postCalendar(name, [
    event("Spring Festival", "20280417"), event("Spring Festival", "20290406"), timed,
  ], calendar.id);
  expect(next.status).toBe(200);
  expect((await next.json()).problems).toHaveLength(1);
  const days = (await holidays()).filter(h => h.calendarId === calendar.id);
  expect(days.map(h => h.start)).toEqual(["2027-03-30", "2028-04-17", "2029-04-06"]);
  const list = () => fetch(base + "/holiday-calendars").then(r => r.json());
  const before = await list();
  expect((await postCalendar(name, [timed], calendar.id)).status).toBe(400);
  expect((await postCalendar("Another toy calendar", [timed])).status).toBe(400);
  expect((await holidays()).filter(h => h.calendarId === calendar.id)).toEqual(days);
  expect(await list()).toEqual(before);
});

test("calendar switches filter the holiday list and a raise keeps its calendar", async () => {
  const first = await postCalendar("Toy fair", [event("Toy fair day", "20270511")]);
  expect(first.status).toBe(200);
  const { calendar } = await first.json() as { calendar: HolidayCalendar };
  const calendars = await (await fetch(base + "/holiday-calendars")).json() as HolidayCalendar[];
  expect(calendars[0]).toMatchObject({ id: "us-national", on: false });
  const setOn = (id: string, on: boolean) => fetch(base + "/holiday-calendars/" + id, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }),
  });
  expect((await holidays()).some(h => h.calendarId === "us-national")).toBe(false);
  expect((await setOn("us-national", true)).ok).toBe(true);
  expect((await holidays()).some(h => h.key === "thanksgiving-day")).toBe(true);
  expect((await setOn(calendar.id, false)).ok).toBe(true);
  expect((await holidays()).some(h => h.calendarId === calendar.id)).toBe(false);
  const { yearlyCostsRepository } = await import("../../server/repositories/yearlyCostsRepository.js");
  yearlyCostsRepository().addRaise({
    planningCategory: "Groceries", label: "Toy fair", amountCents: 25000,
    when: { kind: "holiday", calendarId: calendar.id, holidayKey: "toy-fair-day", countIn: "start" },
  });
  expect((await fetch(base + "/holiday-calendars/" + calendar.id, { method: "DELETE" })).status).toBe(400);
});

test("a file whose repeats would pass the limit is refused and the calendar is unchanged", async () => {
  const first = await postCalendar("Toy limit", [event("Toy limit day", "20270601")]);
  const { calendar } = await first.json() as { calendar: HolidayCalendar };
  const list = () => fetch(base + "/holiday-calendars").then(r => r.json());
  const before = await list();
  const days = (await holidays()).filter(h => h.calendarId === calendar.id);
  const endless = (i: number) => ["BEGIN:VEVENT", "SUMMARY:Toy repeat " + i, "DTSTART:20270601",
    "RRULE:FREQ=YEARLY;COUNT=9000", "END:VEVENT"].join("\r\n");
  const many = Array.from({ length: 700 }, (_, i) => endless(i)); // 700 x 10 years = 7,000 dates
  const response = await postCalendar("Toy limit", many, calendar.id);
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("5,000");
  expect((await holidays()).filter(h => h.calendarId === calendar.id)).toEqual(days);
  expect(await list()).toEqual(before);
});
