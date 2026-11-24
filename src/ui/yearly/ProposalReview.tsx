// src/ui/yearly/ProposalReview.tsx -- "Suggestions from your history": yearly bills and raises the app
// noticed in past spending. It only shows them. A suggestion joins your budget when you press its Add button,
// and not before. A bill's suggestion shows the line's every-month amount before and after taking the bill's
// share out, and the months it lands; "Take it out of the line" is ticked, and unticked on its own when the
// share is larger than the line, with the reason shown.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCents } from "../../domain/money";
import { formatPeriodLabel, formatShortDate } from "../../domain/period";
import type { BillProposal, RaiseProposal } from "../../domain/yearly-proposals";
import { addBillUI, addRaiseUI, getProposalsUI } from "../lib/db-yearly";
import { monthsWords, prettyKey, whenWords } from "./words";

const billKey = (p: BillProposal) => `${p.payeeKey}|${p.accountId}|${p.planningCategory}`;
const raiseKey = (p: RaiseProposal) => `${p.planningCategory}|${p.label}|${JSON.stringify(p.when)}`;

function BillCard({ p, lineMonthly, onAdd }: { p: BillProposal; lineMonthly: Record<string, number>; onAdd: (takeOut: boolean) => Promise<void> }) {
  const room = lineMonthly[p.planningCategory] ?? 0;
  const tooBig = p.shareCents > room;
  const [wantsOut, setWantsOut] = useState(true);
  const takeOut = wantsOut && !tooBig;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <li aria-label={p.label} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{p.label}</span>
        <span className="tabular-nums">{formatCents(p.amountCents)} each time</span>
      </div>
      <p className="text-muted-foreground">
        On {p.planningCategory}. Due {monthsWords(p.months)}. Last paid {formatShortDate(p.lastPaid)}. That is {formatCents(p.shareCents)} a month spread across the year.
      </p>
      <p>
        {p.planningCategory} every month: <span className="tabular-nums">{formatCents(room)}</span> now,{" "}
        <span className="tabular-nums">{formatCents(takeOut ? room - p.shareCents : room)}</span> after.
      </p>
      <label className="flex items-start gap-2">
        <Checkbox checked={takeOut} disabled={tooBig} onCheckedChange={(c) => setWantsOut(c === true)} aria-label={`Take ${p.label} out of the line`} />
        <span>
          Take it out of the line
          {tooBig && (
            <span className="block text-xs text-muted-foreground">
              Its share is more than the line's {formatCents(room)} a month, so it is left in.
            </span>
          )}
        </span>
      </label>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onAdd(takeOut);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              setBusy(false);
            }
          }}
        >
          Add this bill
        </Button>
      </div>
    </li>
  );
}

function RaiseCard({ p, onAdd }: { p: RaiseProposal; onAdd: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const holiday = p.when.kind === "holiday" ? prettyKey(p.when.holidayKey) : undefined;
  return (
    <li aria-label={p.label} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{p.label}</span>
        <span className="tabular-nums">{formatCents(p.amountCents)}</span>
      </div>
      <p className="text-muted-foreground">
        On {p.planningCategory}. {whenWords(p.when, holiday)}. Spending ran over the usual in{" "}
        {p.basis.map((b) => `${formatPeriodLabel(b.month)} (${formatCents(b.excessCents)} over)`).join(", ")}.
      </p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onAdd();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              setBusy(false);
            }
          }}
        >
          Add this raise
        </Button>
      </div>
    </li>
  );
}

export default function ProposalReview({ lineMonthly, onClose, onChanged }: {
  lineMonthly: Record<string, number>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<{ bills: BillProposal[]; raises: RaiseProposal[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    getProposalsUI().then((d) => { if (!cancelled) setData(d); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "The suggestions could not be read."); });
    return () => { cancelled = true; };
  }, []);
  const drop = (key: string) => setGone((g) => new Set(g).add(key));
  const bills = data?.bills.filter((p) => !gone.has(billKey(p))) ?? [];
  const raises = data?.raises.filter((p) => !gone.has(raiseKey(p))) ?? [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Suggestions from your history</DialogTitle>
          <DialogDescription>
            Bills that came about once a year, and months that ran over the usual, in the spending you have already recorded. Nothing is added until you press its Add button.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {!data && !error && <p className="text-sm text-muted-foreground">Looking through your history.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {data && bills.length === 0 && raises.length === 0 && <p className="text-sm text-muted-foreground">No suggestions right now.</p>}
          {bills.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Yearly bills</h3>
              <ul className="flex flex-col gap-2">
                {bills.map((p) => (
                  <BillCard
                    key={billKey(p)}
                    p={p}
                    lineMonthly={lineMonthly}
                    onAdd={async (takeOut) => {
                      await addBillUI({ planningCategory: p.planningCategory, label: p.label, payeeKey: p.payeeKey, accountId: p.accountId,
                        amountCents: p.amountCents, months: p.months, takeOutOfLine: takeOut });
                      drop(billKey(p));
                      onChanged();
                    }}
                  />
                ))}
              </ul>
            </section>
          )}
          {raises.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Raises</h3>
              <ul className="flex flex-col gap-2">
                {raises.map((p) => (
                  <RaiseCard
                    key={raiseKey(p)}
                    p={p}
                    onAdd={async () => {
                      await addRaiseUI({ planningCategory: p.planningCategory, label: p.label, amountCents: p.amountCents, when: p.when });
                      drop(raiseKey(p));
                      onChanged();
                    }}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
