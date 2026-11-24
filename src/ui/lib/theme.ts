// src/ui/lib/theme.ts -- the theme switch (C6). One owner of the `dark` class on <html>.
// The choice is kept on the server (app_settings "ui_theme") and cached in the browser so
// index.html can set the class before first paint. Absent means "system": follow the computer.
import { getThemeUI, loadDb, setThemeUI, type ThemePreference } from "./db";

const CACHE_KEY = "finance_theme";
const QUERY = "(prefers-color-scheme: dark)";

let preference: ThemePreference = "system";
const listeners = new Set<() => void>();

function osIsDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

/** Whether a choice shows dark right now. */
export function resolveDark(pref: ThemePreference, osDark: boolean): boolean {
  return pref === "dark" || (pref === "system" && osDark);
}

function apply(): void {
  document.documentElement.classList.toggle("dark", resolveDark(preference, osIsDark()));
}

function cache(pref: ThemePreference): void {
  try {
    localStorage.setItem(CACHE_KEY, pref);
  } catch {
    // Storage blocked: the server value still applies on every load.
  }
}

/** Set the choice in memory, on the page and in the cache (no server call). */
export function setThemePreference(pref: ThemePreference): void {
  preference = pref;
  cache(pref);
  apply();
  for (const l of listeners) l();
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function subscribeTheme(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Choose a theme: applies at once, then saves. A failed save rethrows so the screen can say so. */
export async function chooseTheme(pref: ThemePreference): Promise<void> {
  const previous = preference;
  setThemePreference(pref);
  try {
    await setThemeUI(await loadDb(), pref);
  } catch (e) {
    setThemePreference(previous);
    throw e;
  }
}

/**
 * Start at app load: read the cached choice, follow the computer's setting live in
 * "system" mode, then confirm the choice from the server. Returns a stop function.
 */
export function startTheme(): () => void {
  try {
    const c = localStorage.getItem(CACHE_KEY);
    preference = c === "light" || c === "dark" ? c : "system";
  } catch {
    preference = "system";
  }
  apply();
  const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null;
  const onChange = () => apply();
  mq?.addEventListener("change", onChange);
  void (async () => {
    try {
      const fromServer = await getThemeUI(await loadDb());
      if (fromServer !== preference) setThemePreference(fromServer);
      else cache(fromServer);
    } catch {
      // Server unreachable: the cached choice stays.
    }
  })();
  return () => mq?.removeEventListener("change", onChange);
}
