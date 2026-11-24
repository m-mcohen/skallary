// src/ui/recurring/MonthSelect.tsx -- "This month" or "Next month", for the
// Dashboard's Recurring panel and the Recurring screen's month summary.
import { monthIndex, periodFromIndex, periodOf } from "../../domain/period";

export type WhichMonth = "this" | "next";

/** This month or next, as YYYY-MM. */
export function monthFor(which: WhichMonth, asOf: string): string {
  const month = periodOf(asOf);
  return which === "this" ? month : periodFromIndex(monthIndex(month) + 1);
}

export default function MonthSelect({ value, onChange }: { value: WhichMonth; onChange: (v: WhichMonth) => void }) {
  return (
    <select
      aria-label="Which month"
      className="h-8 rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value === "next" ? "next" : "this")}
    >
      <option value="this">This month</option>
      <option value="next">Next month</option>
    </select>
  );
}

export const CHOICES_UNAVAILABLE =
  "Your Not recurring and Mark as recurring choices could not be read, so this is the app's own list.";
