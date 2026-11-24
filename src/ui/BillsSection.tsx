// src/ui/BillsSection.tsx
//
// The Recurring screen.
//
// Top: the month summary, Monarch's "remaining due" with what was paid beside it.
// Then every recurring charge, each with Not recurring, and the ones the user hid, each
// with Show again (the undo). The two budget checks earn the bottom of the
// screen: a recurring charge with no fixed-cost line is a bill the budget does
// not plan for, and a fixed cost with no recurring charge is either a dead
// subscription or a feed that stopped reporting it.
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { formatCents } from "../domain/money";
import { localDateIso } from "../domain/period";
import type { RecurringSeries } from "../domain/recurring";
import { CADENCE_LABELS } from "../domain/recurring-choices";
import { missedDate, recurringMonth, shortDate } from "../domain/recurring-month";
import MonthSelect, { CHOICES_UNAVAILABLE, monthFor, type WhichMonth } from "./recurring/MonthSelect";
import RecurringMonthList, { SeriesLink } from "./recurring/RecurringMonthList";
import { useRecurring, type RecurringDataLayer } from "./recurring/useRecurring";

const MONEY = "font-mono tabular-nums";
const BACK = "#/recurring";

export interface BillsSectionProps {
  dataLayer?: Partial<RecurringDataLayer>;
  /** Defaults to today; a prop lets tests pin it. */
  asOfDate?: string;
}

function Figure({ id, label, cents }: { id: string; label: string; cents: number }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div data-testid={id} className={`text-2xl ${MONEY}`}>
        {formatCents(cents)}
      </div>
    </div>
  );
}

