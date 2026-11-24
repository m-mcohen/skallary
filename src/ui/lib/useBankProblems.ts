// src/ui/lib/useBankProblems.ts
//
// The banks that need the user, read from the saved state: the last
// sync's warnings (GET /api/simplefin/status) and every account's balance date
// (GET /api/accounts). Both are reads; nothing here syncs or writes.
//
// Saved state rather than a sync's answer, so the red banner also shows after the
// app's own start-up sync, before the user presses anything, and goes only when a sync
// comes back clean.
//
// The page used to read once, while the start-up sync was still running,
// and judge every bank on the old data. Now, while the server says a sync is
// running, the state says so (the banner shows "Syncing" instead), the read repeats
// every SYNC_POLL_MS, and once the sync is done the page reloads so the banner and
// every figure come from the new data.
import { useEffect, useState } from "react";

import { bankProblems, type BankProblem } from "../../domain/bank-problems";
import { localDateIso } from "../../domain/period";
import { getAccountsUI, getConnectorStatusUI, loadDb } from "./db";
import { getBankGraceUI } from "./db-setup";

export interface BankProblemsState {
  problems: BankProblem[];
  /** The last sync's time: the banner's x hides it until this changes. */
  lastSyncedAt: string | null;
  /** The local date the problems were worked out for. */
  today: string;
  /** A sync is running: the problems are about to be replaced, so they are not shown. */
  syncing: boolean;
  /** A sync finished after the user had used the page: offer a refresh rather than reload under the user. */
  refreshReady?: boolean;
}

/** How often the page asks whether the running sync is done. */
export const SYNC_POLL_MS = 2000;

/** Fired after a sync that does not reload the page (Settings, Sync now), so the banner reads again. */
export const SYNCED_EVENT = "finance:synced";

export async function readBankProblems(today: string = localDateIso()): Promise<BankProblemsState> {
  const db = await loadDb();
  // A grace list that cannot be read is no grace at all: every bank keeps the usual rule.
  const [status, accounts, graceDays] = await Promise.all([getConnectorStatusUI(db), getAccountsUI(db), getBankGraceUI().catch(() => ({}))]);
  return {
    problems: bankProblems({ errors: status.lastErrors ?? [], accounts, today, graceDays }),
    lastSyncedAt: status.lastSyncedAt,
    today,
    syncing: status.syncing === true,
  };
}

/** One function for the life of the page, so the effect below does not restart on every render. */
export function reloadPage(): void {
  window.location.reload();
}

/**
 * Null until read, and null when the server cannot be reached (the shell says that elsewhere).
 *
 * When a sync seen running has finished: if the user has not touched the page at all since it
 * opened (no click, key, tap or typing), onSyncDone runs once (by default the page
 * reloads). If the user has, a reload could throw away an unsaved edit, typed or clicked,
 * so instead the state carries refreshReady and the
 * banner offers a Refresh button. A failed read while waiting
 * tries again rather than giving up.
 */
export function useBankProblems(
  read: () => Promise<BankProblemsState> = readBankProblems,
  onSyncDone: () => void = reloadPage,
  pollMs: number = SYNC_POLL_MS
): BankProblemsState | null {
  const [state, setState] = useState<BankProblemsState | null>(null);
  useEffect(() => {
    let cancelled = false;
    let sawSyncing = false;
    let touched = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // From the moment the page is up, before the first status answer arrives.
    const noteTouch = () => { touched = true; };
    const TOUCH_EVENTS = ["input", "keydown", "pointerdown", "click"] as const;
    const load = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      read().then(
        (s) => {
          if (cancelled) return;
          if (s.syncing) {
            sawSyncing = true;
            setState(s);
            timer = setTimeout(load, pollMs);
            return;
          }
          if (sawSyncing) {
            // The sync finished while this page was showing older data: start again from the new.
            sawSyncing = false;
            if (touched) {
              setState({ ...s, refreshReady: true });
              return;
            }
            onSyncDone();
          }
          setState(s);
        },
        () => {
          if (cancelled) return;
          // Still waiting on a sync: a dropped read is not the end of it, so ask again.
          if (sawSyncing) {
            timer = setTimeout(load, pollMs);
            return;
          }
          setState(null);
        }
      );
    };
    for (const e of TOUCH_EVENTS) document.addEventListener(e, noteTouch, true);
    load();
    window.addEventListener(SYNCED_EVENT, load);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(SYNCED_EVENT, load);
      for (const e of TOUCH_EVENTS) document.removeEventListener(e, noteTouch, true);
    };
  }, [read, onSyncDone, pollMs]);
  return state;
}
