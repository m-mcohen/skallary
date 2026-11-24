// src/ui/NotesHistorySection.tsx
//
// The Notes & History panel: a read-mostly view of the budget notes, the
// resolved data-quality flags and the point-in-time drawable/burn snapshot
// history. Nothing is seeded here; the rows come from the person's own
// budget and from each bank sync.
//
// Registry-first (see the ui-registries skill): every primitive here
// (@shadcn/alert, @shadcn/card, @shadcn/badge, @shadcn/table, @shadcn/skeleton)
// is already installed in this repo (GoalsSection.tsx),
// no new `npx shadcn@latest add` needed. Data layer is injected via the
// `dataLayer` prop, same shape as GoalsSection.tsx, so
// this file has no hard dependency on a live server connection.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, LockIcon, ScissorsIcon } from "lucide-react";

import {
  loadDb,
  listBudgetNotesUI,
  listSnapshotHistoryUI,
  listDataQualityFlagsUI,
  type Db,
} from "./lib/db";
import type { BudgetNote, SnapshotHistoryEntry, DataQualityFlag } from "../domain/notes-types";
import { formatCents } from "../domain/money";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatSnapshotDate, plainFlagResolution, plainSnapshotNote } from "../domain/account-display";

// ---------------------------------------------------------------------------
// Injectable data layer (mirrors GoalsSection.tsx's GoalsDataLayer)
// ---------------------------------------------------------------------------

export interface NotesHistoryDataLayer {
  loadDb: () => Promise<Db>;
  listBudgetNotes: (db: Db, planId: string) => Promise<BudgetNote[]>;
  listSnapshotHistory: (db: Db, planId: string) => Promise<SnapshotHistoryEntry[]>;
  listDataQualityFlags: (db: Db, planId: string) => Promise<DataQualityFlag[]>;
}

const defaultDataLayer: NotesHistoryDataLayer = {
  loadDb,
  listBudgetNotes: listBudgetNotesUI,
  listSnapshotHistory: listSnapshotHistoryUI,
  listDataQualityFlags: listDataQualityFlagsUI,
};

export interface NotesHistorySectionProps {
  planId?: string | null;
  /** Override any subset of the data layer (tests inject stubs; App.tsx uses the default). */
  dataLayer?: Partial<NotesHistoryDataLayer>;
}

type Phase = "loading" | "unavailable" | "no-plan" | "ready" | "error";

/**
 * One row per local day, the day's last reading, newest first: every sync writes a reading, so one day could fill seven rows.
 * Display only; every stored reading stays.
 */
export function lastReadingPerDay(snapshots: SnapshotHistoryEntry[]): SnapshotHistoryEntry[] {
  const byDay = new Map<string, SnapshotHistoryEntry>();
  for (const s of [...snapshots].sort((x, y) => y.asOf.localeCompare(x.asOf))) {
    const day = formatSnapshotDate(s.asOf);
    if (!byDay.has(day)) byDay.set(day, s);
  }
  return [...byDay.values()];
}

