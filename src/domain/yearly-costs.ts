import type { BillEvent } from "../data/yearly-costs.store.js";
import type { Holiday, HolidayCalendar } from "./holidays.js";
import { merchantOf, shownName, type RenameMap } from "./merchants.js";
import { localDateIso } from "./period.js";
import { planForMonth } from "./plan-choice.js";
import type { BigMonth, Plan } from "./plan-types.js";
import { daysBetween, nearAmount, nextDate } from "./recurring.js";
import { addMonths } from "./scenario.js";
import { countedByAccount, isCountedAccount } from "./scope.js";
import type { Account, NormalizedTxn } from "./types.js";

export interface YearlyBill {
  id: number; planningCategory: string; label: string;
  payeeKey: string;
  accountId: string | null;
  amountCents: number | null;       // null = unknown amount: a reminder at zero
  months: string[];                 // "MM" months it lands each year
  createdAt: string; archivedAt: string | null;
}
export type BillStatus = "upcoming" | "landed" | "part-paid" | "late" | "ask";
export interface BillOccurrence {
  billId: number; obligationYear: number; dueMonth: string; paymentMonth: string; // "YYYY-MM"
  late: boolean;
  askReason?: "still-exists" | "which-bill";
  candidateTxnIds?: string[];
  placedMonths: string[]; // Includes part payments as well as any remaining budget.
  status: BillStatus; expectedCents: number; paidCents: number; matchedTxnIds: string[];
}
export type RaiseWhen =
  | { kind: "once"; month: string }                       // "YYYY-MM"
  | { kind: "every-year"; monthOfYear: string }           // "MM"
  | { kind: "holiday"; calendarId: string; holidayKey: string; countIn: "start" | "end" };
export interface Raise { id: number; planningCategory: string; label: string; amountCents: number; when: RaiseWhen; createdAt: string; archivedAt: string | null }
export interface YearlyBillTerms {
  billId: number;
  fromYear: number;
  planningCategory: string;
  amountCents: number | null;
  months: string[];
  createdAt: string;
}

export const LANDING_WINDOW_DAYS = 20;
export const LATE_MONTHS = 3;
export const LANDED_SHARE = 0.65;

export interface YearlyShare {
  billId: number; planId: string; planningCategory: string; cents: number;
  /** The yearly amount the share was reserved for; null on rows saved before 0202 (read as 12 x cents). */
  yearlyCents?: number | null;
}
export interface ProjectionInput {
  from: string; to: string; today: string;
  bills: YearlyBill[]; terms: YearlyBillTerms[]; events: BillEvent[];
  raises: Raise[]; holidays: Holiday[]; calendars: HolidayCalendar[];
  txns: NormalizedTxn[]; accounts: Account[]; renames: RenameMap;
}
export type YearlyNotice =
  | { kind: "new-amount"; billId: number; obligationYear: number; dueMonth: string; fromCents: number | null; toCents: number }
  | { kind: "ask"; billId: number; obligationYear: number; dueMonth: string; reason: "still-exists" | "which-bill"; candidateTxnIds: string[] }
  | { kind: "calendar-runs-out"; calendarId: string; coversThrough: string | null; raiseIds: number[] };
export interface Projection { occurrences: BillOccurrence[]; bigMonths: BigMonth[]; yearlyTxnIds: string[]; notices: YearlyNotice[] }

export function annualBillsCents(bills: YearlyBill[]): number {
  return bills.reduce((sum, b) => sum + (b.archivedAt ? 0 : (b.amountCents ?? 0) * b.months.length), 0);
}
export function monthlyShareCents(b: Pick<YearlyBill, "amountCents" | "months">): number {
  return Math.round((b.amountCents ?? 0) * b.months.length / 12);
}

/** One bill on a row, by the yearly amount its share was reserved for (never a later edited amount). */
export interface ShareOnRow { billId: number; yearlyCents: number }
/**
 * The shares a budget line's bills take from it in one budget, or null when the line has no room.
 * Orchestrator ruling (yearly-list check, as revised): a row has room when round(sum of its bills' yearly amounts
 * / 12) is at most the row's monthly amount, so the shares never take the row below 0. Rejected: comparing the
 * exact yearly sum with 12 times the row (refused a row set to a bill's own share when its rounding went down,
 * for example 1201 cents a year on a 100-cent row). Each share starts from its
 * own round(yearly / 12), worked out afresh from the reserved yearly amount every time, so an adjustment never
 * builds on an earlier one. The shares on one row always sum to round(sum of yearly amounts / 12), full row or
 * not: a share may move by one cent either way to get there (that bill's rounding term is then within -12 to 12
 * cents). Shares rounded up give back a cent, the most rounded up first; shares rounded down take one, the most
 * rounded down first; ties go to the lowest bill id. A full row so ends at exactly 0, never below.
 * Rejected: checking per-bill rounded shares one at a time (refused an exact fit by 1 cent).
 */
