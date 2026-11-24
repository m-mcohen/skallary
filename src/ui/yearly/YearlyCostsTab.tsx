// src/ui/yearly/YearlyCostsTab.tsx -- Recurring, Yearly bills: the bills that come once or a few times a year, what is
// raised for a month or a holiday, and the holiday calendars. Each bill shows this year's due dates with where it
// stands in words, and the things you can do about it. Nothing here changes your budget until you press a button.
// Registry search (2026-11-22, shadcnblocks, shadcn-studio, react-bits: "list", "dialog", "alert"): nothing fits a
// money list with row actions, so the app's own Card, Button, Badge and Dialog are used.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCents } from "../../domain/money";
import { formatPeriodLabel, formatShortDate, localDateIso } from "../../domain/period";
import type { BillOccurrence, Raise, YearlyBill, YearlyNotice } from "../../domain/yearly-costs";
import { useConfirm } from "../ConfirmDialog";
import { HolidayCalendars } from "../holidays/HolidaysStep";
import { getBudgetLinesUI, loadDb } from "../lib/db";
import {
  chargesForBillUI, getOccurrencesUI, listBillsUI, listRaisesUI, recordBillEventUI, removeBillUI, removeRaiseUI,
  type BillCharge, type BillEventInput,
} from "../lib/db-yearly";
import BillDialog from "./BillDialog";
import ProposalReview from "./ProposalReview";
import RaiseDialog from "./RaiseDialog";
import { monthsWords, prettyKey, spendingLines, statusWords, whenWords } from "./words";

const NEEDS_YOU = new Set<BillOccurrence["status"]>(["ask", "late", "part-paid"]);

