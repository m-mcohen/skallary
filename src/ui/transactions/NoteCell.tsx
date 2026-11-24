// src/ui/transactions/NoteCell.tsx -- the user's note on one transaction. A small icon: plain when empty, filled when there is a
// note. Hovering shows the note (the button's title); a click or tap opens a small
// editor with Save and Cancel, on the registry Popover the help points use.
import { useState } from "react";
import { StickyNoteIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

import { NOTE_MAX } from "../../domain/categorizations";

export default function NoteCell({ note, onSave }: { note: string | null; onSave: (note: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filled = !!note;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(note ?? "");
          setError(null);
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={`size-7 ${filled ? "text-primary" : "text-foreground"}`}
            aria-label={filled ? `Note: ${note}` : "Add a note"}
            title={filled ? note : "Add a note"}
            data-filled={filled ? "true" : "false"}
          />
        }
      >
        <StickyNoteIcon className={`size-3.5 ${filled ? "fill-current" : ""}`} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-2">
        <Textarea aria-label="Note" value={draft} maxLength={NOTE_MAX} rows={3} onChange={(e) => setDraft(e.target.value)} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