export default function BillsSection({ dataLayer, asOfDate }: BillsSectionProps) {
  const asOf = asOfDate ?? localDateIso();
  const { phase, data, save, remove } = useRecurring(dataLayer, asOf);
  const [which, setWhich] = useState<WhichMonth>("this");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase === "loading") return <Skeleton className="h-96 w-full" />;
  if (phase === "unavailable") {
    return (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>The local server is not reachable. Restart the app.</AlertDescription>
      </Alert>
    );
  }
  if (!data) return null;

  const month = recurringMonth(data.series, monthFor(which, asOf), asOf);
  const accountName = (id: string) => data.accountNames[id] ?? "Unknown account";
  const hidden = data.choices.filter((c) => c.choice === "not_recurring");
  const { detectedSeries, unbudgetedSeries, missingActuals } = data.audit;
  // "Found by" says something only once the user has marked a charge.
  const anyMarked = detectedSeries.some((s) => s.source === "marked");

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const hide = (s: RecurringSeries) =>
    act(() => save({ payeeKey: s.key, accountId: s.accountId, choice: "not_recurring", cadence: null, label: s.label, ...(s.markAmountCents == null ? {} : { amountCents: s.markAmountCents }) }));

  // "Aug 6", or "Sep 29, 2025" when it is not this year: ISO dates wrapped mid-number at 1280 px.
  const day = (date: string) => (date.slice(0, 4) === asOf.slice(0, 4) ? shortDate(date) : `${shortDate(date)}, ${date.slice(0, 4)}`);
  const next = (s: RecurringSeries) => {
    const missed = missedDate(s, asOf);
    return missed ? `Missed ${day(missed)}` : day(s.nextExpected);
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {data.choicesUnavailable && (
        <p className="text-sm text-muted-foreground">{CHOICES_UNAVAILABLE}</p>
      )}

      <Card data-testid="recurring-month">
        <CardHeader>
          <CardTitle className="text-base">{which === "this" ? "This month" : "Next month"}</CardTitle>
          <CardDescription>Every recurring charge in the month: what was paid, and what is still to come.</CardDescription>
          <CardAction>
            <MonthSelect value={which} onChange={setWhich} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4">
            <Figure id="recurring-expected" label="Expected" cents={month.expectedCents} />
            <Figure id="recurring-paid" label="Paid" cents={month.paidCents} />
            <Figure id="recurring-due" label="Remaining due" cents={month.remainingCents} />
          </div>
          {month.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recurring is due {which === "this" ? "this" : "next"} month.</p>
          ) : (
            <RecurringMonthList month={month} accountNames={data.accountNames} asOf={asOf} back={BACK} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>All recurring charges</CardDescription>
          <CardTitle className="text-base">
            {detectedSeries.length} {detectedSeries.length === 1 ? "charge" : "charges"} on a rhythm
          </CardTitle>
        </CardHeader>
        <CardContent>
          {detectedSeries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recurring charges found yet.</p>
          ) : (
            // A narrow window scrolls the table inside its card, never the whole page.
            <div className="relative overflow-x-auto">
            <table data-testid="detected-series" className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-3">Merchant</th>
                  <th className="pb-2 text-right">Usual</th>
                  <th className="whitespace-nowrap pb-2 pl-3 text-right">Last charge</th>
                  <th className="pb-2 pl-3 pr-3 text-right">Next</th>
                  <th className="pb-2 pr-3 text-right">Charges</th>
                  <th className="pb-2 pl-3 pr-3">Category</th>
                  {anyMarked && <th className="whitespace-nowrap pb-2 pr-3">Found by</th>}
                  <th className="pb-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {detectedSeries.map((s) => (
                  <tr key={`${s.accountId}|${s.key}`} className="border-b last:border-0">
                    {/* How often and the account sit under the name, as in the month list: ten
                        columns did not fit beside the sidebar at 1280 px. */}
                    <td className="py-1.5 pr-3">
                      <div className="flex min-w-0 flex-col">
                        <SeriesLink s={s} back={BACK} />
                        <span className="text-xs text-muted-foreground">
                          {CADENCE_LABELS[s.cadence]} &middot; {accountName(s.accountId)}
                        </span>
                      </div>
                    </td>
                    <td className={`whitespace-nowrap py-1.5 text-right ${MONEY}`}>{formatCents(Math.abs(s.typicalAmountCents))}</td>
                    <td className="whitespace-nowrap py-1.5 pl-3 text-right">{day(s.lastSeen)}</td>
                    <td className="whitespace-nowrap py-1.5 pl-3 pr-3 text-right">{next(s)}</td>
                    <td className={`py-1.5 pr-3 text-right ${MONEY}`}>{s.occurrenceCount}</td>
                    <td className="max-w-48 truncate py-1.5 pl-3 pr-3 text-muted-foreground" title={s.planningCategory ?? "Uncategorized"}>
                      {s.planningCategory ?? "Uncategorized"}
                    </td>
                    {anyMarked && <td className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground">{s.source === "marked" ? "you" : "the app"}</td>}
                    <td className="py-1.5 text-right">
                      {/* A button that says what it does; "Not recurring" read as a status. */}
                      <Button variant="outline" size="sm" disabled={busy} aria-label={`Mark as not recurring: ${s.label}`} onClick={() => void hide(s)}>
                        Mark as not recurring
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </CardContent>
      </Card>

      {hidden.length > 0 && (
        <Card data-testid="recurring-hidden">
          <CardHeader>
            <CardDescription>Not recurring</CardDescription>
            <CardTitle className="text-base">Charges you said are not recurring</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {hidden.map((c) => (
                <li key={`${c.accountId}|${c.payeeKey}|${c.amountCents ?? 0}`} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="flex-1 truncate">
                    {c.label}
                    <span className="ml-2 text-xs text-muted-foreground">{accountName(c.accountId)}</span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`Show again: ${c.label}`}
                    onClick={() => void act(() => remove(c.payeeKey, c.accountId, c.amountCents ?? null))}
                  >
                    Show again
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="audit-unbudgeted">
          <CardHeader>
            <CardDescription>Check</CardDescription>
            <CardTitle className="text-base">Recurring charges with no fixed-cost line on your budget</CardTitle>
          </CardHeader>
          <CardContent>
            {unbudgetedSeries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every recurring charge has a matching fixed-cost line on your budget.</p>
            ) : (
              <ul className="divide-y">
                {unbudgetedSeries.map((s) => (
                  <li key={`${s.accountId}|${s.key}`} className="flex items-center gap-3 py-1.5 text-sm">
                    <span className="flex-1 truncate">{s.label}</span>
                    <span className={MONEY}>{formatCents(Math.abs(s.typicalAmountCents))}</span>
                    <span className="text-xs text-muted-foreground">{s.planningCategory ?? "Uncategorized"}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card data-testid="audit-missing">
          <CardHeader>
            <CardDescription>Check</CardDescription>
            <CardTitle className="text-base">Fixed costs on your budget with no recurring charge found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              Lines marked Fixed cost on the Budget screen that no recurring charge here matches. Rent paid by Zelle to
              different names, or groceries, will show here; that is expected.
            </p>
            {missingActuals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every fixed-cost line has a recurring charge behind it.</p>
            ) : (
              <ul className="divide-y">
                {missingActuals.map((c) => (
                  <li key={c} className="py-1.5 text-sm">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