function PickPayment({ bill, occurrence, taken, onClose, onPicked }: { bill: YearlyBill; occurrence: BillOccurrence; taken: Set<string>; onClose: () => void; onPicked: () => void }) {
  const [charges, setCharges] = useState<BillCharge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    chargesForBillUI(bill.id).then((all) => {
      if (cancelled) return;
      // A payment already matched to another due date is not offered again.
      const free = all.filter((c) => !taken.has(c.id));
      const only = occurrence.candidateTxnIds?.length ? free.filter((c) => occurrence.candidateTxnIds!.includes(c.id)) : free;
      setCharges(only.length ? only : free);
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "The payments could not be read."); });
    return () => { cancelled = true; };
  }, [bill.id, occurrence, taken]);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Which payment was {bill.label}?</DialogTitle>
          <DialogDescription>For the {formatPeriodLabel(occurrence.dueMonth)} due date. Payments to the same payee from the last two years.</DialogDescription>
        </DialogHeader>
        {!charges && !error && <p className="text-sm text-muted-foreground">Looking for payments.</p>}
        {charges && charges.length === 0 && <p className="text-sm text-muted-foreground">No payments to this payee were found. If you paid it another way, use Tick as paid.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {charges && (
          <ul className="flex flex-col divide-y rounded-lg border">
            {charges.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1">{formatShortDate(c.date)}, {c.label}</span>
                <span className="tabular-nums">{formatCents(c.amountCents)}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await recordBillEventUI(bill.id, { kind: "picked", obligationYear: occurrence.obligationYear, dueMonth: occurrence.dueMonth, sourceTransactionId: c.id });
                      onPicked();
                      onClose();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  This one
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function YearlyCostsTab({ planId, onChanged }: { planId: string | null; onChanged?: () => void }) {
  const year = Number(localDateIso().slice(0, 4));
  const [bills, setBills] = useState<YearlyBill[] | null>(null);
  const [raises, setRaises] = useState<Raise[]>([]);
  const [occurrences, setOccurrences] = useState<BillOccurrence[]>([]);
  const [notices, setNotices] = useState<YearlyNotice[]>([]);
  const [lineMonthly, setLineMonthly] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [billEdit, setBillEdit] = useState<{ bill?: YearlyBill } | null>(null);
  const [raiseEdit, setRaiseEdit] = useState<{ raise?: Raise } | null>(null);
  const [picking, setPicking] = useState<{ bill: YearlyBill; occurrence: BillOccurrence } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const confirm = useConfirm();
  const [focus, setFocus] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] ?? ""));

  const load = useCallback(async () => {
    try {
      const [b, r, o] = await Promise.all([listBillsUI(), listRaisesUI(), getOccurrencesUI(`${year - 2}-01`, `${year}-12`)]);
      setBills(b);
      setRaises(r);
      setOccurrences(o.occurrences);
      setNotices(o.notices);
      if (planId) {
        const rows = await getBudgetLinesUI(await loadDb(), planId);
        setLines(spendingLines(rows.map((l) => l.planningCategory)));
        setLineMonthly(Object.fromEntries(rows.filter((l) => l.period === null).map((l) => [l.planningCategory, l.amountCents])));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The yearly bills could not be read.");
      setBills((b) => b ?? []);
    }
  }, [planId, year]);
  useEffect(() => { void load(); }, [load]);
  const changed = useCallback(() => { void load(); onChanged?.(); }, [load, onChanged]);

  // A link from the Dashboard opens this tab at one bill, raise or calendar.
  useEffect(() => {
    const onHash = () => setFocus(new URLSearchParams(window.location.hash.split("?")[1] ?? ""));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (bills === null) return;
    const id = focus.get("bill") ? `yearly-bill-${focus.get("bill")}` : focus.get("raise") ? `yearly-raise-${focus.get("raise")}` : focus.get("calendar") ? "yearly-calendars" : null;
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: "center" });
  }, [bills, focus]);
  const focused = (kind: string, id: number | string) => focus.get(kind) === String(id);

  // This year's due dates, any that need an answer, and any with a new amount to accept, last year's included.
  const shown = useMemo(() => occurrences.filter((o) => o.obligationYear === year || NEEDS_YOU.has(o.status)
    || notices.some((n) => n.kind === "new-amount" && n.billId === o.billId && n.dueMonth === o.dueMonth && n.obligationYear === o.obligationYear)), [occurrences, notices, year]);
  // Payments matched to one due date, so another due date's list leaves them out.
  const matched = useMemo(() => new Map(occurrences.flatMap((o) => o.matchedTxnIds.map((id) => [id, `${o.billId}|${o.dueMonth}`] as const))), [occurrences]);
  const taken = useMemo(() => new Set([...matched].filter(([, owner]) => owner !== (picking ? `${picking.bill.id}|${picking.occurrence.dueMonth}` : "")).map(([id]) => id)), [matched, picking]);
  const fail = (key: string, e: unknown) => setRowError((r) => ({ ...r, [key]: e instanceof Error ? e.message : String(e) }));
  const act = async (key: string, work: () => Promise<unknown>) => {
    setRowError((r) => ({ ...r, [key]: "" }));
    try {
      await work();
      changed();
    } catch (e) {
      fail(key, e);
    }
  };
  const record = (bill: YearlyBill, o: BillOccurrence, kind: BillEventInput["kind"]) =>
    act(`b${bill.id}`, () => recordBillEventUI(bill.id, { kind, obligationYear: o.obligationYear, dueMonth: o.dueMonth }));

  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setBillEdit({})}>Add a yearly bill</Button>
        <Button variant="outline" onClick={() => setRaiseEdit({})}>Add a raise</Button>
        <Button variant="outline" onClick={() => setReviewing(true)}>Suggestions from your history</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Yearly bills</CardTitle>
          <CardDescription>Bills that come once or a few times a year, planned for in the month they are due.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {bills === null && <p className="text-sm text-muted-foreground">Loading.</p>}
          {bills && bills.length === 0 && <p className="text-sm text-muted-foreground">No yearly bills yet. Add one, or look at the suggestions from your history.</p>}
          {bills?.map((bill) => {
            const mine = shown.filter((o) => o.billId === bill.id).sort((a, b) => a.dueMonth.localeCompare(b.dueMonth));
            return (
              <section
                key={bill.id}
                id={`yearly-bill-${bill.id}`}
                aria-label={bill.label}
                className={cn("flex flex-col gap-2 rounded-lg border p-3", focused("bill", bill.id) && "ring-2 ring-ring")}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{bill.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {bill.planningCategory}. Due {monthsWords(bill.months)}. {bill.amountCents === null ? "Amount not known yet" : `${formatCents(bill.amountCents)} each time`}.
                    </span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setBillEdit({ bill })}>Edit</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => confirm.ask({
                      title: `Remove ${bill.label}?`,
                      description: "It stops being planned for from now on. Past years stay as they were.",
                      confirmLabel: "Remove bill",
                      onConfirm: () => void act(`b${bill.id}`, () => removeBillUI(bill.id)),
                    })}
                  >
                    Remove
                  </Button>
                </div>
                {mine.length === 0 && <p className="text-xs text-muted-foreground">Nothing due this year.</p>}
                <ul className="flex flex-col divide-y">
                  {mine.map((o) => {
                    const notice = notices.find((n): n is Extract<YearlyNotice, { kind: "new-amount" }> => n.kind === "new-amount" && n.billId === bill.id && n.dueMonth === o.dueMonth && n.obligationYear === o.obligationYear);
                    return (
                      <li key={o.dueMonth} aria-label={`${bill.label}, ${formatPeriodLabel(o.dueMonth)}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <span className="w-32 shrink-0">{formatPeriodLabel(o.dueMonth)}</span>
                        <span className="flex-1">
                          {statusWords(o)}
                          {o.status !== "landed" && o.expectedCents > 0 && <span className="text-muted-foreground"> ({formatCents(o.expectedCents)} expected)</span>}
                        </span>
                        <Badge variant={o.status === "landed" ? "secondary" : NEEDS_YOU.has(o.status) ? "destructive" : "outline"}>
                          {o.status === "landed" ? "Paid" : o.status === "upcoming" ? "Coming" : o.status === "part-paid" ? "Part paid" : o.status === "late" ? "Late" : "Question"}
                        </Badge>
                        {o.status === "ask" && o.askReason !== "which-bill" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => void record(bill, o, "still-exists")}>Still coming</Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => confirm.ask({
                                title: `Has ${bill.label} stopped?`,
                                description: "It is taken off your yearly list and no longer planned for. Past years stay as they were.",
                                confirmLabel: "It stopped",
                                onConfirm: () => void record(bill, o, "gone"),
                              })}
                            >
                              It stopped
                            </Button>
                          </>
                        )}
                        {o.status !== "landed" && (
                          <>
                            {o.status !== "ask" && <Button size="sm" variant="outline" onClick={() => void record(bill, o, "ticked")}>Tick as paid</Button>}
                            <Button size="sm" variant="outline" onClick={() => setPicking({ bill, occurrence: o })}>Pick the payment</Button>
                          </>
                        )}
                        {notice && (
                          <Button size="sm" variant="outline" onClick={() => void record(bill, o, "told-new-amount")}>
                            Accept the new amount, {formatCents(notice.toCents)}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {rowError[`b${bill.id}`] && <p role="alert" className="text-sm text-destructive">{rowError[`b${bill.id}`]}</p>}
              </section>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Raises</CardTitle>
          <CardDescription>Extra money a line needs in a month, once, every year, or around a holiday.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {raises.length === 0 && <p className="text-sm text-muted-foreground">No raises yet.</p>}
          {raises.map((r) => {
            return (
              <div key={r.id} id={`yearly-raise-${r.id}`} className={cn("flex flex-col gap-1 rounded-lg border p-3", focused("raise", r.id) && "ring-2 ring-ring")}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{r.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.planningCategory}. {formatCents(r.amountCents)}. {whenWords(r.when, r.when.kind === "holiday" ? prettyKey(r.when.holidayKey) : undefined)}.
                    </span>
                  </div>
                  {!(r.when.kind === "once" && r.when.month < localDateIso().slice(0, 7)) && (
                    <Button variant="outline" size="sm" onClick={() => setRaiseEdit({ raise: r })}>Edit</Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => confirm.ask({
                      title: `Remove ${r.label}?`,
                      description: "It stops adding money to the budget from now on. Months already past stay as they were.",
                      confirmLabel: "Remove raise",
                      onConfirm: () => void act(`r${r.id}`, () => removeRaiseUI(r.id)),
                    })}
                  >
                    Remove
                  </Button>
                </div>
                {rowError[`r${r.id}`] && <p role="alert" className="text-sm text-destructive">{rowError[`r${r.id}`]}</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card id="yearly-calendars" className={cn(focus.get("calendar") && "ring-2 ring-ring")}>
        <CardHeader>
          <CardTitle>Holiday calendars</CardTitle>
          <CardDescription>Which holidays a raise can follow.</CardDescription>
        </CardHeader>
        <CardContent>
          <HolidayCalendars onChanged={changed} />
        </CardContent>
      </Card>

      {notices.some((n) => n.kind === "calendar-runs-out") && (
        <Alert>
          <AlertTitle>A holiday calendar is running out</AlertTitle>
          <AlertDescription>A raise tied to a holiday keeps its last known month after the calendar's last date. Import a newer file under Holiday calendars to place it exactly.</AlertDescription>
        </Alert>
      )}

      {billEdit && (
        <BillDialog initial={billEdit.bill} lines={lines} lineMonthly={lineMonthly} onClose={() => setBillEdit(null)} onSaved={changed} />
      )}
      {raiseEdit && <RaiseDialog initial={raiseEdit.raise} lines={lines} onClose={() => setRaiseEdit(null)} onSaved={changed} />}
      {picking && <PickPayment bill={picking.bill} occurrence={picking.occurrence} taken={taken} onClose={() => setPicking(null)} onPicked={changed} />}
      {reviewing && <ProposalReview lineMonthly={lineMonthly} onClose={() => setReviewing(false)} onChanged={changed} />}
      {confirm.dialog}
    </div>
  );
}
