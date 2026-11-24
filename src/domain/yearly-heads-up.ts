// What the Dashboard's heads-up card lists: the yearly costs that need a look this month and next.
// It only reads a projection; nothing here writes.
import { formatPeriodLabel } from "./period.js";
import { addMonths } from "./scenario.js";
import type { Projection, Raise, YearlyBill } from "./yearly-costs.js";

export type HeadsUpKind = "ask" | "late" | "new-amount" | "calendar-runs-out" | "part-paid" | "bill-due" | "raise";
export interface HeadsUpItem { kind: HeadsUpKind; month: string | null; label: string; cents: number | null; billId?: number; raiseId?: number; calendarId?: string }

const ORDER: HeadsUpKind[] = ["ask", "late", "new-amount", "calendar-runs-out"];

// Questions, late bills, new amounts and a calendar running out always show: each waits for an answer.
// Part-paid and upcoming bills and raises show only for this month and next. A bill that has landed is left out.
export function headsUp(p: Projection, bills: YearlyBill[], raises: Raise[], today: string): HeadsUpItem[] {
  const now = today.slice(0, 7);
  const next = addMonths(now, 1);
  const soon = (month: string) => month >= now && month <= next;
  const name = (id: number) => bills.find(b => b.id === id)?.label ?? "A yearly bill";
  const items: HeadsUpItem[] = [];

  for (const o of p.occurrences) {
    const label = name(o.billId);
    if (o.status === "ask") {
      items.push({ kind: "ask", month: o.paymentMonth, billId: o.billId, cents: o.expectedCents,
        label: o.askReason === "which-bill" ? `Which payment is ${label}?` : `Is ${label} still coming?` });
    } else if (o.status === "late") {
      items.push({ kind: "late", month: o.paymentMonth, billId: o.billId, cents: o.expectedCents,
        label: `${label} was due in ${formatPeriodLabel(o.dueMonth)} and has not been paid` });
    } else if (o.status === "part-paid" && soon(o.paymentMonth)) {
      items.push({ kind: "part-paid", month: o.paymentMonth, billId: o.billId, cents: Math.max(0, o.expectedCents - o.paidCents),
        label: `${label} is partly paid` });
    } else if (o.status === "upcoming" && soon(o.paymentMonth)) {
      items.push({ kind: "bill-due", month: o.paymentMonth, billId: o.billId, cents: o.expectedCents, label: `${label} is due` });
    }
  }
  for (const n of p.notices) {
    if (n.kind === "new-amount") {
      items.push({ kind: "new-amount", month: null, billId: n.billId, cents: n.toCents, label: `${name(n.billId)} cost a new amount` });
    } else if (n.kind === "calendar-runs-out") {
      items.push({ kind: "calendar-runs-out", month: null, calendarId: n.calendarId, cents: null,
        label: n.coversThrough ? `A holiday calendar ends in ${formatPeriodLabel(n.coversThrough.slice(0, 7))}` : "A holiday calendar has run out" });
    }
  }
  const live = new Map(raises.filter(r => !r.archivedAt).map(r => [r.id, r]));
  for (const row of p.bigMonths) {
    const raise = row.origin === "raise" && row.sourceId !== undefined ? live.get(row.sourceId) : undefined;
    if (raise && soon(row.month)) items.push({ kind: "raise", month: row.month, raiseId: raise.id, cents: row.amountCents, label: raise.label });
  }

  const rank = (i: HeadsUpItem) => ORDER.indexOf(i.kind);
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    const ra = rank(a.item), rb = rank(b.item);
    if (ra >= 0 || rb >= 0) return (ra < 0 ? ORDER.length : ra) - (rb < 0 ? ORDER.length : rb) || (a.item.month ?? "").localeCompare(b.item.month ?? "") || a.index - b.index;
    return (a.item.month ?? "").localeCompare(b.item.month ?? "") || a.index - b.index;
  }).map(x => x.item);
}
