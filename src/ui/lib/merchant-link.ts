// src/ui/lib/merchant-link.ts
//
// A merchant's page has its own link: a page under Reports,
// #/reports/merchant?name=Publix&period=...&back=... The period rides in it, so a
// bookmark shows the same dates, and Back returns where it was opened from.
// Everything read back is checked: the address bar is user input.
import { periodToQuery, type Period } from "../../domain/period";

export const MERCHANT_PAGE = "merchant";
const DEFAULT_BACK = "#/reports";

export function merchantHref(name: string, back: string, period?: Period): string {
  const q = new URLSearchParams({ name });
  if (period) for (const [k, v] of Object.entries(periodToQuery(period))) q.set(k, v);
  q.set("back", back);
  return `#/reports/${MERCHANT_PAGE}?${q.toString()}`;
}

export function parseMerchantQuery(q: URLSearchParams): { name: string; back: string } {
  const back = q.get("back") ?? "";
  return { name: (q.get("name") ?? "").trim(), back: back.startsWith("#/") ? back : DEFAULT_BACK };
}
