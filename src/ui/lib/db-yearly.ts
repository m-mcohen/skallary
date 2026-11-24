// src/ui/lib/db-yearly.ts -- one typed call per yearly-costs and holiday route
// (server/api/yearlyCostsRoutes.ts). A refusal carries the server's own sentence, which the
// screens show as it is; the shared `api` helper would drop it.
import type { BigMonth, BudgetChange, MonthNote } from "../../domain/plan-types";
import type { Holiday, HolidayCalendar } from "../../domain/holidays";
import type { BillEvent } from "../../data/yearly-costs.store";
import type { BillOccurrence, Projection, Raise, RaiseWhen, YearlyBill } from "../../domain/yearly-costs";
import type { BillProposal, RaiseProposal } from "../../domain/yearly-proposals";
import type { HeadsUpItem } from "../../domain/yearly-heads-up";
import { api, type Db } from "./db";

export interface BudgetExtras {
  changes: BudgetChange[];
  bigMonths: BigMonth[];
  notes: MonthNote[];
  yearlyTxnIds: string[];
}

export function getBudgetExtrasFullUI(_db: Db, planId: string): Promise<BudgetExtras> {
  return api(`/plans/${encodeURIComponent(planId)}/budget-extras`);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) {
    let message = "That could not be done. Nothing was changed.";
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error) message = body.error;
    } catch {
      // The server sent no readable reason.
    }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export interface BillInput {
  planningCategory: string; label: string; payeeKey: string; accountId: string | null;
  amountCents: number | null; months: string[]; takeOutOfLine?: boolean;
}
export interface RaiseInput { planningCategory: string; label: string; amountCents: number; when: RaiseWhen }
export interface BillCharge { id: string; date: string; amountCents: number; label: string }
export type OccurrencesResult = Pick<Projection, "occurrences" | "bigMonths" | "notices" | "yearlyTxnIds">;
export interface ImportResult { calendar: HolidayCalendar; imported: number; problems: string[] }

export const getHolidayCalendarsUI = () => call<HolidayCalendar[]>("/holiday-calendars");
export const importCalendarUI = (name: string, text: string, calendarId?: string) =>
  call<ImportResult>(`/holiday-calendars/import?name=${encodeURIComponent(name)}${calendarId ? `&calendarId=${encodeURIComponent(calendarId)}` : ""}`,
    { method: "POST", headers: { "Content-Type": "text/calendar" }, body: text });
export const setCalendarOnUI = (id: string, on: boolean) => call<void>(`/holiday-calendars/${encodeURIComponent(id)}`, send("PUT", { on }));
export const removeCalendarUI = (id: string) => call<void>(`/holiday-calendars/${encodeURIComponent(id)}`, send("DELETE"));
export const getHolidaysUI = (from: string, to: string) => call<Holiday[]>(`/holidays?from=${from}&to=${to}`);

export const listBillsUI = () => call<YearlyBill[]>("/yearly/bills");
export const addBillUI = (bill: BillInput) => call<YearlyBill>("/yearly/bills", send("POST", bill));
export const updateBillUI = (id: number, bill: BillInput) => call<void>(`/yearly/bills/${id}`, send("PUT", bill));
export const removeBillUI = (id: number) => call<void>(`/yearly/bills/${id}`, send("DELETE"));
export type BillEventInput = Pick<BillEvent, "kind" | "obligationYear" | "dueMonth"> & { sourceTransactionId?: string };
export const recordBillEventUI = (id: number, event: BillEventInput) => call<void>(`/yearly/bills/${id}/events`, send("POST", event));
export const chargesForBillUI = (id: number) => call<BillCharge[]>(`/yearly/bills/${id}/charges`);
export const getOccurrencesUI = (from: string, to: string) => call<OccurrencesResult>(`/yearly/occurrences?from=${from}&to=${to}`);

export const listRaisesUI = () => call<Raise[]>("/yearly/raises");
export const addRaiseUI = (raise: RaiseInput) => call<Raise>("/yearly/raises", send("POST", raise));
export const updateRaiseUI = (id: number, raise: RaiseInput) => call<Raise>(`/yearly/raises/${id}`, send("PUT", raise));
export const removeRaiseUI = (id: number) => call<void>(`/yearly/raises/${id}`, send("DELETE"));

export const getProposalsUI = () => call<{ bills: BillProposal[]; raises: RaiseProposal[] }>("/yearly/proposals");
export const getHeadsUpUI = () => call<HeadsUpItem[]>("/yearly/heads-up");

export type { BillOccurrence };
