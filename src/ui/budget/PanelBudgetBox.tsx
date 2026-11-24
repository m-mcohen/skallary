// src/ui/budget/PanelBudgetBox.tsx -- the first line of a line's panel: the line's own budget, from the month the user is looking at on. Enter or
// clicking away saves it, the way Change budget's "from a month on" does; Esc puts the old
// amount back. Change budget stays in the panel for every month of the year, another starting
// month and the fill-in amounts. Business UI wired to the user's figures, so no registry search:
// the installed Input. No motion.
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatCents, parseDollarsToCents } from "../../domain/money";
import { formatPeriodLabel } from "../../domain/period";
import type { MonthRow } from "../../domain/budget-month";
import type { Db } from "../lib/db";
import type { BudgetData, BudgetDataLayer } from "./useBudgetData";
import { lineOwnCents } from "./lineOwnCents";

const text = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

export default function PanelBudgetBox({ row, from, data, db, deps, onChanged }: {
  row: MonthRow;
  /** The month the change starts: the month the user is looking at. */
  from: string;
  data: BudgetData;
  db: Db;
  deps: BudgetDataLayer;
  onChanged: () => void;
}) {
  const label = `Budget from ${formatPeriodLabel(from)} on`;
  const [saved, setSaved] = useState<number | null>(() => lineOwnCents(data, row.line, from));
  const [value, setValue] = useState(() => text(saved));
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const commit = async () => {
    if (busy) return;
    let cents: number;
    try {
      cents = parseDollarsToCents(value);
    } catch {
      setError(`Type dollars, such as ${text(saved ?? 10_000)}.`);
      return;
    }
    if (cents === saved) {
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deps.changeBudgetLine(db, data.plan.id, row.line, from, cents);
      setSaved(cents);
      setValue(text(cents));
      setStatus(`Saved: ${formatCents(cents)} a month from ${formatPeriodLabel(from)} on.`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 border-b pb-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          {label}
          <Input
            aria-label={label}
            inputMode="decimal"
            className="w-32 font-mono"
            value={value}
            disabled={busy}
            onChange={(e) => {
              setValue(e.target.value);
              setStatus(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setValue(text(saved));
                setError(null);
              }
            }}
            onBlur={() => void commit()}
          />
        </label>
        <span className="text-xs text-muted-foreground">Enter or clicking away saves; Esc puts it back.</span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  );
}