export default function NotesHistorySection({ planId, dataLayer }: NotesHistorySectionProps) {
  const deps = useMemo<NotesHistoryDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);
  const effectivePlanId = planId ?? null;

  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<BudgetNote[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotHistoryEntry[]>([]);
  const [flags, setFlags] = useState<DataQualityFlag[]>([]);

  const fetchAll = useCallback(
    async (handle: Db, id: string) => {
      const [n, s, f] = await Promise.all([
        deps.listBudgetNotes(handle, id),
        deps.listSnapshotHistory(handle, id),
        deps.listDataQualityFlags(handle, id),
      ]);
      setNotes(n);
      setSnapshots(s);
      setFlags(f);
      return { n, s, f };
    },
    [deps]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setPhase("loading");

      if (!effectivePlanId) {
        if (!cancelled) setPhase("no-plan");
        return;
      }

      let handle: Db;
      try {
        handle = await deps.loadDb();
      } catch {
        // Expected when the local Node server is unreachable (headless build / preview).
        if (!cancelled) setPhase("unavailable");
        return;
      }
      if (cancelled) return;

      try {
        await fetchAll(handle, effectivePlanId);
        if (cancelled) return;

        setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setErrorMessage(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Data layer only meaningfully changes identity across remounts in this app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePlanId]);

  const decisions = useMemo(() => notes.filter((n) => n.kind === "decision"), [notes]);
  const trims = useMemo(() => notes.filter((n) => n.kind === "trim"), [notes]);
  const committedTrims = useMemo(() => trims.filter((t) => t.status === "committed"), [trims]);
  const pendingTrims = useMemo(() => trims.filter((t) => t.status !== "committed"), [trims]);
  const openFlags = useMemo(() => flags.filter((f) => f.status === "open"), [flags]);
  const resolvedFlags = useMemo(() => flags.filter((f) => f.status !== "open"), [flags]);

  let body: React.ReactNode;
  if (phase === "loading") {
    body = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  } else if (phase === "unavailable") {
    body = (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>
          No local database connection. The local server is not reachable. Restart the app.
        </AlertDescription>
      </Alert>
    );
  } else if (phase === "no-plan") {
    body = (
      <Alert>
        <AlertTitle>No plan selected</AlertTitle>
        <AlertDescription>Select a plan to see its migrated decisions, trims, and history.</AlertDescription>
      </Alert>
    );
  } else if (phase === "error") {
    body = (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load notes &amp; history</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {openFlags.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Data-quality flags need attention</AlertTitle>
            <AlertDescription>
              <ul className="flex flex-col gap-1">
                {openFlags.map((f) => (
                  <li key={f.id}>{f.label}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LockIcon className="size-4" />
                Locked decisions
              </CardTitle>
              <CardDescription>Decisions kept from the budget log.</CardDescription>
            </CardHeader>
            <CardContent>
              {decisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {decisions.map((d) => (
                    <li key={d.id} className="flex items-start justify-between gap-2 text-sm">
                      <span>{d.text}</span>
                      <Badge variant="outline" className="shrink-0">
                        {d.status ?? "locked"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ScissorsIcon className="size-4" />
                Spend trims
              </CardTitle>
              <CardDescription>Committed savings vs. trims still pending a decision.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <h3 className="mb-1 text-xs font-medium uppercase text-muted-foreground">Committed</h3>
                {committedTrims.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {committedTrims.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <span>{t.text}</span>
                        {t.monthlyCents != null && (
                          <span className="shrink-0 font-medium tabular-nums text-positive">
                            {formatCents(t.monthlyCents)}/mo
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-1 text-xs font-medium uppercase text-muted-foreground">Pending</h3>
                {pendingTrims.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None pending.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {pendingTrims.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <span>{t.text}</span>
                        {t.monthlyCents != null && (
                          <span className="shrink-0 font-medium tabular-nums text-muted-foreground">
                            {formatCents(t.monthlyCents)}/mo
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Snapshot history</CardTitle>
            <CardDescription>Point-in-time Drawable and average spending readings.</CardDescription>
          </CardHeader>
          <CardContent>
            {snapshots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No snapshots recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>As of</TableHead>
                      <TableHead className="text-right">Drawable</TableHead>
                      <TableHead className="text-right">Average spent, 3 months</TableHead>
                      <TableHead className="text-right">Average spent, 12 months</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lastReadingPerDay(snapshots).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{formatSnapshotDate(s.asOf)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {s.drawableCents != null ? formatCents(s.drawableCents) : ""}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {s.burn3moCents != null ? formatCents(s.burn3moCents) : ""}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {s.burn12moCents != null ? formatCents(s.burn12moCents) : ""}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{plainSnapshotNote(s.note)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2Icon className="size-4 text-positive" />
              Data-quality flags, resolved
            </CardTitle>
            <CardDescription>Problems found in the old budget log, now resolved.</CardDescription>
          </CardHeader>
          <CardContent>
            {resolvedFlags.length === 0 ? (
              <p className="text-sm text-muted-foreground">No resolved flags on record.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {resolvedFlags.map((f) => (
                  <li key={f.id} className="text-sm">
                    <div className="font-medium">{f.label}</div>
                    {f.resolution && <div className="text-muted-foreground">{plainFlagResolution(f.id, f.resolution)}</div>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-base font-semibold">Notes &amp; History</h2>
        <p className="text-sm text-muted-foreground">
          Decisions already made, spending trims, resolved data problems, and the history of readings.
        </p>
      </div>
      {body}
    </div>
  );
}
