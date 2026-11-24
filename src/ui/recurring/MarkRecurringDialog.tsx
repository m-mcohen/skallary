// src/ui/recurring/MarkRecurringDialog.tsx -- "Mark as recurring" on a
// transaction. Asks one thing, how often it repeats, with
// the app's guess preselected; says in one sentence what the choice does. A row
// that is already recurring gets a note and a link to the Recurring screen
// instead. A refused save keeps the dialog open with the server's own words.
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import type { Cadence } from "../../domain/recurring";
import { CADENCE_LABELS } from "../../domain/recurring-choices";
import { formatCents } from "../../domain/money";

export interface MarkRecurringTarget {
  /** The merchant as shown. */
  label: string;
  accountName: string;
  /** Set when the row already belongs to a recurring charge. */
  alreadyCadence: Cadence | null;
  /** The app's guess from this merchant's payments on this account; Every month when it has none. */
  guess: Cadence | null;
  /** This row's amount, for "Only charges of about $X". */
  amountCents: number;
}

export default function MarkRecurringDialog({
  target,
  busy,
  error,
  onSave,
  onClose,
}: {
  /** Null keeps the dialog closed. */
  target: MarkRecurringTarget | null;
  busy: boolean;
  error: string | null;
  onSave: (cadence: Cadence, onlyAmount: boolean) => void;
  onClose: () => void;
}) {
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [onlyAmount, setOnlyAmount] = useState(false);
  useEffect(() => {
    if (target) {
      setCadence(target.guess ?? "monthly");
      setOnlyAmount(false);
    }
  }, [target]);

  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {target && (
          <>
            <DialogHeader>
              <DialogTitle>
                {target.alreadyCadence ? `${target.label} is recurring` : `Mark ${target.label} as recurring?`}
              </DialogTitle>
              <DialogDescription>
                {target.alreadyCadence
                  ? `Already recurring, ${CADENCE_LABELS[target.alreadyCadence].toLowerCase()}.`
                  : `Charges from ${target.label} on ${target.accountName} will count as one recurring charge.`}
              </DialogDescription>
            </DialogHeader>
            {target.alreadyCadence ? (
              <p className="text-sm">
                <a href="#/recurring" className="text-primary underline-offset-4 hover:underline" onClick={onClose}>
                  Open Recurring
                </a>{" "}
                <span className="text-muted-foreground">to change it or to say it is not recurring.</span>
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="mark-recurring-cadence">How often</Label>
                <select
                  id="mark-recurring-cadence"
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as Cadence)}
                >
                  {(Object.keys(CADENCE_LABELS) as Cadence[]).map((c) => (
                    <option key={c} value={c}>
                      {CADENCE_LABELS[c]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={onlyAmount} onChange={(e) => setOnlyAmount(e.target.checked)} />
                  Only charges of about {formatCents(Math.abs(target.amountCents))}
                </label>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {target.alreadyCadence ? "Close" : "Cancel"}
              </Button>
              {!target.alreadyCadence && (
                <Button disabled={busy} onClick={() => onSave(cadence, onlyAmount)}>
                  Mark as recurring
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
