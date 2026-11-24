// src/ui/yearly/RaiseDialog.tsx -- add or change a raise: extra money a line needs in a month, once, every
// year in the same month, or around a holiday. The next 12 months are listed with the holidays from the
// calendars that are switched on; pick a month or a holiday from the list. A holiday that crosses two months
// asks which month to count it in. Nothing is saved until Save is pressed.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { holidayMonths, type Holiday } from "../../domain/holidays";
import { parseDollarsToCents } from "../../domain/money";
import { formatPeriodLabel, localDateIso } from "../../domain/period";
import { addMonths } from "../../domain/scenario";
import type { Raise, RaiseWhen } from "../../domain/yearly-costs";
import { addRaiseUI, getHolidaysUI, updateRaiseUI, type RaiseInput } from "../lib/db-yearly";
import { monthName, prettyKey } from "./words";

type Kind = RaiseWhen["kind"];
interface Picked { calendarId: string; holidayKey: string; name: string; start: string; end: string }

export default function RaiseDialog({ initial, lines, onClose, onSaved }: {
  initial?: Raise;
  lines: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const thisMonth = localDateIso().slice(0, 7);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [line, setLine] = useState(initial?.planningCategory ?? "");
  const [amount, setAmount] = useState(initial ? (initial.amountCents / 100).toFixed(2) : "");
  const [kind, setKind] = useState<Kind>(initial?.when.kind ?? "once");
  const [month, setMonth] = useState(initial?.when.kind === "once" ? initial.when.month : thisMonth);
  const [monthOfYear, setMonthOfYear] = useState(initial?.when.kind === "every-year" ? initial.when.monthOfYear : thisMonth.slice(5));
  const [holiday, setHoliday] = useState<Picked | null>(initial?.when.kind === "holiday"
    ? { calendarId: initial.when.calendarId, holidayKey: initial.when.holidayKey, name: prettyKey(initial.when.holidayKey), start: "", end: "" } : null);
  const [countIn, setCountIn] = useState<"start" | "end">(initial?.when.kind === "holiday" ? initial.when.countIn : "start");
  const [days, setDays] = useState<Holiday[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getHolidaysUI(thisMonth, addMonths(thisMonth, 12)).then((h) => { if (!cancelled) setDays(h); }).catch(() => { if (!cancelled) setDays([]); });
    return () => { cancelled = true; };
  }, [thisMonth]);
  const list = useMemo(() => holidayMonths(days ?? [], thisMonth, 12), [days, thisMonth]);
  const crosses = holiday !== null && holiday.start !== "" && holiday.start.slice(0, 7) !== holiday.end.slice(0, 7);

  const save = async () => {
    if (savingRef.current) return;
    if (!label.trim()) return setError("Name the raise.");
    if (!line) return setError("Pick a budget line.");
    let cents: number;
    try {
      cents = parseDollarsToCents(amount);
    } catch {
      return setError("Enter an amount, like 300 or 300.00.");
    }
    if (cents <= 0) return setError("Enter an amount, like 300 or 300.00.");
    let when: RaiseWhen;
    if (kind === "once") when = { kind, month };
    else if (kind === "every-year") when = { kind, monthOfYear };
    else if (holiday) when = { kind, calendarId: holiday.calendarId, holidayKey: holiday.holidayKey, countIn: crosses || holiday.start === "" ? countIn : "start" };
    else return setError("Pick a holiday from the list.");
    const body: RaiseInput = { planningCategory: line, label: label.trim(), amountCents: cents, when };
    savingRef.current = true;
    setSaving(true);
    try {
      if (initial) await updateRaiseUI(initial.id, body);
      else await addRaiseUI(body);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      savingRef.current = false;
      setSaving(false);
    }
  };

  const chosen = kind === "once" ? formatPeriodLabel(month)
    : kind === "every-year" ? `Every ${monthName(monthOfYear)}`
    : holiday ? (days?.find((d) => d.calendarId === holiday.calendarId && d.key === holiday.holidayKey)?.name ?? holiday.name) : "No holiday picked yet";
  const noHolidays = days !== null && days.length === 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Change this raise" : "Add a raise"}</DialogTitle>
          <DialogDescription>Extra money a budget line needs in a month, on top of its usual amount.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>Name</span>
            <Input aria-label="Name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Holiday gifts" />
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
          <label className="flex flex-col gap-1 text-sm">
            <span>Amount</span>
            <Input aria-label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span>When</span>
            <ToggleGroup aria-label="When" value={[kind]} onValueChange={(v: string[]) => v[0] && setKind(v[0] as Kind)} className="flex-wrap">
              <ToggleGroupItem value="once" variant="outline" size="sm">One month</ToggleGroupItem>
              <ToggleGroupItem value="every-year" variant="outline" size="sm">Every year</ToggleGroupItem>
              <ToggleGroupItem value="holiday" variant="outline" size="sm">A holiday</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {kind === "holiday" ? "Pick a holiday from the next 12 months." : "Pick the month from the next 12."} Picked: {chosen}
            </span>
            {kind === "holiday" && noHolidays && (
              <p className="text-xs text-muted-foreground">No holiday calendar is switched on. Switch one on under Holiday calendars, then come back.</p>
            )}
            <ul aria-label="The next 12 months" className="flex flex-col divide-y rounded-lg border">
              {list.map((row) => {
                const on = kind === "once" ? row.month === month : kind === "every-year" ? row.month.slice(5) === monthOfYear : false;
                return (
                  <li key={row.month} className="flex flex-wrap items-center gap-2 px-2 py-1">
                    {kind === "holiday" ? (
                      <span className="w-32 shrink-0">{formatPeriodLabel(row.month)}</span>
                    ) : (
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => (kind === "once" ? setMonth(row.month) : setMonthOfYear(row.month.slice(5)))}
                        className={cn("w-32 shrink-0 rounded-md px-2 py-0.5 text-left hover:bg-muted", on && "bg-primary text-primary-foreground hover:bg-primary")}
                      >
                        {formatPeriodLabel(row.month)}
                      </button>
                    )}
                    <span className="flex flex-1 flex-wrap gap-1">
                      {row.holidays.map((h) => {
                        const picked = holiday?.holidayKey === h.key && holiday.calendarId === h.calendarId;
                        return kind === "holiday" ? (
                          <button
                            key={h.calendarId + h.key + h.start}
                            type="button"
                            aria-pressed={picked}
                            onClick={() => setHoliday({ calendarId: h.calendarId, holidayKey: h.key, name: h.name, start: h.start, end: h.end })}
                            className={cn("rounded-md border px-2 py-0.5 text-xs hover:bg-muted", picked && "border-primary bg-primary text-primary-foreground hover:bg-primary")}
                          >
                            {h.name}
                          </button>
                        ) : (
                          <span key={h.calendarId + h.key + h.start} className="text-xs text-muted-foreground">{h.name}</span>
                        );
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          {crosses && (
            <div className="flex flex-col gap-1 text-sm">
              <span>This holiday runs into a second month. Which month should the money count in?</span>
              <ToggleGroup aria-label="Count it in" value={[countIn]} onValueChange={(v: string[]) => v[0] && setCountIn(v[0] as "start" | "end")}>
                <ToggleGroupItem value="start" variant="outline" size="sm">Count it in the month it starts</ToggleGroupItem>
                <ToggleGroupItem value="end" variant="outline" size="sm">Count it in the month it ends</ToggleGroupItem>
              </ToggleGroup>
            </div>
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
