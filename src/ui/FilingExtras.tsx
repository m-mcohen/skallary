// src/ui/FilingExtras.tsx -- the picker's Note box and "This repeats". Lives in CategoryPicker's footer, inside the
// list, so using it cannot close the list. The list listens for Enter and the
// arrows on its own box only, so Enter in the Note box never files a category
// (tests/ui/FilingExtras.test.tsx pins that).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { Cadence } from "../domain/recurring";
import { CADENCE_LABELS } from "../domain/recurring-choices";
import { formatCents } from "../domain/money";
import { NOTE_MAX } from "../domain/categorizations";
import type { RepeatState } from "../domain/repeat-state";

export default function FilingExtras({
  note,
  onNote,
  repeat,
  showRepeat,
  repeats,
  onRepeats,
  cadence,
  onCadence,
  onlyAmount = false,
  onOnlyAmount,
}: {
  note: string;
  onNote: (s: string) => void;
  /** Null: the row could not be a bill, so no This repeats. */
  repeat: RepeatState | null;
  /** False while Transfer is the choice in the box (plan call 2). */
  showRepeat: boolean;
  repeats: boolean;
  onRepeats: (b: boolean) => void;
  cadence: Cadence;
  onCadence: (c: Cadence) => void;
  /** "Only charges of about $X": the mark covers this row's amount alone. */
  onlyAmount?: boolean;
  onOnlyAmount?: (b: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex flex-col gap-1">
        <Label htmlFor="filing-note" className="text-xs">
          Note
        </Label>
        <Input id="filing-note" value={note} maxLength={NOTE_MAX} onChange={(e) => onNote(e.target.value)} className="h-8 text-sm" />
      </div>
      {repeat && showRepeat && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={repeats} onChange={(e) => onRepeats(e.target.checked)} />
            This repeats
          </label>
          {repeats && (
            <select
              aria-label="How often"
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={cadence}
              onChange={(e) => onCadence(e.target.value as Cadence)}
            >
              {(Object.keys(CADENCE_LABELS) as Cadence[]).map((c) => (
                <option key={c} value={c}>
                  {CADENCE_LABELS[c]}
                </option>
              ))}
            </select>
          )}
          {repeats && onOnlyAmount && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={onlyAmount} onChange={(e) => onOnlyAmount(e.target.checked)} />
              Only charges of about {formatCents(repeat.amountCents)}
            </label>
          )}
        </div>
      )}
    </div>
  );
}
