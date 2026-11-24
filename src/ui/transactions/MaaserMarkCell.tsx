// src/ui/transactions/MaaserMarkCell.tsx -- the two per-row charity pot marks, named with the pot's name.
// A gift row carries a switch, "Counts toward <pot>" (off = the row stays in Charity for spending and
// taxes but leaves the pot's ledger). An income row carries a choice, "Income for <pot>": All, None, or
// Part. Part opens a small box (the grid's rows have a fixed height, so nothing here may grow the row).
// A marked row shows a short tag so it can be found. Built from the Switch, Select, Popover, Input,
// Badge and Button already in src/components/ui (the registries hold no smaller control for this).
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { formatCents } from "../../domain/money";
import type { MaaserMark, MaaserMarkKind } from "../../domain/maaser-marks";
import type { MaaserRole } from "../../domain/maaser-pot";

/** null = no mark. */
export type MaaserMarkChoice = { kind: MaaserMarkKind; countedCents: number | null } | null;

type Mode = "all" | "none" | "part";
const MODES: { id: Mode; label: string }[] = [
  { id: "all", label: "All" },
  { id: "none", label: "None" },
  { id: "part", label: "Part" },
];

function modeOf(mark: MaaserMark | null): Mode {
  if (!mark || mark.kind !== "income") return "all";
  return mark.countedCents === null ? "none" : "part";
}

const partText = (mark: MaaserMark | null) => (mark?.countedCents != null ? String(Math.abs(mark.countedCents) / 100) : "");

export default function MaaserMarkCell({
  role,
  mark,
  amountCents,
  potName = "Charity",
  onSave,
}: {
  role: MaaserRole;
  mark: MaaserMark | null;
  amountCents: number;
  /** The pot's name as the user gave it. */
  potName?: string;
  onSave: (choice: MaaserMarkChoice) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [partError, setPartError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(modeOf(mark));
  const [part, setPart] = useState(partText(mark));
  const [partOpen, setPartOpen] = useState(false);
  useEffect(() => {
    setMode(modeOf(mark));
    setPart(partText(mark));
  }, [mark?.kind, mark?.countedCents]);

  const save = async (choice: MaaserMarkChoice): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await onSave(choice);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMode(modeOf(mark));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // One line only: the row is a fixed height, so a message is cut to the line and the full words ride in the title.
  const alert = error && (
    <p role="alert" title={error} className="min-w-0 truncate text-xs text-destructive">
      {error}
    </p>
  );

  if (role === "gift") {
    const counts = mark?.kind !== "not_maaser";
    return (
      <div data-testid="pot-mark-cell" className="flex items-center gap-2 py-1">
        <Switch
          size="sm"
          aria-label={`Counts toward ${potName}`}
          checked={counts}
          disabled={busy}
          onCheckedChange={(next) => void save(next ? null : { kind: "not_maaser", countedCents: null })}
        />
        {!counts && <Badge variant="secondary">Not counted</Badge>}
        {alert}
      </div>
    );
  }

  const choose = (next: Mode) => {
    setMode(next);
    if (next === "all") void save(null);
    else if (next === "none") void save({ kind: "income", countedCents: null });
    else setPartOpen(true);
  };
  const savePart = async () => {
    const dollars = Number(part.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setPartError("Enter the part that counts, in dollars.");
      return;
    }
    if (Math.round(dollars * 100) > Math.abs(amountCents)) {
      setPartError("The part that counts can be at most the row's amount.");
      return;
    }
    setPartError(null);
    if (await save({ kind: "income", countedCents: Math.round(dollars * 100) })) setPartOpen(false);
  };
  const tag = mark?.kind === "income" ? (mark.countedCents === null ? `Not income for ${potName}` : `Counts ${formatCents(mark.countedCents)}`) : null;

  return (
    <div data-testid="pot-mark-cell" className="flex items-center gap-2 py-1">
      <Select value={mode} onValueChange={(v) => choose(v as Mode)} items={MODES.map((m) => ({ value: m.id, label: m.label }))} disabled={busy}>
        <SelectTrigger size="sm" aria-label={`Income for ${potName}`} className="w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODES.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Popover
        open={partOpen}
        onOpenChange={(next) => {
          setPartOpen(next);
          if (next) setPartError(null);
        }}
      >
        <PopoverTrigger
          render={
            <Button variant="ghost" size="sm" className={mode === "part" ? "h-7 px-2" : "sr-only"} aria-label="Change the part that counts" tabIndex={mode === "part" ? 0 : -1} />
          }
        >
          {tag ?? "Set part"}
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-64 flex-col gap-2">
          <Input aria-label="Part that counts" inputMode="decimal" value={part} onChange={(e) => setPart(e.target.value)} />
          {partError && (
            <p role="alert" className="text-sm text-destructive">
              {partError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setPartOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void savePart()}>
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {mode !== "part" && tag && <Badge variant="secondary">{tag}</Badge>}
      {alert}
    </div>
  );
}
