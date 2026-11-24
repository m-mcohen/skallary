// src/help/index.ts -- every help article, and how a screen finds its own.
import type { HelpScreen } from "./types";
import { NAV, SUB_PAGES } from "../ui/shell/nav";
import { DASHBOARD_HELP } from "./screens/dashboard";
import { FORECAST_HELP } from "./screens/forecast";
import { WHAT_IF_HELP } from "./screens/what-if";
import { SHORT_HELP } from "./screens/short";
import { YEARLY_HELP } from "./screens/yearly";

/** The article the Help section opens on, and what "?" shows while you are in Help. */
export const GETTING_STARTED_KEY = "getting-started";

/**
 * The screens that get the full treatment: every number defined with its
 * formula in words, steps, data sources and limits.
 */
export const FULL_DEPTH_KEYS: readonly string[] = [
  "dashboard",
  "forecast",
  "whatif",
];

const ALL: HelpScreen[] = [...DASHBOARD_HELP, ...FORECAST_HELP, ...WHAT_IF_HELP, ...SHORT_HELP, ...YEARLY_HELP];

/** Sidebar order: getting started first, then each screen as the navigation lists it. */
function navOrder(): string[] {
  const keys = NAV.filter((i) => i.id !== "help").flatMap((i) => [
    ...(i.tabs && i.tabs.length > 0 ? i.tabs.map((t) => `${i.id}.${t.id}`) : [i.id]),
    // A page under a screen follows its screen.
    ...SUB_PAGES.filter((p) => p.section === i.id).map((p) => `${p.section}.${p.page}`),
  ]);
  return [GETTING_STARTED_KEY, ...keys];
}

export const HELP_SCREENS: HelpScreen[] = (() => {
  const order = navOrder();
  const rank = (k: string) => (order.indexOf(k) === -1 ? order.length : order.indexOf(k));
  return [...ALL].sort((a, b) => rank(a.key) - rank(b.key));
})();

/** "budget" + "charts" -> "budget.charts"; a tabless section is just its id. */
export function helpKey(sectionId: string, tabId: string | null): string {
  return tabId ? `${sectionId}.${tabId}` : sectionId;
}

export function helpByKey(key: string): HelpScreen | null {
  return HELP_SCREENS.find((s) => s.key === key) ?? null;
}

/** The article for the screen you are on. The Help section itself maps to getting started. */
export function helpFor(sectionId: string, tabId: string | null): HelpScreen | null {
  if (sectionId === "help") return helpByKey(GETTING_STARTED_KEY);
  return helpByKey(helpKey(sectionId, tabId));
}
