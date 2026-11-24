// src/ui/yearly/words.ts -- plain-language labels shared by the yearly-costs screens.
import { formatCents } from "../../domain/money";
import { formatPeriodLabel } from "../../domain/period";
import { MAASER_CATEGORY } from "../../domain/maaser-pot";
import { sideOf } from "../../domain/budget-income";
import type { BillOccurrence, RaiseWhen } from "../../domain/yearly-costs";

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (mm: string) => MONTH_NAMES[Number(mm) - 1] ?? mm;
/** A holiday's key ("thanksgiving-day") as words, for when only the key is known. */
export const prettyKey = (key: string) => key.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
export const monthsWords = (months: string[]) => months.map(monthName).join(", ");

/** A budget line a yearly bill or raise may go on: spending, and not the charity line. */
export const spendingLines = (names: string[]) =>
  [...new Set(names)].filter((n) => sideOf(n) === "spending" && n !== MAASER_CATEGORY).sort((a, b) => a.localeCompare(b));

export function statusWords(o: BillOccurrence): string {
  const due = formatPeriodLabel(o.dueMonth);
  switch (o.status) {
    case "landed": return `Paid in ${formatPeriodLabel(o.paymentMonth)}: ${formatCents(o.paidCents)}`;
    case "part-paid": return `Part paid: ${formatCents(o.paidCents)} of ${formatCents(o.expectedCents)}`;
    case "late": return `Late: it was due in ${due}`;
    case "ask": return o.askReason === "which-bill" ? "Two bills could match a payment" : "Past its window with no payment seen";
    default: return `Due in ${due}`;
  }
}

export function whenWords(when: RaiseWhen, holidayName?: string): string {
  if (when.kind === "once") return `Once, in ${formatPeriodLabel(when.month)}`;
  if (when.kind === "every-year") return `Every ${monthName(when.monthOfYear)}`;
  return `${holidayName ?? "A holiday"}, counted in the month it ${when.countIn === "end" ? "ends" : "starts"}`;
}
