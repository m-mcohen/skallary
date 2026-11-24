import { describe, it, expect } from "vitest";
import { planFetchWindows, MAX_WINDOW_DAYS, OVERLAP_DAYS, MAX_WINDOWS_PER_SYNC } from "../../src/domain/simplefin";

const iso = (epoch: number) => new Date(epoch * 1000).toISOString().slice(0, 10);
const NOW = Date.parse("2026-09-02T12:00:00.000Z") / 1000;

describe("planFetchWindows -- incremental", () => {
  it("re-fetches an overlap before the last sync instead of resuming exactly where it stopped", () => {
    // The Bridge filters on the transaction date, and a pending row's date
    // moves when it settles, so resuming at exactly lastSyncedAt drops rows.
    // Upserts are keyed by transaction id, so re-sending is free.
    const windows = planFetchWindows({ now: NOW, lastSyncedAt: "2026-09-01T00:00:00.000Z", earliestBackfilled: "2024-09-01" });
    expect(windows).toHaveLength(1);
    expect(iso(windows[0].startDate)).toBe("2026-08-27"); // 5 days before
    expect(OVERLAP_DAYS).toBe(5);
  });

  it("always sends an explicit start-date -- without one the Bridge returns only since yesterday", () => {
    // Verified live: the demo response carries the message
    // "Provide a 'start-date' parameter to receive transactions prior to yesterday".
    const windows = planFetchWindows({ now: NOW, lastSyncedAt: "2026-09-02T00:00:00.000Z", earliestBackfilled: "2024-09-01" });
    expect(windows.every((w) => typeof w.startDate === "number")).toBe(true);
  });

  it("splits a long gap since the last sync into windows within the 90-day cap", () => {
    // Someone reopens the app after six months away.
    const windows = planFetchWindows({ now: NOW, lastSyncedAt: "2026-01-01T00:00:00.000Z", earliestBackfilled: "2024-09-01" });
    expect(windows.length).toBeGreaterThan(1);
    for (const w of windows) {
      const days = (w.endDate - w.startDate) / 86400;
      expect(days).toBeLessThanOrEqual(MAX_WINDOW_DAYS);
    }
    // Contiguous and in chronological order, oldest first.
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].startDate).toBe(windows[i - 1].endDate);
    }
    expect(windows[windows.length - 1].endDate).toBeGreaterThanOrEqual(NOW);
  });
});

describe("planFetchWindows -- first run", () => {
  it("walks back as far as the call budget allows when nothing has synced yet", () => {
    const windows = planFetchWindows({ now: NOW, lastSyncedAt: null, earliestBackfilled: null });
    expect(windows.length).toBeGreaterThanOrEqual(8);
    for (const w of windows) {
      expect((w.endDate - w.startDate) / 86400).toBeLessThanOrEqual(MAX_WINDOW_DAYS);
    }
    // This used to assert the oldest window reached back two full years. It
    // can't: BACKFILL_MONTHS asks for 720 days but the call budget only
    // reaches MAX_WINDOWS_PER_SYNC x MAX_WINDOW_DAYS = 540, and the walk goes
    // oldest-first -- so honouring the two-year figure meant the walk ran out
    // 180 days short of TODAY and a first sync fetched nothing. The reachable
    // span is what's real; a later sync extends further back from
    // earliestBackfilled.
    const spanDays = (NOW - windows[0].startDate) / 86400;
    expect(spanDays).toBeLessThanOrEqual(MAX_WINDOWS_PER_SYNC * MAX_WINDOW_DAYS);
    expect(windows[windows.length - 1].endDate).toBeGreaterThanOrEqual(NOW);
  });

  it("stays inside the Bridge's 24-calls-a-day budget", () => {
    // Exceeding the rate limit gets the access token disabled, so the backfill
    // is capped rather than allowed to walk arbitrarily far back.
    const windows = planFetchWindows({ now: NOW, lastSyncedAt: null, earliestBackfilled: null });
    expect(windows.length).toBeLessThanOrEqual(12);
  });
});

describe("planFetchWindows -- resuming a backfill", () => {
  it("continues from where the previous backfill stopped rather than re-walking history", () => {
    const windows = planFetchWindows({ now: NOW, lastSyncedAt: "2026-09-01T00:00:00.000Z", earliestBackfilled: "2026-06-01" });
    // Still fetches the recent overlap...
    expect(windows.some((w) => iso(w.endDate) >= "2026-09-02")).toBe(true);
    // ...and does not re-request anything older than what's already backfilled.
    expect(windows.every((w) => iso(w.startDate) >= "2026-05-27")).toBe(true);
  });
});

describe("planFetchWindows -- reaching the present", () => {
  it("always requests up to now, even when the horizon exceeds what the cap can walk", () => {
    // The bug this pins: BACKFILL_MONTHS asks for 720 days but
    // MAX_WINDOWS_PER_SYNC x MAX_WINDOW_DAYS can only walk 540, and the walk
    // goes oldest-first -- so a first sync requested 2024-09..2026-03 and
    // never asked for the most recent 180 days. A fresh install fetched
    // nothing and looked broken. Recent history is the part that matters, so
    // the window walk is clamped to end at now.
    const now = Math.floor(Date.parse("2026-09-02T00:00:00Z") / 1000);
    const windows = planFetchWindows({ now, lastSyncedAt: null, earliestBackfilled: null });
    const last = windows[windows.length - 1];
    expect(last.endDate).toBeGreaterThanOrEqual(now);
  });

  it("still walks back as far as the cap allows", () => {
    const now = Math.floor(Date.parse("2026-09-02T00:00:00Z") / 1000);
    const windows = planFetchWindows({ now, lastSyncedAt: null, earliestBackfilled: null });
    const spanDays = (now - windows[0].startDate) / 86_400;
    expect(spanDays).toBeGreaterThanOrEqual(MAX_WINDOWS_PER_SYNC * MAX_WINDOW_DAYS - 1);
  });
});
