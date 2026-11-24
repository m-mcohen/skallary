// src/ui/dashboard/month-link.ts -- the Dashboard's month in its link, so Back and refresh keep it.
//
// The pattern Reports uses for `compare=` and `cat=` (src/ui/lib/period-store.ts):
// the choice is a key in the hash's query, `#/dashboard?month=2026-08`; this
// month is the ABSENCE of the key, so the ordinary link stays `#/dashboard`; a
// change rewrites the link in place with history.replaceState (the month is part
// of where you are, not a step to walk back through); and the link is read on
// load and on every hash change, which is what Back fires.
import { useCallback, useEffect, useState } from "react";

import { periodOf } from "../../domain/period";

export const MONTH_KEY = "month";

function splitHash(): { path: string; query: URLSearchParams } {
  const raw = window.location.hash.replace(/^#/, "");
  const at = raw.indexOf("?");
  return { path: (at < 0 ? raw : raw.slice(0, at)) || "/dashboard", query: new URLSearchParams(at < 0 ? "" : raw.slice(at + 1)) };
}

/** The month the link names, as written (unchecked); null when it names none. */
export function monthInLink(): string | null {
  return splitHash().query.get(MONTH_KEY);
}

/** The Dashboard link for a month: this month is the plain `#/dashboard`. */
export function dashboardHref(month: string, today: string): string {
  return month === periodOf(today) ? "#/dashboard" : `#/dashboard?${MONTH_KEY}=${month}`;
}

/** Put the month into the link in place (no new history entry); this month takes the key out. */
export function writeMonthIntoLink(month: string, today: string): void {
  const { path, query } = splitHash();
  query.delete(MONTH_KEY);
  if (month !== periodOf(today)) query.set(MONTH_KEY, month);
  const text = query.toString();
  const next = text ? `#${path}?${text}` : `#${path}`;
  if (window.location.hash !== next) window.history.replaceState(null, "", next);
}

/**
 * The month as the link says it (raw, unchecked: the caller fits it to the
 * months that exist), and a setter that writes the link.
 */
export function useMonthInLink(today: string): [string | null, (month: string) => void] {
  const [raw, setRaw] = useState<string | null>(monthInLink);
  useEffect(() => {
    const read = () => setRaw(monthInLink());
    window.addEventListener("hashchange", read);
    // The link can change between the first render and this effect.
    read();
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const choose = useCallback(
    (month: string) => {
      writeMonthIntoLink(month, today);
      setRaw(month === periodOf(today) ? null : month);
    },
    [today]
  );
  return [raw, choose];
}
