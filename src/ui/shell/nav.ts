// src/ui/shell/nav.ts
//
// The navigation manifest -- one array driving the sidebar, the page title,
// the sub-tab strip, and route validation. Adding a screen means adding one
// entry here and one branch in AppShell's dispatch.
//
// The group labels carry the distinction the old four modes buried. RECORD is
// what actually happened, PLAN is what you intend, MODEL is what would change
// it. The mistake in the mode design was not the grouping -- it was making the
// grouping a FILTER that hid twelve destinations behind four words. Here the
// same idea is a LABEL over a list where everything is visible at once.
//
// Notes and Settings sit outside the three groups deliberately: Notes is a
// record of decisions already made, and Settings is configuration. Neither is
// a projection or a monthly edit, so filing them under MODEL would misdescribe
// them.
import {
  BarChart3Icon,
  CalendarClockIcon,
  CircleHelpIcon,
  GitBranchIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  NotebookIcon,
  ReceiptTextIcon,
  SettingsIcon,
  TargetIcon,
  TrendingUpIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { DEFAULT_SECTION, type Route } from "./router";

export type NavGroup = "record" | "plan" | "model" | "other";

export interface NavTab {
  id: string;
  label: string;
}

export interface NavItem {
  /** Also the route section: `#/<id>`. */
  id: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Two or more sub-views, rendered as a tab strip under the header. */
  tabs?: NavTab[];
  /** Its figures follow the what-if that is on; every other screen's banner says it does not. */
  usesWhatIf?: boolean;
}

/** `null` renders the group with no heading, above the settings divider. */
export const GROUP_LABELS: Record<NavGroup, string | null> = {
  record: "Record",
  plan: "Plan",
  model: "Model",
  other: null,
};

/** Render order. Groups appear in the order they first occur here. */
export const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboardIcon, group: "record", usesWhatIf: true },
  {
    id: "accounts",
    label: "Accounts",
    icon: LandmarkIcon,
    group: "record",
  },
  {
    id: "transactions",
    label: "Transactions",
    icon: ReceiptTextIcon,
    group: "record",
    tabs: [
      { id: "all", label: "All" },
      { id: "needs-category", label: "Needs a category" },
    ],
  },
  { id: "reports", label: "Reports", icon: BarChart3Icon, group: "record" },
  {
    id: "budget",
    label: "Budget",
    icon: WalletIcon,
    group: "plan",
    tabs: [
      // Month replaces the old Table; old #/budget/table links land here.
      { id: "month", label: "Month" },
      { id: "year", label: "Year" },
      { id: "yearly", label: "Yearly costs" },
      { id: "charts", label: "Charts" },
    ],
  },
  // Bills became Recurring. Old links land here (ROUTE_ALIASES).
  { id: "recurring", label: "Recurring", icon: CalendarClockIcon, group: "plan" },
  {
    id: "goals",
    label: "Goals",
    icon: TargetIcon,
    group: "plan",
    tabs: [
      { id: "goals", label: "Goals" },
      { id: "wishlist", label: "Wish List" },
    ],
  },
  // One screen for the what-if job: it replaced Scenarios
  // and Lifestyle. Old links to either land here (ROUTE_ALIASES).
  { id: "whatif", label: "What if", icon: GitBranchIcon, group: "model", usesWhatIf: true },
  // Wealth is retired and Runway becomes
  // Forecast, here under Model in Wealth's place; Plan lost its Runway entry. Same screen and
  // chart as Runway for now. Old Runway, Wealth and Long-term links land here (ROUTE_ALIASES).
  { id: "forecast", label: "Forecast", icon: TrendingUpIcon, group: "model", usesWhatIf: true },
  { id: "notes", label: "Notes", icon: NotebookIcon, group: "other" },
  {
    id: "settings",
    label: "Settings",
    icon: SettingsIcon,
    group: "other",
    tabs: [
      { id: "connection", label: "Bank connection" },
      { id: "accounts", label: "Accounts" },
      { id: "mappings", label: "Mappings" },
      // The rename list and the suggested merges.
      { id: "merchants", label: "Merchants" },
      { id: "salary", label: "Salary" },
      // The guide line's on/off switch.
      { id: "guide", label: "Guide" },
      { id: "appearance", label: "Appearance" },
      // The household's names and what is still to set up.
      { id: "household", label: "Household" },
      { id: "about", label: "About" },
    ],
  },
  // The manual: every screen's help article plus the glossary.
  // No tabs: the second route segment picks the article (#/help/budget.charts),
  // read directly by AppShell, so resolveRoute leaves it alone.
  { id: "help", label: "Help", icon: CircleHelpIcon, group: "other" },
];

/**
 * Pages that live under a screen without a sidebar entry or a tab: reached by a
 * link, with their own help article (helpKey) and "This page
 * answers" line. A page per merchant, under Reports,
 * at #/reports/merchant?name=...
 */
export interface SubPage {
  section: string;
  page: string;
  label: string;
}
export const SUB_PAGES: SubPage[] = [{ section: "reports", page: "merchant", label: "Merchant" }];

/** The sub-page a route names, or null. */
export function findSubPage(section: string, page: string | null): SubPage | null {
  return SUB_PAGES.find((p) => p.section === section && p.page === page) ?? null;
}

export function findNav(sectionId: string): NavItem | undefined {
  return NAV.find((i) => i.id === sectionId);
}

/**
 * Screens that moved. An old bookmark or a link from an
 * earlier version still lands on the screen that took its place.
 */
export const ROUTE_ALIASES: Record<string, Route> = {
  networth: { section: "accounts", tab: null },
  // What if replaced both.
  scenarios: { section: "whatif", tab: null },
  lifestyle: { section: "whatif", tab: null },
  // Long-term became Wealth, with no tabs. Wealth was retired
  // and Runway became Forecast, so all three land on Forecast. An alias is read once, not
  // chained, so each points straight at the screen that exists.
  "long-term": { section: "forecast", tab: null },
  wealth: { section: "forecast", tab: null },
  runway: { section: "forecast", tab: null },
  // Bills became Recurring.
  bills: { section: "recurring", tab: null },
};

/**
 * Validate and repair a route.
 *
 * An unknown section falls back to the default and an unknown or missing tab
 * falls back to the item's first, so a stale bookmark, a hand-typed hash, or a
 * link from a version of the app that had different screens always lands on
 * something real rather than a blank body.
 */
export function resolveRoute(original: Route): { item: NavItem; tab: NavTab | null } {
  const route = ROUTE_ALIASES[original.section] ?? original;
  const item = findNav(route.section) ?? findNav(DEFAULT_SECTION) ?? NAV[0];
  if (!item.tabs || item.tabs.length === 0) return { item, tab: null };
  const tab = item.tabs.find((t) => t.id === route.tab) ?? item.tabs[0];
  return { item, tab };
}
