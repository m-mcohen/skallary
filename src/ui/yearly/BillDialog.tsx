// src/ui/yearly/BillDialog.tsx -- add or change a yearly bill: its name, who it is paid to, the budget line,
// the months it is due and what it costs (blank when not known yet). Adding can also take the bill's monthly
// share out of its line, so the budget does not count it twice; nothing is saved until Save is pressed.
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatCents, parseDollarsToCents } from "../../domain/money";
import { monthlyShareCents, type YearlyBill } from "../../domain/yearly-costs";
import { addBillUI, updateBillUI, type BillInput } from "../lib/db-yearly";
import { MONTH_NAMES } from "./words";

export default function BillDialog({ initial, lines, lineMonthly, onClose, onSaved }: {
  initial?: YearlyBill;
  lines: string[];
  /** What each line's every-month budget is now, to say whether the share fits. */
  lineMonthly: Record<string, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [payee, setPayee] = useState(initial?.payeeKey ?? "");
  const [line, setLine] = useState(initial?.planningCategory ?? "");
  const [months, setMonths] = useState<string[]>(initial?.months ?? []);
  const [amount, setAmount] = useState(initial?.amountCents ? (initial.amountCents / 100).toFixed(2) : "");
  const [takeOut, setTakeOut] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  let cents: number | null = null;
  let amountBad = false;
  if (amount.trim()) {
    try {
      cents = parseDollarsToCents(amount);
      amountBad = cents <= 0;
    } catch {
      amountBad = true;
    }
  }
  const share = cents ? monthlyShareCents({ amountCents: cents, months }) : 0;
  const room = line ? lineMonthly[line] ?? 0 : 0;
  const tooBig = !initial && share > 0 && share > room;
  const takeOutNow = !initial && takeOut && !tooBig && share > 0;

  const save = async () => {
    if (savingRef.current) return;
    if (!label.trim()) return setError("Name the bill.");
    if (!payee.trim()) return setError("Say who it is paid to, as the name looks on your statement.");
    if (!line) return setError("Pick a budget line.");
    if (!months.length) return setError("Pick the months it is due.");
    if (amountBad) return setError("Enter an amount, like 600 or 600.00, or leave it blank if you do not know it yet.");
    const body: BillInput = { planningCategory: line, label: label.trim(), payeeKey: payee.trim(), accountId: initial?.accountId ?? null,
      amountCents: cents, months, ...(initial ? {} : { takeOutOfLine: takeOutNow }) };
    savingRef.current = true;
    setSaving(true);
    try {
      if (initial) await updateBillUI(initial.id, body);
      else await addBillUI(body);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Change this yearly bill" : "Add a yearly bill"}</DialogTitle>
          <DialogDescription>A bill that comes once a year or a few times a year. The budget plans for it in the month it is due.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>Name</span>
            <Input aria-label="Name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Car insurance" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Paid to</span>
            <Input aria-label="Paid to" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="The name on your statement" />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span>Budget line</span>
            <Select value={line || null} onValueChange={(v) => setLine(v as string)} items={lines.map((l) => ({ value: l, label: l }))}>
              <SelectTrigger aria-label="Budget line"><SelectValue placeholder="Pick a line" /></SelectTrigger>
              <SelectContent>
                {lines.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span>Months it is due</span>
            <ToggleGroup multiple aria-label="Months it is due" className="flex-wrap" value={months} onValueChange={(v: string[]) => setMonths([...v].sort())}>
              {MONTH_NAMES.map((name, i) => {
                const mm = String(i + 1).padStart(2, "0");
                return <ToggleGroupItem key={mm} value={mm} aria-label={name} variant="outline" size="sm">{name.slice(0, 3)}</ToggleGroupItem>;
              })}
            </ToggleGroup>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span>Amount each time</span>
            <Input aria-label="Amount each time" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Leave blank if not known yet" />
          </label>
          {!initial && share > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={takeOutNow} disabled={tooBig} onCheckedChange={(c) => setTakeOut(c === true)} aria-label="Take it out of the line" />
              <span>
                Take it out of the line
                <span className="block text-xs text-muted-foreground">
                  {tooBig
                    ? `Its share is ${formatCents(share)} a month, and the line budgets ${formatCents(room)} a month, so it cannot come out of the line.`
                    : `Lowers the line by ${formatCents(share)} a month, so the bill is not counted twice.`}
                </span>
              </span>
            </label>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
