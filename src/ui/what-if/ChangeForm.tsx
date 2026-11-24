// src/ui/what-if/ChangeForm.tsx
//
// The dialog for one change on the What if screen: Add a cost (a new or
// existing line), Change a cost and Cut a cost (an existing line, with its
// amount today beside the new one). It checks the change in the same plain
// words the server uses (changeProblem) and hands back a whole WhatIfChange.
// No start or end month: a
// new change stores next month and no end, an edited one keeps what it had, and
// nothing reads either.
//
// One-time cost: a name, an amount and the month it
// is paid, no budget line. That month is read: the Forecast counts it then, once.
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents, parseDollarsToCents } from "../../domain/money";
import { ONE_TIME_LINE, changeProblem, type ChangeKind, type WhatIfChange } from "../../domain/what-if";

export type FormKind = Extract<ChangeKind, "add" | "change" | "cut" | "one-time">;

const TITLES: Record<FormKind, string> = { add: "Add a cost", change: "Change a cost", cut: "Cut a cost", "one-time": "One-time cost" };
const HINTS: Record<FormKind, string> = {
  add: "A new cost a month, on a new line or one you already budget.",
  change: "Set a line you already budget to a new amount a month.",
  cut: "Lower a line you already budget, or cut it entirely.",
  "one-time": "A cost paid once, in one month. The Forecast counts it that month; it never counts toward a salary or the monthly budget.",
};

export interface ChangeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: FormKind;
  /** The change being edited, or null for a new one. */
  editing: WhatIfChange | null;
  /** The budget lines the user has today (expense lines only), sorted. */
  lines: string[];
  /** A line's amount a month today. */
  lineTodayCents: (line: string) => number;
  /** Next month, as YYYY-MM: stored on a new change, never read. */
  defaultFrom: string;
  /** The finished change. Its id and position are the caller's to set on a new one. */
  onSave: (change: Omit<WhatIfChange, "id" | "position">) => void;
  /** A save is running: the button waits. */
  busy?: boolean;
  /** Why the last save was refused, shown here so it is not hidden behind the dialog. */
  saveError?: string | null;
}

const centsText = (cents: number) => (cents / 100).toFixed(2);

export default function ChangeForm({ open, onOpenChange, kind, editing, lines, lineTodayCents, defaultFrom, onSave, busy = false, saveError = null }: ChangeFormProps) {
  const [label, setLabel] = useState("");
  const [line, setLine] = useState("");
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  // Each opening starts from the change being edited, or blank.
  useEffect(() => {
    if (!open) return;
    setLabel(editing?.label ?? "");
    setLine(editing?.planningCategory ?? "");
    setAmount(editing ? centsText(editing.amountCents) : "");
    setMonth(editing?.fromPeriod ?? defaultFrom);
    setProblem(null);
  }, [open, editing, defaultFrom]);

  const setsLine = kind === "change" || kind === "cut";
  const once = kind === "one-time";

  const submit = () => {
    let amountCents: number;
    if (amount.trim() === "") {
      if (kind !== "cut") return setProblem(kind === "add" ? "Type the amount a month." : once ? "Type the amount." : "Type the new amount.");
      amountCents = 0; // a blank cut is a cut to zero
    } else {
      try {
        amountCents = parseDollarsToCents(amount);
      } catch {
        return setProblem("Type the amount as dollars, for example 1,250.");
      }
    }
    const change = once
      ? { kind, label: label.trim(), planningCategory: ONE_TIME_LINE, amountCents, fromPeriod: month, untilPeriod: month, loan: null }
      : {
          kind,
          label: setsLine ? line : label.trim(),
          planningCategory: line.trim(),
          amountCents,
          fromPeriod: editing?.fromPeriod ?? defaultFrom,
          untilPeriod: editing?.untilPeriod ?? null,
          loan: null,
        };
    if (kind === "cut" && line && amountCents > lineTodayCents(line)) {
      return setProblem("A cut has to be lower than today's amount. Use Change a cost to raise a line.");
    }
    const p = changeProblem({ ...change, id: "draft", position: 0 });
    if (p) return setProblem(p);
    onSave(change);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.label}` : TITLES[kind]}</DialogTitle>
          <DialogDescription>{HINTS[kind]}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {!setsLine && (
            <div className="grid gap-1">
              <Label htmlFor="wi-label">{once ? "Name of the cost" : "Name of the change"}</Label>
              <Input id="wi-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={once ? "Wedding" : "New car"} />
            </div>
          )}

          {!once && (
          <div className="grid gap-1">
            <Label htmlFor="wi-line">Budget line</Label>
            {setsLine ? (
              <select
                id="wi-line"
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={line}
                onChange={(e) => setLine(e.target.value)}
              >
                <option value="">Pick a line</option>
                {lines.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <Input id="wi-line" list="wi-lines" value={line} onChange={(e) => setLine(e.target.value)} placeholder="A line you budget, or a new one" />
                <datalist id="wi-lines">
                  {lines.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </>
            )}
            {setsLine && line && (
              <span data-testid="line-today" className="text-xs text-muted-foreground">
                Today {formatCents(lineTodayCents(line))} a month
              </span>
            )}
          </div>
          )}

          <div className="grid gap-1">
            <Label htmlFor="wi-amount">{once ? "Amount, paid once" : setsLine ? "New amount a month" : "Amount a month"}</Label>
            <Input id="wi-amount" inputMode="decimal" className="font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={kind === "cut" ? "Blank cuts it entirely" : "0.00"} />
          </div>

          {once && (
            <div className="grid gap-1">
              <Label htmlFor="wi-month">Month it is paid</Label>
              <Input id="wi-month" type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          )}

          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          {!problem && saveError && (
            <p role="alert" className="text-sm text-destructive">
              Not saved: {saveError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {once ? (editing ? "Save cost" : "Add cost") : editing ? "Save change" : "Add change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
