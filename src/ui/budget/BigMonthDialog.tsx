// src/ui/budget/BigMonthDialog.tsx -- planned big months: a name, the line it is spent on, the month and the amount. Added from
// the Budget's top bar or a line's panel (line already picked); edited or deleted from
// the row's own menu; delete asks first. Months before this month cannot get one.
import { useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseDollarsToCents } from "../../domain/money";
import { formatPeriodLabel } from "../../domain/period";
import { addMonths } from "../../domain/scenario";
import type { BigMonth, Plan } from "../../domain/plan-types";
import type { Db } from "../lib/db";
import type { BudgetDataLayer } from "./useBudgetData";

export default function BigMonthDialog({ plan, today, lines, initial, presetLine, db, deps, onClose, onSaved }: {
  plan: Plan;
  today: string;
  lines: string[];
  initial?: BigMonth;
  presetLine?: string;
  db: Db;
  deps: BudgetDataLayer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const thisMonth = today.slice(0, 7);
  const months = useMemo(() => {
    const out: string[] = [];
    const start = thisMonth > plan.startDate.slice(0, 7) ? thisMonth : plan.startDate.slice(0, 7);
    for (let m = start; m <= plan.endDate.slice(0, 7); m = addMonths(m, 1)) out.push(m);
    return out;
  }, [plan, thisMonth]);
  const sorted = useMemo(() => [...new Set(lines)].sort((a, b) => a.localeCompare(b)), [lines]);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [line, setLine] = useState(initial?.planningCategory ?? presetLine ?? "");
  const [month, setMonth] = useState(initial?.month ?? months[0] ?? "");
  const [amount, setAmount] = useState(initial ? (initial.amountCents / 100).toFixed(2) : "");
  const [error, setError] = useState<string | null>(null);
  // One save at a time: a double-click must not add the big month twice (the ref holds
  // before the re-render that disables the button).
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const title = initial ? "Edit big month" : "Add a big month";

  const save = async () => {
    if (savingRef.current) return;
    if (!label.trim()) return setError("Name the big month.");
    if (!line) return setError("Pick a budget line.");
    if (!month) return setError("Pick a month.");
    let cents: number;
    try {
      cents = parseDollarsToCents(amount);
    } catch {
      return setError("Enter an amount, like 400 or 400.00.");
    }
    if (cents <= 0) return setError("Enter an amount, like 400 or 400.00.");
    const body = { planningCategory: line, month, label: label.trim(), amountCents: cents };
    savingRef.current = true;
    setSaving(true);
    try {
      if (initial) await deps.updateBigMonth(db, initial.id, body);
      else await deps.addBigMonth(db, plan.id, body);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>Name</span>
            <Input aria-label="Name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Holiday gifts" />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span>Line</span>
            <Select value={line || null} onValueChange={(v) => setLine(v as string)} items={sorted.map((l) => ({ value: l, label: l }))}>
              <SelectTrigger aria-label="Line">
                <SelectValue placeholder="Pick a line" />
              </SelectTrigger>
              <SelectContent>
                {sorted.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span>Month</span>
            <Select value={month || null} onValueChange={(v) => setMonth(v as string)} items={months.map((m) => ({ value: m, label: formatPeriodLabel(m) }))}>
              <SelectTrigger aria-label="Month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {formatPeriodLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span>Amount</span>
            <Input aria-label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteBigMonth({ big, db, deps, onClose, onDeleted }: { big: BigMonth; db: Db; deps: BudgetDataLayer; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {big.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            It comes off the budget for {formatPeriodLabel(big.month)}. What was spent does not change.
            {error && <span className="block text-destructive">{error}</span>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              try {
                await deps.deleteBigMonth(db, big.id);
                onDeleted();
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
