// src/ui/transactions/RecentCategorizations.tsx -- the last 30 days of filings,
// newest first, each with Undo. Built on the
// installed registry Sheet. Older lines stay in the table but are not shown.
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { filingScope, type CategorizationLogEntry } from "../../domain/categorizations";
import { formatShortDate, localDateIso } from "../../domain/period";

export default function RecentCategorizations({
  open,
  onOpenChange,
  load,
  undo,
  onUndone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  load: () => Promise<CategorizationLogEntry[]>;
  undo: (id: number) => Promise<{ undone: boolean }>;
  /** After an Undo, so the screen behind re-reads its rows. */
  onUndone: () => void;
}) {
  const [entries, setEntries] = useState<CategorizationLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEntries(await load());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  useEffect(() => {
    if (open) void refresh();
    // Read once per opening; `load` is a new function on every render of the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const press = async (id: number) => {
    setBusy(id);
    setError(null);
    try {
      await undo(id);
      onUndone();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto motion-reduce:transition-none">
        <SheetHeader>
          <SheetTitle>Recent categorizations</SheetTitle>
          <SheetDescription>
            What you filed in the last 30 days, newest first. Undo puts the categories back the way they were; notes stay.
          </SheetDescription>
        </SheetHeader>
        {error && (
          <p role="alert" className="px-4 text-sm text-destructive">
            {error}
          </p>
        )}
        {entries && entries.length === 0 && <p className="px-4 text-sm text-muted-foreground">Nothing filed in the last 30 days.</p>}
        {entries && entries.length > 0 && (
          <ul className="flex flex-col divide-y px-4 pb-4">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs text-muted-foreground">{formatShortDate(localDateIso(new Date(e.createdAt)))}</span>
                  <span className="truncate font-medium">{e.label}</span>
                  <span>{`${e.fromCategory} → ${e.toCategory}`}</span>
                  <span className="text-xs text-muted-foreground">{filingScope(e)}</span>
                </div>
                {e.undoneAt ? (
                  <span className="shrink-0 pt-1 text-xs text-muted-foreground">Undone</span>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy === e.id} aria-label={`Undo ${e.label}`} onClick={() => void press(e.id)}>
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
