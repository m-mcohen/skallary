// src/ui/lib/guide-visibility.ts
//
// Whether the "This page answers" line shows, app-wide. One switch, under Settings, Guide,
// controls every open screen at once, so the switch and the lines it
// controls sit in different branches of the tree -- the same shape
// period-store.ts solves for the period picker, so this follows the same
// tiny-external-store pattern rather than prop-drilling through AppShell.
//
// Stored on the server (GET/POST /api/settings/guide) rather than browser
// storage, as a getSetting/setSetting-backed
// setting.
import { useSyncExternalStore } from "react";
import { getShowGuideLinesUI, loadDb, setShowGuideLinesUI } from "./db";

// null: not yet read from the server. Treated as shown below, the same
// default the server itself uses when the setting was never saved, so
// nothing flashes on then off (or off then on) while the read is in flight.
let state: boolean | null = null;
let hydrating = false;
// Bumped by every write (hydrate's own result, or an explicit set). A slow
// GET that resolves after a person has already flipped the switch must not
// clobber the switch back -- checked below before the GET's result lands.
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function hydrate(): void {
  if (hydrating || state !== null) return;
  hydrating = true;
  const startedAtVersion = version;
  void (async () => {
    let next: boolean;
    try {
      const db = await loadDb();
      next = await getShowGuideLinesUI(db);
    } catch {
      // Server unreachable (headless build, jsdom, offline): default shown.
      next = true;
    }
    hydrating = false;
    // Nothing wrote a value while this GET was in flight: safe to apply it.
    if (version === startedAtVersion) {
      state = next;
      notify();
    }
  })();
}

export function getShowGuideLines(): boolean {
  return state ?? true;
}

export function subscribeGuideLines(listener: () => void): () => void {
  listeners.add(listener);
  hydrate();
  return () => {
    listeners.delete(listener);
  };
}

export function useShowGuideLines(): boolean {
  return useSyncExternalStore(subscribeGuideLines, getShowGuideLines);
}

/**
 * The switch on Settings, Guide. Optimistic, like the rest of the app's
 * settings toggles: every open screen updates at once, and a failed save
 * reverts the value and rethrows so the switch can show it did not save.
 */
export async function setShowGuideLines(next: boolean): Promise<void> {
  const previous = state;
  state = next;
  version++;
  notify();
  try {
    const db = await loadDb();
    await setShowGuideLinesUI(db, next);
  } catch (e) {
    state = previous;
    version++;
    notify();
    throw e;
  }
}

/** Tests: forget the hydrated value so each test starts clean (mirrors configurePeriodStore). */
export function configureGuideLinesStore(): void {
  state = null;
  hydrating = false;
  version = 0;
}