export function fitShares(rows: number[], bills: ShareOnRow[]): Map<number, number> | null {
  if (!rows.length) return null;
  const tightest = Math.min(...rows);
  const total = bills.reduce((sum, b) => sum + b.yearlyCents, 0);
  const rounded = Math.round(total / 12);
  if (rounded > tightest) return null;
  const out = new Map(bills.map(b => [b.billId, Math.round(b.yearlyCents / 12)]));
  const share = (b: ShareOnRow) => out.get(b.billId) ?? 0;
  const sum = [...out.values()].reduce((a, b) => a + b, 0);
  const target = rounded;
  const step = (direction: 1 | -1) => {
    // How far a share sits past its exact twelfth on the side it would give up: down gives back the most rounded up.
    const lean = (b: ShareOnRow) => direction * (b.yearlyCents - 12 * share(b));
    const pick = bills.filter(b => direction === 1 ? share(b) < Math.ceil(b.yearlyCents / 12) : share(b) > Math.floor(b.yearlyCents / 12))
      .sort((a, b) => lean(b) - lean(a) || a.billId - b.billId)[0];
    if (!pick) return false;
    out.set(pick.billId, share(pick) + direction);
    return true;
  };
  for (let gap = target - sum; gap !== 0; gap -= Math.sign(gap)) if (!step(gap > 0 ? 1 : -1)) return null;
  return out;
}

export function validateBill(input: unknown): Omit<YearlyBill, "id" | "createdAt" | "archivedAt"> | string {
  const data = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const trim = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const planningCategory = trim(data.planningCategory);
  const label = trim(data.label);
  const payeeKey = trim(data.payeeKey).toLowerCase();
  if (!planningCategory || !label || !payeeKey) return "Choose a budget line, a name and a payee for this bill.";
  const { amountCents, months, accountId } = data;
  if (amountCents !== null && (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0)) {
    return "Enter a positive amount in whole cents or leave the amount unknown.";
  }
  if (!Array.isArray(months) || !months.length || months.some(m => typeof m !== "string" || !/^(0[1-9]|1[0-2])$/.test(m))) {
    return "Choose the months when the bill is due.";
  }
  if (accountId != null && !trim(accountId)) return "Choose an account or leave it open to any account.";
  return { planningCategory, label, payeeKey, amountCents, months: [...new Set<string>(months)].sort(), accountId: trim(accountId) || null };
}

export function validateRaise(input: unknown): Omit<Raise, "id" | "createdAt" | "archivedAt"> | string {
  const data = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const trim = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const planningCategory = trim(data.planningCategory);
  const label = trim(data.label);
  if (!planningCategory || !label) return "Choose a budget line and a name for this raise.";
  const { amountCents } = data;
  if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return "Enter a positive amount in whole cents.";
  }
  const w = data.when && typeof data.when === "object" ? data.when as Record<string, unknown> : {};
  let when: RaiseWhen;
  if (w.kind === "once" && typeof w.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(w.month)) {
    when = { kind: "once", month: w.month };
  } else if (w.kind === "every-year" && typeof w.monthOfYear === "string" && /^(0[1-9]|1[0-2])$/.test(w.monthOfYear)) {
    when = { kind: "every-year", monthOfYear: w.monthOfYear };
  } else if (w.kind === "holiday" && trim(w.calendarId) && trim(w.holidayKey)) {
    when = { kind: "holiday", calendarId: trim(w.calendarId), holidayKey: trim(w.holidayKey), countIn: w.countIn === "end" ? "end" : "start" };
  } else return "Choose when the raise happens: a month, a month every year, or a holiday.";
  return { planningCategory, label, amountCents, when };
}

