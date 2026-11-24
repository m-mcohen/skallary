// src/ui/budget/LineNote.tsx -- a note on one line for one month, so a big purchase that makes the month read as over
// budget can say why. An empty note deletes it. 200 characters.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatPeriodLabel } from "../../domain/period";

export const NOTE_MAX = 200;

export default function LineNote({ month, note, onSave }: { month: string; note: string | null; onSave: (text: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const label = `Note for ${formatPeriodLabel(month)}`;
  if (!editing) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        {note && <p className="text-sm">{note}</p>}
        <Button variant="outline" size="sm" className="self-start" onClick={() => setEditing(true)}>
          {note ? "Edit note" : "Add note"}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium" htmlFor="line-note">
        {label}
      </label>
      <Textarea id="line-note" aria-label={label} maxLength={NOTE_MAX} value={text} onChange={(e) => setText(e.target.value)} />
      <span className="text-xs text-muted-foreground">
        {text.length} of {NOTE_MAX} characters
      </span>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={async () => {
            try {
              await onSave(text.trim());
              setEditing(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Save note
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setText(note ?? "");
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
