// src/domain/recurring-month.ts
//
// One month of recurring charges:
// the Dashboard panel's "remaining due" and the Recurring screen's month summary.
//
// Paid is the real charges dated in the month, at their real amounts. Still to
// come is every predicted date in the month after the last charge, at the usual
// amount; one already behind today is "Not charged yet" and still counts as due.
// A charge that missed a date before the month started is not counted at all:
// whether it comes back is a guess, and the All table names the miss instead.
//
// Pure: today is a parameter.
import { monthBounds, periodOf } from "./period";
import { daysBetween, nextDate, type RecurringSeries } from "./recurring";

export type MonthItemStatus = "paid" | "late" | "upcoming";

export interface MonthItem {
  series: RecurringSeries;
  status: MonthItemStatus;
  date: string;
  /** Positive cents: money out, shown as a magnitude. */
  amountCents: number;
}

export interface RecurringMonth {
  /** YYYY-MM */
  month: string;
  /** Still to come (late, then upcoming) by date, then paid by date. */
  items: MonthItem[];
  /** Paid + remaining. */
  expectedCents: number;
  paidCents: number;
  remainingCents: number;
}

/** A cap on predicted dates per charge, far above a weekly bill's five a month. */
const MAX_STEPS = 60;

export function recurringMonth(series: RecurringSeries[], month: string, today: string): RecurringMonth {
  const { from, to } = monthBounds(month);
  // A miss is measured from the CURRENT month, as missedDate does: a charge not
  // charged yet this month is still expected, so next month still counts it.
  const currentMonthStart = monthBounds(periodOf(today)).from;
  const toCome: MonthItem[] = [];
  const paid: MonthItem[] = [];

  for (const s of series) {
    for (const charge of s.charges) {
      // A refund is money in: never a payment, even inside a recurring charge's run.
      if (charge.amountCents < 0 && charge.date >= from && charge.date <= to) {
        paid.push({ series: s, status: "paid", date: charge.date, amountCents: -charge.amountCents });
      }
    }
    for (let step = 1; step <= MAX_STEPS; step++) {
      const date = nextDate(s.lastSeen, s.cadence, step);
      if (date > to) break;
      if (date < from) {
        // Before the current month began: it missed, so nothing is counted for it.
        if (date < currentMonthStart) break;
        continue;
      }
      toCome.push({ series: s, status: date < today ? "late" : "upcoming", date, amountCents: Math.abs(s.typicalAmountCents) });
    }
  }

  const byDate = (a: MonthItem, b: MonthItem) => a.date.localeCompare(b.date) || a.series.label.localeCompare(b.series.label);
  toCome.sort(byDate);
  paid.sort(byDate);
  const sum = (items: MonthItem[]) => items.reduce((t, i) => t + i.amountCents, 0);
  const paidCents = sum(paid);
  const remainingCents = sum(toCome);
  return { month, items: [...toCome, ...paid], expectedCents: paidCents + remainingCents, paidCents, remainingCents };
}

/** The predicted date a charge missed before this month began, or null when it has not missed one. */
export function missedDate(s: RecurringSeries, today: string): string | null {
  const next = nextDate(s.lastSeen, s.cadence);
  return next < monthBounds(periodOf(today)).from ? next : null;
}

/** "Oct 14", in the calendar the date was written in. */
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** When, in Monarch's words: "Today", "In 3 days", "Not charged yet, due Oct 3", "Paid Oct 2". */
export function whenText(item: MonthItem, today: string): string {
  if (item.status === "paid") return `Paid ${shortDate(item.date)}`;
  if (item.status === "late") return `Not charged yet, due ${shortDate(item.date)}`;
  const days = daysBetween(today, item.date);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 7) return `In ${days} days`;
  return shortDate(item.date);
}

/**
 * A month that is over:
 * only the real charges dated in it. Nothing is still to come in a month that
 * has ended, so a date predicted after a charge's last payment is not listed.
 */
export function endedRecurringMonth(series: RecurringSeries[], month: string): RecurringMonth {
  const { from, to } = monthBounds(month);
  const paid: MonthItem[] = [];
  for (const s of series) {
    for (const charge of s.charges) {
      if (charge.amountCents < 0 && charge.date >= from && charge.date <= to) {
        paid.push({ series: s, status: "paid", date: charge.date, amountCents: -charge.amountCents });
      }
    }
  }
  paid.sort((a, b) => a.date.localeCompare(b.date) || a.series.label.localeCompare(b.series.label));
  const paidCents = paid.reduce((t, i) => t + i.amountCents, 0);
  return { month, items: paid, expectedCents: paidCents, paidCents, remainingCents: 0 };
}
