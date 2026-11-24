// src/ui/shell/router.ts
//
// The whole router. Navigation state lives in `location.hash` rather than in
// React state, which is what makes the back button, refresh, and bookmarking
// work -- before this, every reload dumped you back on the landing screen.
//
// Hash routing rather than the History API on purpose: the app is served both
// by Vite on :1420 and by the Express server out of dist/, and a path-based
// router would need a history fallback configured in both. A hash never
// reaches the server at all.
//
// This module deliberately does not know which sections are real. Validation
// lives in nav.ts, so the router stays independently testable and the two
// modules cannot import each other in a cycle.
import { useEffect, useState } from "react";

export interface Route {
  section: string;
  tab: string | null;
}

/** Where an empty, absent, or unparseable hash lands. */
export const DEFAULT_SECTION = "dashboard";

/**
 * `#/section/tab` -> `{ section, tab }`.
 *
 * Anything beyond the second segment is dropped rather than treated as an
 * error: a stale bookmark from an earlier shape of the app should still open
 * the right screen instead of a blank one.
 */
export function parseHash(hash: string): Route {
  // Strip the leading "#", then any query string -- a "?" is not part of the
  // route, and folding it into the tab would break filter links later.
  const raw = hash.replace(/^#/, "").split("?")[0];
  const segments = raw
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        // A malformed escape sequence must not take the app down.
        return s;
      }
    });

  if (segments.length === 0) return { section: DEFAULT_SECTION, tab: null };
  return { section: segments[0], tab: segments[1] ?? null };
}

export function formatRoute(route: Route): string {
  const parts = [route.section, route.tab].filter((p): p is string => Boolean(p));
  return "#/" + parts.map(encodeURIComponent).join("/");
}

/**
 * Assigning to `location.hash` is what pushes the history entry; the browser
 * then fires `hashchange`, which is what `useRoute` below listens to. The
 * no-op guard matters because clicking the nav item you are already on would
 * otherwise stack a duplicate entry and make the back button feel broken.
 */
export function navigate(route: Route): void {
  const next = formatRoute(route);
  if (window.location.hash === next) return;
  window.location.hash = next;
}

/** The current route, re-rendering the subscriber on every hash change. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    // The hash can change between first render and this effect running.
    onChange();
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}
