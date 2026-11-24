// @vitest-environment jsdom
// tests/ui/notes-one-row-per-day.test.tsx
//
// Notes history: a sync writes a reading every time, so
// Sep 30 showed seven rows, six of them identical. The list now shows the last
// reading of each local day; nothing stored is removed.
process.env.TZ = "America/New_York";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import NotesHistorySection, { type NotesHistoryDataLayer } from "../../src/ui/NotesHistorySection";
import type { SnapshotHistoryEntry } from "../../src/domain/notes-types";
import type { Db } from "../../src/ui/lib/db";

afterEach(cleanup);

const reading = (id: string, asOf: string, drawableCents: number): SnapshotHistoryEntry =>
  ({ id, planId: "plan-1", asOf, drawableCents, burn3moCents: null, burn12moCents: null, note: "auto (post-sync)", createdAt: asOf }) as SnapshotHistoryEntry;

const layer = (snapshots: SnapshotHistoryEntry[]): Partial<NotesHistoryDataLayer> => ({
  loadDb: async () => ({}) as Db,
  listBudgetNotes: vi.fn(async () => [{ id: "n1", planId: "plan-1", kind: "note", text: "A note", status: "pending", monthlyCents: null, createdAt: "2026-09-15T00:00:00.000Z" }]) as never,
  listSnapshotHistory: vi.fn(async () => snapshots),
  listDataQualityFlags: vi.fn(async () => []),
});

test("one row per local day, the last reading of that day", async () => {
  render(
    <NotesHistorySection
      planId="plan-1"
      dataLayer={layer([
        reading("a", "2026-09-30T13:00:00.000Z", 100_00),
        reading("b", "2026-09-30T18:00:00.000Z", 200_00),
        reading("c", "2026-09-30T21:00:00.000Z", 300_00),
        reading("d", "2026-10-01T14:00:00.000Z", 400_00),
      ])}
    />
  );
  await screen.findByText("Oct 1, 2026");
  expect(screen.getAllByText("Sep 30, 2026").length).toBe(1);
  expect(screen.getByText("$300.00")).toBeTruthy();
  expect(screen.queryByText("$100.00")).toBeNull();
  expect(screen.queryByText("$200.00")).toBeNull();
});

test("a reading late on a local evening counts on that evening's day, not the next UTC day", async () => {
  render(
    <NotesHistorySection
      planId="plan-1"
      dataLayer={layer([
        reading("late", "2026-09-30T03:30:00.000Z", 500_00),
        reading("next", "2026-09-30T13:00:00.000Z", 600_00),
      ])}
    />
  );
  await screen.findByText("Sep 29, 2026");
  expect(screen.getByText("$500.00")).toBeTruthy();
  expect(screen.getByText("$600.00")).toBeTruthy();
});