// D9. With `floors` off, the months a raise's rule covers whenever it was made (proposals use that to see what it already answers).
function raisePlacements(r: Raise, holidays: Holiday[], from: string, to: string, floors: boolean): { month: string; estimated: boolean }[] {
  const out = new Map<string, boolean>();
  const w = r.when;
  if (w.kind === "once") out.set(w.month, false);
  else if (w.kind === "every-year") {
    for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) out.set(year + "-" + w.monthOfYear, false);
  } else {
    const counted = (h: Holiday) => (w.countIn === "end" ? h.end : h.start).slice(0, 7);
    const mine = holidays.filter(h => h.calendarId === w.calendarId && h.key === w.holidayKey);
    for (const h of mine) out.set(counted(h), false);
    const last = mine.map(counted).sort().pop();
    // Past the calendar's last date the raise keeps that holiday's last known month of the year.
    if (last) for (let year = Number(last.slice(0, 4)) + 1; year <= Number(to.slice(0, 4)); year++) out.set(year + "-" + last.slice(5), true);
  }
  // Stamps are UTC instants; "this month" is the local one, so read both ends in local time.
  const localMonth = (stamp: string) => stamp.length <= 10 ? stamp.slice(0, 7) : localDateIso(new Date(stamp)).slice(0, 7);
  const floor = localMonth(r.createdAt);
  const ceiling = r.archivedAt ? localMonth(r.archivedAt) : undefined;
  return [...out].filter(([month]) => month >= from && month <= to && (!floors || (month >= floor && (!ceiling || month < ceiling))))
    .map(([month, estimated]) => ({ month, estimated })).sort((a, b) => a.month.localeCompare(b.month));
}
export function raiseMonths(r: Raise, holidays: Holiday[], from: string, to: string): { month: string; estimated: boolean }[] {
  return raisePlacements(r, holidays, from, to, true);
}
export function raiseHistoryMonths(r: Raise, holidays: Holiday[], from: string, to: string): string[] {
  return raisePlacements(r, holidays, from, to, false).map(m => m.month);
}

export function termsFor(bill: YearlyBill, terms: YearlyBillTerms[], year: number) {
  let latest: YearlyBillTerms | undefined;
  for (const t of terms) {
    if (t.billId === bill.id && t.fromYear <= year && (!latest || t.fromYear > latest.fromYear)) latest = t;
  }
  return latest ?? bill;
}

export function firstOpenYear(bill: YearlyBill, occurrences: BillOccurrence[], plans: Plan[], today: string): number {
  const closed = plans.filter(p => p.endDate.slice(0, 7) < today.slice(0, 7));
  let year = Number(today.slice(0, 4));
  for (const o of occurrences) {
    if (o.billId !== bill.id || o.obligationYear < year) continue;
    if (o.placedMonths.some(month => closed.some(p => p.startDate.slice(0, 7) <= month && month <= p.endDate.slice(0, 7)))) {
      year = o.obligationYear + 1;
    }
  }
  return year;
}

export function ownedBy(rows: BigMonth[], plans: Plan[], planId: string): BigMonth[] {
  return rows.filter(row => planForMonth(plans, row.month)?.id === planId).map(row => ({ ...row, planId }));
}

interface Slot {
  bill: YearlyBill; year: number; due: string; lastMonth: string;
  terms: ReturnType<typeof termsFor>; events: BillEvent[]; payments: NormalizedTxn[];
  paid: number; landed: boolean; expected?: number; candidates: string[];
}

function buildSlots(input: ProjectionInput, firstTxnYear: number) {
  const slots: Slot[] = [];
  const byPayee = new Map<string, Slot[]>();
  for (const bill of input.bills) {
    const firstYear = Number(bill.createdAt.slice(0, 4));
    const events = input.events.filter(e => e.billId === bill.id);
    const gone = events.filter(e => e.kind === "gone").map(e => e.dueMonth).sort()[0];
    const group: Slot[] = [];
    for (let year = Math.min(firstYear, firstTxnYear); year <= Number(input.to.slice(0, 4)); year++) {
      // Earlier years are solely for removing known bill payments from spending averages.
      const terms = termsFor(bill, input.terms, Math.max(firstYear, year));
      for (const month of terms.months) {
        const due = year + "-" + month;
        if (gone && due >= gone) continue;
        const slot: Slot = { bill, year, due, lastMonth: addMonths(due, LATE_MONTHS), terms,
          events: events.filter(e => e.dueMonth === due), payments: [], paid: 0, landed: false, candidates: [] };
        group.push(slot);
        slots.push(slot);
      }
    }
    const key = shownName(bill.payeeKey, input.renames).toLowerCase();
    const existing = byPayee.get(key) ?? [];
    byPayee.set(key, existing.concat(group));
  }
  for (const group of byPayee.values()) group.sort((a, b) => a.due.localeCompare(b.due) || a.bill.id - b.bill.id);
  return { slots, byPayee };
}

