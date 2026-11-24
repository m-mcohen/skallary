// src/ui/dashboard/RecurringPanel.tsx -- the Dashboard's Recurring panel. This month or next: what is still to
// come, then what was paid. At most 8 rows; the Recurring screen has them all.
// Display only: nothing here feeds the runway or the budget.
//
// On a past month (`pastMonth`) the panel says what
// recurring charges took that month. Nothing is still to come in a month that is
// over, so there is no This month or Next month pick.
import { useState } from "react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { formatCents } from "../../domain/money";
import { formatPeriodLabel, localDateIso } from "../../domain/period";
import { endedRecurringMonth, recurringMonth } from "../../domain/recurring-month";
import MonthSelect, { CHOICES_UNAVAILABLE, monthFor, type WhichMonth } from "../recurring/MonthSelect";
import RecurringMonthList from "../recurring/RecurringMonthList";
import { useRecurring, type RecurringDataLayer } from "../recurring/useRecurring";

const PANEL_ROWS = 8;

export default function RecurringPanel({
  dataLayer,
  asOfDate,
  pastMonth = null,
  back = "#/dashboard",
}: {
  dataLayer?: Partial<RecurringDataLayer>;
  asOfDate?: string;
  /** A past month, YYYY-MM: what was paid in it. Null: this month or next, as before. */
  pastMonth?: string | null;
  /** Where a payments ledger's Back returns. */
  back?: string;
}) {
  const asOf = asOfDate ?? localDateIso();
  const { phase, data } = useRecurring(dataLayer, asOf);
  const [which, setWhich] = useState<WhichMonth>("this");
  const month = data ? (pastMonth ? endedRecurringMonth(data.series, pastMonth) : recurringMonth(data.series, monthFor(which, asOf), asOf)) : null;

  return (
    <Card aria-label="Recurring" foldId="dash-recurring">
      <CardHeader>
        <CardTitle className="flex items-baseline gap-2 text-base">
          Recurring
          {month && pastMonth && (
            <span data-testid="recurring-paid" className="text-sm font-normal text-muted-foreground">
              <span className="font-mono tabular-nums">{formatCents(month.paidCents)}</span> paid in {formatPeriodLabel(pastMonth)}
            </span>
          )}
          {month && !pastMonth && (
            <span data-testid="recurring-remaining" className="text-sm font-normal text-muted-foreground">
              <span className="font-mono tabular-nums">{formatCents(month.remainingCents)}</span> remaining due
            </span>
          )}
        </CardTitle>
        {!pastMonth && (
          <CardAction>
            <MonthSelect value={which} onChange={setWhich} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {phase === "loading" && <Skeleton className="h-32 w-full" />}
        {phase === "unavailable" && <p className="text-sm text-muted-foreground">Recurring charges could not be loaded.</p>}
        {data?.choicesUnavailable && <p className="text-xs text-muted-foreground">{CHOICES_UNAVAILABLE}</p>}
        {data && month && (
          month.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {pastMonth ? `Nothing recurring was charged in ${formatPeriodLabel(pastMonth)}.` : `Nothing recurring is due ${which === "this" ? "this" : "next"} month.`}
            </p>
          ) : (
            <RecurringMonthList month={month} accountNames={data.accountNames} asOf={asOf} back={back} limit={PANEL_ROWS} />
          )
        )}
        {phase === "ready" && (
          <a href="#/recurring" className="self-start text-xs text-primary hover:underline">
            See all recurring
          </a>
        )}
      </CardContent>
    </Card>
  );
}
