// src/ui/goals/StartCostDialog.tsx -- the one confirmation behind Start this cost
// and Mark complete.
// It asks once, names the line and the month, and lets the user put the cost on a new
// line (named after the goal by default) or add it to a line the user already has.
//
// App-specific business UI wired to the user's data, so no registry search: the app's
// own Dialog, Input, Label, Alert and Button.
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { formatWholeDollars } from "../../domain/money";
import { formatPeriodLabel, localDateIso } from "../../domain/period";
import type { Goal } from "../../domain/plan-types";

export interface StartCostDialogProps {
  open: boolean;
  goal: Goal | null;
  /** Budget lines the user already has, for "Add to an existing line". */
  existingLines: string[];
  /** Opened from Mark complete: Not now still marks the goal complete. */
  markingComplete: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (req: { line: string; mode: "new" | "existing" }) => void;
  onNotNow: () => void;
  onOpenChange: (open: boolean) => void;
}

export default function StartCostDialog({ open, goal, existingLines, markingComplete, busy, error, onConfirm, onNotNow, onOpenChange }: StartCostDialogProps) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [newName, setNewName] = useState("");
  const [existing, setExisting] = useState("");

  // A fresh start each time it opens: the goal's name as the new line.
  useEffect(() => {
    if (open && goal) {
      setMode("new");
      setNewName(goal.name);
      setExisting(existingLines[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id]);

  // Keep a sensible pick once the lines arrive.
  useEffect(() => {
    if (!existing && existingLines.length > 0) setExisting(existingLines[0]);
  }, [existingLines, existing]);

  if (!goal) return null;
  const line = mode === "new" ? newName.trim() : existing;
  const cost = formatWholeDollars(goal.ongoingMonthlyCents ?? 0);
  const month = formatPeriodLabel(localDateIso().slice(0, 7));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{markingComplete ? `Mark ${goal.name} complete` : `Start ${goal.name}'s cost`}</DialogTitle>
          <DialogDescription>
            {mode === "existing"
              ? `Add ${cost} a month to your ${line || "chosen"} line, starting ${month}?`
              : `Add ${line || "this cost"} ${cost} a month to your budget, starting ${month}?`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">Earlier months keep their budget. To stop or change it later, edit the line on the Budget screen.</p>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Which budget line</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="start-cost-mode" checked={mode === "new"} onChange={() => setMode("new")} />
              New line
            </label>
            {mode === "new" && (
              <div className="flex flex-col gap-1 pl-6">
                <Label htmlFor="start-cost-line">Budget line name</Label>
                <Input id="start-cost-line" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
            )}
            <label className="flex items-center gap-2">
              <input type="radio" name="start-cost-mode" checked={mode === "existing"} disabled={existingLines.length === 0} onChange={() => setMode("existing")} />
              Add to an existing line
            </label>
            {mode === "existing" && (
              <div className="flex flex-col gap-1 pl-6">
                <Label htmlFor="start-cost-existing">Existing budget line</Label>
                <select
                  id="start-cost-existing"
                  className="h-9 rounded-md border bg-background px-2"
                  value={existing}
                  onChange={(e) => setExisting(e.target.value)}
                >
                  {existingLines.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          {/* Cancel writes nothing (as do Escape and the X). Not now exists only where it
              means something else: Mark complete, where it completes the goal alone. */}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {markingComplete && (
            <Button variant="outline" onClick={onNotNow} disabled={busy}>
              Not now
            </Button>
          )}
          <Button onClick={() => onConfirm({ line, mode })} disabled={busy || !line}>
            {busy ? "Adding..." : "Add to budget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