function settled(slot: Slot, asOf: string): boolean {
  return slot.landed && (slot.paid >= slot.expected! || asOf.slice(0, 7) > slot.lastMonth);
}

function matchPayments(input: ProjectionInput) {
  const counted = countedByAccount(input.accounts);
  const charges = input.txns.filter(t => t.amountCents < 0 && t.date <= input.today && !t.isTransfer && !t.isWash && !t.savingBucket &&
    isCountedAccount(t.accountId, counted)).sort((a, b) => a.date.localeCompare(b.date) || a.sourceTransactionId.localeCompare(b.sourceTransactionId));
  const { slots, byPayee } = buildSlots(input, Number((charges[0]?.date ?? input.today).slice(0, 4)));
  const picks = new Map<string, Slot>();
  const learned = new Map<number, Slot[]>();
  for (const slot of slots) {
    for (const e of slot.events) if (e.kind === "picked" && e.sourceTransactionId) picks.set(e.sourceTransactionId, slot);
  }
  // A landed bill is learned from its whole landing window: once the window has closed or the
  // expected amount is reached, never from the part total at the moment it crossed LANDED_SHARE.
  function expected(slot: Slot, asOf: string): number {
    if (slot.expected !== undefined) return slot.expected;
    if (slot.terms.amountCents === null) return 0;
    const history = learned.get(slot.bill.id) ?? [];
    for (let i = history.length - 1; i >= 0; i--) {
      const s = history[i];
      if (s.year < slot.year && settled(s, asOf) && s.payments[s.payments.length - 1].date > slot.terms.createdAt.slice(0, 10)) return s.paid;
    }
    return slot.terms.amountCents;
  }

  for (const charge of charges) {
    const picked = picks.get(charge.sourceTransactionId);
    let selected = picked;
    if (!picked) {
      // Per bill, the earliest occurrence not yet landed whose window holds the charge; failing that, a landed
      // one with room left takes the rest of its parts (a bill landed at LANDED_SHARE is still paying off).
      const open = new Map<number, Slot>();
      const room = new Map<number, Slot>();
      for (const slot of byPayee.get(merchantOf(charge, input.renames).toLowerCase()) ?? []) {
        if (slot.landed && slot.paid >= slot.expected!) continue;
        if (slot.events.some(e => e.kind === "ticked" && charge.date > e.createdAt.slice(0, 10))) continue;
        if (slot.bill.accountId && slot.bill.accountId !== charge.accountId) continue;
        if (daysBetween(charge.date, slot.due + "-01") > LANDING_WINDOW_DAYS) continue;
        if (charge.date.slice(0, 7) > slot.lastMonth && !slot.events.some(e => e.kind === "still-exists")) continue;
        const into = slot.landed ? room : open;
        if (!into.has(slot.bill.id)) into.set(slot.bill.id, slot);
      }
      for (const [billId, slot] of room) if (!open.has(billId)) open.set(billId, slot);
      const options = [...open.values()];
      if (options.length === 1) selected = options[0];
      else if (options.length > 1) {
        const near = options.filter(s => nearAmount(charge.amountCents, s.terms.amountCents === null ? null : expected(s, charge.date) - s.paid));
        if (near.length === 1) selected = near[0];
        else for (const s of options) s.candidates.push(charge.sourceTransactionId);
      }
    }
    if (!selected) continue;
    selected.expected = expected(selected, charge.date);
    selected.payments.push(charge);
    selected.paid -= charge.amountCents;
    if (!selected.landed && (picked || selected.terms.amountCents === null || selected.paid >= selected.expected * LANDED_SHARE)) {
      selected.landed = true;
      if (selected.year >= Number(selected.bill.createdAt.slice(0, 4)) && selected.terms.amountCents !== null) {
        const history = learned.get(selected.bill.id) ?? [];
        history.push(selected);
        learned.set(selected.bill.id, history);
      }
    }
  }
  for (const slot of slots) slot.expected = expected(slot, input.today);
  return slots;
}

