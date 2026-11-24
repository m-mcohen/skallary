// src/ui/budget/ChangeBudget.tsx -- changing one line. Fill-in buttons, the amount, which months (two choices, each with its
// reason as the label), the effect on Left over before saving, what it replaces, then
// Save or Cancel. There is no "this month only"; a one-off goes in a big month.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCents, parseDollarsToCents } from "../../domain/money";
import { formatPeriodLabel } from "../../domain/period";
import { addMonths } from "../../domain/scenario";
import { PAYMENTS_A_YEAR, type BillBasis } from "../../domain/suggest";
import { leftOverEffect, lineFigures, replacedBy, type MonthRow } from "../../domain/budget-month";
import type { Db } from "../lib/db";
import type { BudgetData, BudgetDataLayer } from "./useBudgetData";
import { lineOwnCents } from "./lineOwnCents";

export default function ChangeBudget({ row, today, startFrom, data, db, deps, bills, onSaved, onCancel }: {
  row: MonthRow;
  today: string;
  startFrom: string;
  data: BudgetData;
  db: Db;
  deps: BudgetDataLayer;
  bills: BillBasis[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const thisMonth = today.slice(0, 7);
  const year = data.plan.startDate.slice(0, 4);
  const startMonth = data.plan.startDate.slice(0, 7);
  const endMonth = data.plan.endDate.slice(0, 7);
  const months = useMemo(() => {
    const out: string[] = [];
    for (let m = thisMonth > startMonth ? thisMonth : startMonth; m <= endMonth; m = addMonths(m, 1)) out.push(m);
    return out;
  }, [thisMonth, startMonth, endMonth]);
  const figures = useMemo(() => lineFigures(data, row.line, row.side, thisMonth, today), [data, row.line, row.side, thisMonth, today]);
  const [which, setWhich] = useState<"from" | "every">("from");
  const [from, setFrom] = useState(months.includes(startFrom) ? startFrom : months[0]);
  // The box opens at the line's own amount for the starting
  // month (the user's every-month amount and the user's changes), never the month's full budget: a big
  // month, a goal or Charity's maaser raise sit on top and must not be saved into it.
  const ownCents = (m: string): number | null => lineOwnCents(data, row.line, m);
  const goalCentsAt = (m: string) =>
    data.changes.filter((c) => c.planningCategory === row.line && c.reason === "goal" && c.fromMonth <= m).reduce((s, c) => s + c.amountCents, 0);
  const [text, setText] = useState(() => {
    const own = ownCents(months.includes(startFrom) ? startFrom : months[0] ?? thisMonth);
    return own === null ? "" : (own / 100).toFixed(2);
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cents = useMemo(() => {
    try {
      return parseDollarsToCents(text);
    } catch {
      return null;
    }
  }, [text]);
  const fromMonth = which === "every" ? null : from;
  const effect = useMemo(
    () => (cents === null ? null : leftOverEffect(data, data.plan, today, row.line, fromMonth, cents)),
    [cents, data, today, row.line, fromMonth],
  );
  const replaced = replacedBy(data.changes, row.line, fromMonth);
  const billMonthly = bills.reduce((s, b) => s + Math.round((b.usualCents * PAYMENTS_A_YEAR[b.cadence]) / 12), 0);
  const fills: [string, number | null][] = [
    ["Last month", figures.lastMonthCents],
    ["3-month average", figures.avg3],
    ["12-month average", figures.avg12],
  ];
  if (row.fixed && bills.length > 0) fills.push(["Bill", billMonthly]);
  const fromName = from ? formatPeriodLabel(from) : "";

  const save = async () => {
    // A refund line may be budgeted below zero.
    if (cents === null) {
      setError("Enter an amount, like 450 or 450.00.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deps.changeBudgetLine(db, data.plan.id, row.line, fromMonth, cents);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (months.length === 0) return <p className="text-sm text-muted-foreground">This budget's months have all passed.</p>;

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap gap-2">
        {fills
          .filter((f): f is [string, number] => f[1] !== null)
          .map(([label, v]) => (
            <Button key={label} size="sm" variant="outline" onClick={() => setText((v / 100).toFixed(2))}>
              {label} {formatCents(v)}
            </Button>
          ))}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">New amount</span>
        <Input aria-label="New amount" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} className="w-40" />
      </label>
      {goalCentsAt(fromMonth ?? thisMonth) > 0 && (
        <p className="text-sm text-muted-foreground">Plus {formatCents(goalCentsAt(fromMonth ?? thisMonth))} a month for goals, kept on top.</p>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Which months</legend>
        <RadioGroup value={which} onValueChange={(v) => setWhich(v as "from" | "every")}>
          <label className="flex items-start gap-2 text-sm">
            <RadioGroupItem value="from" aria-label={`From ${fromName} on (something changed)`} />
            <span aria-hidden="true">From {fromName} on (something changed)</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <RadioGroupItem value="every" aria-label={`Every month of ${year} (it was wrong all year)`} />
            <span aria-hidden="true">Every month of {year} (it was wrong all year)</span>
          </label>
        </RadioGroup>
        {which === "from" && (
          <Select value={from} onValueChange={(v) => setFrom(v as string)} items={months.map((m) => ({ value: m, label: formatPeriodLabel(m) }))}>
            <SelectTrigger aria-label="Starting month" className="w-48">
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
        )}
      </fieldset>

      {effect && (
        <div className="text-sm">
          {effect.monthBefore !== null && effect.monthAfter !== null ? (
            <p>
              Left over in {formatPeriodLabel(effect.month)} {formatCents(effect.monthBefore)} to {formatCents(effect.monthAfter)}
            </p>
          ) : (
            <p>
              Spending budget in {formatPeriodLabel(effect.month)} {formatCents(effect.spendBefore)} to {formatCents(effect.spendAfter)}
            </p>
          )}
          <p>
            Left over in {year} {formatCents(effect.yearBefore)} to {formatCents(effect.yearAfter)}
          </p>
        </div>
      )}
      {replaced.length > 0 && (
        <p className="text-sm">This replaces {replaced.map((c) => `${formatCents(c.amountCents)} from ${formatPeriodLabel(c.fromMonth)}`).join(", ")}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
