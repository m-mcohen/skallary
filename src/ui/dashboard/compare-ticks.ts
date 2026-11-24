// src/ui/dashboard/compare-ticks.ts -- which comparisons the Dashboard shows. One shared set:
// the This month so far card and the Spending by day chart both read it, so the words and the
// picture always agree. Remembered in this browser. The first time, last month and the 12-month
// average are ticked: exactly what the Dashboard showed before the choice existed.
import { useSyncExternalStore } from "react";

export type Tick = "lastMonth" | "lastYear" | "averageThree" | "averageMonth";

/** In the order the menu, the card's lines and the legend list them. */
export const TICKS: { id: Tick; label: string }[] = [
  { id: "lastMonth", label: "Last month" },
  { id: "lastYear", label: "Same month last year" },
  { id: "averageThree", label: "3-month average" },
  { id: "averageMonth", label: "12-month average" },
];

export const TICKS_KEY = "ff.dashboard.compare";
const DEFAULT: Tick[] = ["lastMonth", "averageMonth"];
const isTick = (x: unknown): x is Tick => TICKS.some((t) => t.id === x);

let cached: { raw: string | null; ticks: Tick[] } | null = null;
const listeners = new Set<() => void>();

function rawStored(): string | null {
  try {
    return window.localStorage.getItem(TICKS_KEY);
  } catch {
    return null;
  }
}

/** The ticked comparisons; the defaults when nothing usable is stored. */
export function readTicks(): Tick[] {
  const raw = rawStored();
  if (cached && cached.raw === raw) return cached.ticks;
  let ticks = DEFAULT;
  try {
    const parsed: unknown = raw == null ? null : JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(isTick)) ticks = TICKS.map((t) => t.id).filter((id) => parsed.includes(id));
  } catch {
    // Junk in storage: the defaults.
  }
  cached = { raw, ticks };
  return ticks;
}

export function setTick(id: Tick, on: boolean): void {
  const now = readTicks();
  const next = TICKS.map((t) => t.id).filter((t) => (t === id ? on : now.includes(t)));
  const raw = JSON.stringify(next);
  try {
    window.localStorage.setItem(TICKS_KEY, raw);
    cached = null;
  } catch {
    // Storage refused: the choice holds for this visit.
    cached = { raw: rawStored(), ticks: next };
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTicks(): Tick[] {
  return useSyncExternalStore(subscribe, readTicks, readTicks);
}