function place(slot: Slot, today: string) {
  const month = today.slice(0, 7);
  const identity = { billId: slot.bill.id, obligationYear: slot.year, dueMonth: slot.due };
  const expected = slot.expected!;
  const ticked = slot.events.some(e => e.kind === "ticked");
  const stillExists = slot.events.some(e => e.kind === "still-exists");
  const pastWindow = month > slot.lastMonth && !stillExists;
  let paymentMonth = slot.due;
  if (month > slot.due) paymentMonth = pastWindow ? slot.lastMonth : month;
  const notices: YearlyNotice[] = [];
  let status: BillStatus;
  let askReason: BillOccurrence["askReason"];
  if (ticked || slot.landed) {
    status = "landed";
    paymentMonth = ticked ? slot.due : slot.payments[slot.payments.length - 1].date.slice(0, 7);
    if (!ticked && settled(slot, today) && slot.terms.amountCents !== null && slot.paid !== expected && !slot.events.some(e => e.kind === "told-new-amount")) {
      notices.push({ ...identity, kind: "new-amount", fromCents: expected, toCents: slot.paid });
    }
  } else if (slot.candidates.length || pastWindow) {
    status = "ask";
    askReason = slot.candidates.length ? "which-bill" : "still-exists";
    notices.push({ ...identity, kind: "ask", reason: askReason, candidateTxnIds: slot.candidates });
  } else if (slot.paid) status = "part-paid";
  else status = month > slot.due ? "late" : "upcoming";

  const amounts = new Map<string, number>();
  let remaining = expected;
  if (!ticked) {
    for (const txn of slot.payments) {
      const cents = Math.min(remaining, -txn.amountCents);
      const when = txn.date.slice(0, 7);
      amounts.set(when, (amounts.get(when) ?? 0) + cents);
      remaining -= cents;
    }
  }
  amounts.set(paymentMonth, (amounts.get(paymentMonth) ?? 0) + remaining);
  const occurrence: BillOccurrence = { ...identity, status, paymentMonth, late: paymentMonth > slot.due,
    paidCents: ticked ? expected : slot.paid, expectedCents: expected, matchedTxnIds: slot.payments.map(t => t.sourceTransactionId),
    placedMonths: [...amounts.keys()], ...(askReason ? { askReason, candidateTxnIds: slot.candidates } : {}) };
  return { amounts, occurrence, notices };
}

export function projectYearlyCosts(input: ProjectionInput): Projection {
  const result: Projection = { bigMonths: [], yearlyTxnIds: [], occurrences: [], notices: [] };
  for (const slot of matchPayments(input)) {
    for (const t of slot.payments) result.yearlyTxnIds.push(t.sourceTransactionId);
    if (slot.year < Number(slot.bill.createdAt.slice(0, 4))) continue;
    const { amounts, occurrence, notices } = place(slot, input.today);
    result.occurrences.push(occurrence);
    result.notices.push(...notices);
    for (const [month, amountCents] of amounts) {
      if (month < input.from || month > input.to) continue;
      result.bigMonths.push({ id: 0, planId: "", planningCategory: slot.terms.planningCategory, amountCents, month,
        label: slot.bill.label, createdAt: slot.bill.createdAt, origin: "yearly-bill", sourceId: slot.bill.id,
        late: month > slot.due, obligationYear: slot.year });
    }
  }
  for (const raise of input.raises) {
    for (const { month } of raiseMonths(raise, input.holidays, input.from, input.to)) {
      result.bigMonths.push({ id: 0, planId: "", planningCategory: raise.planningCategory, amountCents: raise.amountCents, month,
        label: raise.label, createdAt: raise.createdAt, origin: "raise", sourceId: raise.id });
    }
  }
  const limit = nextDate(input.today, "annual");
  const needing = new Map<string, number[]>();
  for (const raise of input.raises) {
    if (raise.archivedAt || raise.when.kind !== "holiday") continue;
    needing.set(raise.when.calendarId, [...(needing.get(raise.when.calendarId) ?? []), raise.id]);
  }
  for (const [calendarId, raiseIds] of [...needing].sort(([a], [b]) => a.localeCompare(b))) {
    const calendar = input.calendars.find(c => c.id === calendarId);
    if (calendar?.coversThrough && calendar.coversThrough < limit) {
      result.notices.push({ kind: "calendar-runs-out", calendarId, coversThrough: calendar.coversThrough, raiseIds });
    }
  }
  result.bigMonths.sort((a, b) => a.month.localeCompare(b.month) || a.planningCategory.localeCompare(b.planningCategory) ||
    a.origin!.localeCompare(b.origin!) || a.sourceId! - b.sourceId!);
  result.bigMonths.forEach((row, index) => { row.id = -1 - index; });
  return result;
}

export function billOccurrences(input: ProjectionInput): BillOccurrence[] {
  return projectYearlyCosts(input).occurrences;
}
