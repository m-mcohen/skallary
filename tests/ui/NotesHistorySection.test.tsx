// @vitest-environment jsdom
//
// The Notes & History panel. Mirrors GoalsSection.test.tsx's
// injected-data-layer pattern -- a stub NotesHistoryDataLayer, no live DB.
// Covers: decisions/trims/flags/snapshot render and the "unavailable" fallback.
import { afterEach, expect, test, vi } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";

import NotesHistorySection, { type NotesHistoryDataLayer } from "../../src/ui/NotesHistorySection";
import type { BudgetNote, SnapshotHistoryEntry, DataQualityFlag } from "../../src/domain/notes-types";
import type { Db } from "../../src/ui/lib/db";

afterEach(cleanup);

const NOTES: BudgetNote[] = [
  {
    id: "note-diy-search",
    planId: "plan-1",
    kind: "decision",
    text: "DIY search — no 5% buy-side retainer",
    status: "locked",
    monthlyCents: null,
    createdAt: "2026-06-30T00:00:00.000Z",
  },
  {
    id: "trim-linkedin",
    planId: "plan-1",
    kind: "trim",
    text: "LinkedIn cancelled",
    status: "committed",
    monthlyCents: -7788,
    createdAt: "2026-07-05T00:00:00.000Z",
  },
  {
    id: "trim-streaming",
    planId: "plan-1",
    kind: "trim",
    text: "Streaming subscriptions (Netflix/Spotify/Audible/Disney+/Crunchyroll)",
    status: "pending",
    monthlyCents: -8670,
    createdAt: "2026-07-05T00:00:00.000Z",
  },
];

const SNAPSHOTS: SnapshotHistoryEntry[] = [
  {
    id: "snapshot-2026-08-12",
    planId: "plan-1",
    asOf: "2026-08-12",
    drawableCents: 6225400,
    burn3moCents: 759100,
    burn12moCents: 815800,
    note: "Ported from BUDGET_LOG (pre-app baseline)",
    createdAt: "2026-08-12T00:00:00.000Z",
  },
];

const FLAGS: DataQualityFlag[] = [
  {
    id: "flag-a",
    planId: "plan-1",
    label: "$100 internal transfer miscoded as income",
    detail: null,
    status: "resolved",
    resolution: "Fixed in the app: the transfer no longer counts as income.",
    createdAt: "2026-08-12T00:00:00.000Z",
  },
  {
    id: "flag-b",
    planId: "plan-1",
    label: "$500 brokerage cash entry",
    detail: null,
    status: "resolved",
    resolution: "Already marked as a transfer, so it never counted as spending. Nothing to do.",
    createdAt: "2026-08-12T00:00:00.000Z",
  },
];

function makeStubDataLayer(opts: {
  notes?: BudgetNote[];
  snapshots?: SnapshotHistoryEntry[];
  flags?: DataQualityFlag[];
}) {
  let notes = opts.notes ?? [];
  let snapshots = opts.snapshots ?? [];
  let flags = opts.flags ?? [];

  const listBudgetNotes = vi.fn(async () => notes);
  const listSnapshotHistory = vi.fn(async () => snapshots);
  const listDataQualityFlags = vi.fn(async () => flags);

  const dataLayer: Partial<NotesHistoryDataLayer> = {
    loadDb: async () => ({}) as Db,
    listBudgetNotes,
    listSnapshotHistory,
    listDataQualityFlags,
  };
  return { dataLayer, listBudgetNotes, listSnapshotHistory, listDataQualityFlags };
}

test("renders seeded decisions, a trim's monthly savings, resolved flags, and the snapshot", async () => {
  const { dataLayer } = makeStubDataLayer({ notes: NOTES, snapshots: SNAPSHOTS, flags: FLAGS });
  const { findByText, getByText } = render(<NotesHistorySection planId="plan-1" dataLayer={dataLayer} />);

  await findByText("DIY search — no 5% buy-side retainer");
  expect(getByText("LinkedIn cancelled")).toBeTruthy();
  expect(getByText(/-\$77\.88/)).toBeTruthy(); // committed trim's monthly savings, via formatCents

  // Resolved data-quality flags render (not an open-status warning banner).
  expect(getByText("$100 internal transfer miscoded as income")).toBeTruthy();
  expect(getByText("Fixed in the app: the transfer no longer counts as income.")).toBeTruthy();
  expect(getByText("$500 brokerage cash entry")).toBeTruthy();

  // Snapshot history table.
  expect(getByText("Aug 12, 2026")).toBeTruthy();
  expect(getByText("$62,254.00")).toBeTruthy();
});

test("renders a neutral unavailable state headlessly when the db is unreachable", async () => {
  const dataLayer: Partial<NotesHistoryDataLayer> = {
    loadDb: async () => {
      throw new Error("no local server");
    },
  };
  const { findByText } = render(<NotesHistorySection planId="plan-1" dataLayer={dataLayer} />);
  await findByText("Not connected");
  expect(await findByText("No local database connection. The local server is not reachable. Restart the app.")).toBeTruthy();
});

test("with no planId, renders the unavailable/empty state without calling the data layer's list functions", async () => {
  const { dataLayer, listBudgetNotes } = makeStubDataLayer({});
  const { findByText } = render(<NotesHistorySection planId={null} dataLayer={dataLayer} />);
  await findByText("No plan selected");
  expect(listBudgetNotes).not.toHaveBeenCalled();
});

test("the snapshot table says Average spent, not Burn", async () => {
  const { dataLayer } = makeStubDataLayer({ notes: NOTES, snapshots: SNAPSHOTS, flags: FLAGS });
  const { findByText, queryByText } = render(<NotesHistorySection planId="plan-1" dataLayer={dataLayer} />);
  await findByText("Average spent, 3 months");
  await findByText("Average spent, 12 months");
  expect(queryByText("Burn (3mo)")).toBeNull();
  expect(queryByText("Burn (12mo)")).toBeNull();
  expect(document.body.textContent).not.toMatch(/drawable liquid|burn/i);
});

test("a timestamped snapshot shows its date only, and no internal wording reaches the screen", async () => {
  const stamped: SnapshotHistoryEntry[] = [
    { ...SNAPSHOTS[0], id: "snapshot-auto", asOf: "2026-09-22T15:52:35.527Z", note: "auto (post-sync)" },
    SNAPSHOTS[0],
  ];
  const { dataLayer } = makeStubDataLayer({ notes: NOTES, snapshots: stamped, flags: FLAGS });
  const { findByText, getByText, container } = render(<NotesHistorySection planId="plan-1" dataLayer={dataLayer} />);
  await findByText("Sep 22, 2026");
  expect(getByText("After a sync")).toBeTruthy();
  expect(getByText("Starting point, before the app")).toBeTruthy();
  expect(getByText("Fixed in the app: the transfer no longer counts as income.")).toBeTruthy();
  expect(getByText("Already marked as a transfer, so it never counted as spending. Nothing to do.")).toBeTruthy();
  const text = container.textContent ?? "";
  expect(text).not.toMatch(/T15:/);
  expect(text).not.toMatch(/BUDGET_LOG|is_transfer|transaction_adjustments/);
});
