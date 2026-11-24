// src/ui/dashboard/YearlyHeadsUp.tsx -- the Dashboard's heads-up on yearly costs: what needs a look this month
// and next (a bill to answer about, one that is late or part paid, a new amount, a holiday calendar running out,
// a bill or raise coming). Nothing shows when there is nothing to look at. Each line opens Recurring, Yearly bills
// at that bill, raise or calendar.
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "../../domain/money";
import { formatPeriodLabel } from "../../domain/period";
import type { HeadsUpItem } from "../../domain/yearly-heads-up";
import { getHeadsUpUI } from "../lib/db-yearly";

export function headsUpHref(i: HeadsUpItem): string {
  if (i.billId !== undefined) return `#/recurring/yearly?bill=${i.billId}`;
  if (i.raiseId !== undefined) return `#/recurring/yearly?raise=${i.raiseId}`;
  return `#/recurring/yearly?calendar=${encodeURIComponent(i.calendarId ?? "")}`;
}

export default function YearlyHeadsUp() {
  const [items, setItems] = useState<HeadsUpItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    getHeadsUpUI().then((rows) => { if (!cancelled) setItems(rows); }).catch(() => { /* nothing to show */ });
    return () => { cancelled = true; };
  }, []);
  if (items.length === 0) return null;
  return (
    <Card data-testid="yearly-heads-up">
      <CardHeader>
        <CardTitle>Yearly bills to look at</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {items.map((i, n) => (
            <li key={n}>
              <a href={headsUpHref(i)} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm hover:underline">
                <span className="flex-1">{i.label}</span>
                {i.month && <span className="text-muted-foreground">{formatPeriodLabel(i.month)}</span>}
                {i.cents !== null && <span className="tabular-nums">{formatCents(i.cents)}</span>}
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
