// src/ui/lib/period-store.ts
//
// The period the history screens (Reports, Net worth, Transactions) share.
//
// Three rules, in order of importance:
//   1. The LINK is the source of truth, so a screen can be bookmarked, reloaded,
//      and returned to with the back button and still show the same period.
//   2. Only a period picked BY HAND is remembered. A click-through ledger carries
//      its own dates, which are what is on screen while it is open, but it must
//      not quietly replace the period the person chose.
//   3. A ledger link with no dates means all dates. Writing the remembered
//      period into such a link would change what it means.
//
// A tiny external store rather than React context, because the top-bar picker
// and the section it drives sit in different branches of the tree, and because
// the link, not a component, owns the value.
import { useSyncExternalStore } from "react";
import {
  DEFAULT_PRESET,
  localDateIso,
  periodFromQuery,
  periodToQuery,
  resolvePeriod,
  type Period,
} from "../../domain/period";
import { COMPARE_OPTIONS, type CompareId } from "../../domain/compare";
import { ROUTE_ALIASES } from "../shell/nav";

/**
 * The screens the period applies to, as "section" (every tab) or "section.tab".
 * Accounts takes a period for its net worth line. Everywhere else the picker is hidden.
 */
const PERIOD_SCREENS: ReadonlySet<string> = new Set(["reports", "transactions", "accounts"]);

/** Whether the period applies to a screen. An old link (#/networth) counts as the screen it moved to. */
export function periodApplies(section: string, tab: string | null): boolean {
  const moved = ROUTE_ALIASES[section];
  const s = moved ? moved.section : section;
  const t = moved ? moved.tab : tab;
  return PERIOD_SCREENS.has(s) || (t !== null && PERIOD_SCREENS.has(`${s}.${t}`));
}

const STORAGE_KEY = "financial-future.period";
/** What the period is compared with. Reports only: it is the one screen that shows comparisons. */
const COMPARE_STORAGE_KEY = "financial-future.compare";
const COMPARE_SECTION = "reports";
/**
 * The budget lines Reports is narrowed to. Kept
 * the way the comparison is: the link wins, the last choice made by hand is
 * remembered, and only Reports reads or writes it. Empty means every line.
 */
const CATEGORIES_STORAGE_KEY = "financial-future.report-categories";
const CATEGORY_KEY = "cat";
/**
 * `allcat=1`: a link that means every category, whatever was last picked by hand
 * (the Dashboard's "See by category in Reports"). Without it, a link with no `cat`
 * restores the remembered pick, which could silently show a subset. It does not
 * change the memory; picking categories by hand drops it from the link.
 */
const ALL_CATEGORIES_KEY = "allcat";
const PERIOD_KEYS = ["period", "from", "to"];

/** Today as the person's LOCAL calendar date. Transactions carry plain dates, not instants. */
export function localToday(): string {
  return localDateIso();
}

let asOf: () => string = localToday;
let current: Period | null = null;
let currentCompare: CompareId | null = null;
let rememberedPeriod: Record<string, string> | null = null;
let rememberedCompare: CompareId | null = null;
let currentCategories: string[] | null = null;
let rememberedCategories: string[] | null = null;
/** The link the store last read. A read compares against it, so a change nobody heard is still seen. */
let syncedHash: string | null = null;
const listeners = new Set<() => void>();

const same = (a: Period | null, b: Period) =>
  a != null && a.preset === b.preset && a.from === b.from && a.to === b.to;

const isCompareId = (raw: string | null): raw is CompareId =>
  raw != null && COMPARE_OPTIONS.some((option) => option.id === raw);

function readRememberedCompare(): CompareId {
  if (rememberedCompare != null) return rememberedCompare;
  try {
    const raw = window.localStorage.getItem(COMPARE_STORAGE_KEY);
    if (isCompareId(raw)) return raw;
  } catch {
    // See readRemembered.
  }
  return "none";
}

function readRememberedCategories(): string[] {
  if (rememberedCategories != null) return rememberedCategories;
  try {
    const raw = window.localStorage.getItem(CATEGORIES_STORAGE_KEY);
    if (raw) {
      const stored: unknown = JSON.parse(raw);
      if (Array.isArray(stored) && stored.every((c) => typeof c === "string")) return stored;
    }
  } catch {
    // See readRemembered.
  }
  return [];
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Keeps the same array while the choice is unchanged, so a render reading it twice sees one value. */
function setCurrentCategories(next: string[], notify = true) {
  if (currentCategories != null && sameList(currentCategories, next)) return;
  currentCategories = next;
  if (notify) for (const listener of listeners) listener();
}

/**
 * `notify: false` is for a read made DURING a render (see getPeriod): every
 * reader in that render gets the fresh value from its own read, and telling
 * subscribers mid-render would be a state update inside another component's render.
 */
function setCurrentCompare(next: CompareId, notify = true) {
  if (currentCompare === next) return;
  currentCompare = next;
  if (notify) for (const listener of listeners) listener();
}

function setCurrent(next: Period, notify = true) {
  if (same(current, next)) return;
  current = next;
  if (notify) for (const listener of listeners) listener();
}

/** The remembered period, stored in its link form so a preset re-resolves against today. */
function readRemembered(): Period {
  if (rememberedPeriod) {
    // A pick with no dates has no link form. Storage would have fallen back below; so does memory.
    return periodFromQuery(new URLSearchParams(rememberedPeriod), asOf()) ?? resolvePeriod(DEFAULT_PRESET, asOf());
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Record<string, string>;
      const period = periodFromQuery(new URLSearchParams(stored), asOf());
      if (period) return period;
    }
  } catch {
    // Storage can be blocked, full, or hold junk. None of that is worth a blank screen.
  }
  return resolvePeriod(DEFAULT_PRESET, asOf());
}

function remember(period: Period) {
  rememberedPeriod = periodToQuery(period);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(periodToQuery(period)));
  } catch {
    // See readRemembered: the period still applies for this visit.
  }
}

function readHash(): { path: string; section: string; tab: string | null; query: URLSearchParams } {
  const raw = window.location.hash.replace(/^#/, "");
  const at = raw.indexOf("?");
  const path = at < 0 ? raw : raw.slice(0, at);
  const [section = "", tab = null] = path.split("/").filter(Boolean);
  return { path, section, tab, query: new URLSearchParams(at < 0 ? "" : raw.slice(at + 1)) };
}

/** Rewrite the link in place: the period is part of where you are, not a step to walk back through. */
function rewriteQuery(change: (query: URLSearchParams) => void) {
  const { path, query } = readHash();
  change(query);
  const text = query.toString();
  const next = text ? `#${path}?${text}` : `#${path}`;
  if (window.location.hash !== next) window.history.replaceState(null, "", next);
}

function writePeriodIntoHash(period: Period) {
  rewriteQuery((query) => {
    // Keep the comparison last, so a link reads period first, then what it is compared with.
    const compare = query.get("compare");
    for (const key of [...PERIOD_KEYS, "compare"]) query.delete(key);
    for (const [key, value] of Object.entries(periodToQuery(period))) query.set(key, value);
    if (compare) query.set("compare", compare);
  });
}

/** Every category is the absence of the key, so an ordinary link stays clean. */
function writeCategoriesIntoHash(categories: string[]) {
  rewriteQuery((query) => {
    query.delete(CATEGORY_KEY);
    query.delete(ALL_CATEGORIES_KEY);
    for (const c of categories) query.append(CATEGORY_KEY, c);
  });
}

/** "none" is the absence of the key, so an ordinary link stays clean. */
function writeCompareIntoHash(compare: CompareId) {
  rewriteQuery((query) => {
    query.delete("compare");
    if (compare !== "none") query.set("compare", compare);
  });
}

/**
 * Bring the store in line with the link.
 *
 * `quiet` is a READ: it works out the period the link means, without telling
 * subscribers and without rewriting the link, so it is safe during a render. The
 * full form runs on every hash change and whenever something subscribes.
 */
function sync(quiet: boolean): void {
  const { section, tab, query } = readHash();
  const notify = !quiet;
  if (!periodApplies(section, tab)) {
    if (current == null) current = readRemembered();
  } else if (query.get("ledger") === "1") {
    setCurrent(periodFromQuery(query, asOf()) ?? resolvePeriod("all", asOf()), notify);
  } else {
    const named = periodFromQuery(query, asOf());
    const next = named ?? readRemembered();
    setCurrent(next, notify);
    if (!named && !quiet) writePeriodIntoHash(next);

    // A merchant's page sits under Reports and takes the period only.
    if (section === COMPARE_SECTION && tab !== "merchant") {
      const raw = query.get("compare");
      const compare = isCompareId(raw) ? raw : readRememberedCompare();
      setCurrentCompare(compare, notify);
      if (!quiet && raw !== compare && !(raw == null && compare === "none")) writeCompareIntoHash(compare);

      const linked = query.getAll(CATEGORY_KEY);
      const everyCategory = query.get(ALL_CATEGORIES_KEY) === "1";
      const categories = linked.length > 0 ? linked : everyCategory ? [] : readRememberedCategories();
      setCurrentCategories(categories, notify);
      if (!quiet && linked.length === 0 && categories.length > 0) writeCategoriesIntoHash(categories);
    }
  }
  // After any rewrite above, so the next read sees the link as already understood.
  syncedHash = window.location.hash;
}

/** Bring the store in line with the link. Called on every hash change. */
export function syncPeriodFromHash(): void {
  sync(false);
}

/**
 * A read that cannot be stale. A screen with no period picker (Budget, Dashboard)
 * has nothing subscribed, so nobody hears the link change when a figure there is
 * clicked through to a ledger. Before this check the ledger opened under the
 * PREVIOUS period and its total did not match the figure.
 */
function readIfLinkChanged(): void {
  if (current == null || window.location.hash !== syncedHash) sync(true);
}

/** The person chose what to compare with. It applies now, goes into the link, and is remembered. */
export function pickCompare(compare: CompareId): void {
  rememberedCompare = compare;
  try {
    window.localStorage.setItem(COMPARE_STORAGE_KEY, compare);
  } catch {
    // See remember.
  }
  writeCompareIntoHash(compare);
  setCurrentCompare(compare);
}

/** The person chose which budget lines Reports shows. It applies now, goes into the link, and is remembered. */
export function pickReportCategories(categories: string[]): void {
  rememberedCategories = categories;
  try {
    window.localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(categories));
  } catch {
    // See remember.
  }
  writeCategoriesIntoHash(categories);
  setCurrentCategories(categories);
}

export function getReportCategories(): string[] {
  readIfLinkChanged();
  if (currentCategories == null) currentCategories = readRememberedCategories();
  return currentCategories;
}

export function useReportCategories(): string[] {
  return useSyncExternalStore(subscribePeriod, getReportCategories);
}

export function getCompare(): CompareId {
  readIfLinkChanged();
  if (currentCompare == null) currentCompare = readRememberedCompare();
  return currentCompare;
}

export function useCompare(): CompareId {
  return useSyncExternalStore(subscribePeriod, getCompare);
}

/** The person chose a period. It applies now, goes into the link, and is remembered. */
export function pickPeriod(period: Period): void {
  remember(period);
  writePeriodIntoHash(period);
  setCurrent(period);
}

/** "Today" as the store sees it, so the picker resolves a preset against the same day. */
export function periodAsOf(): string {
  return asOf();
}

export function getPeriod(): Period {
  readIfLinkChanged();
  return current ?? readRemembered();
}

/** Account activity starts with the hand-picked period, not the last ledger's dates. */
export function getRememberedPeriod(): Period {
  return readRemembered();
}

/** What a Back link carries so the screen it returns to shows the same period. */
export function periodQueryString(): string {
  return new URLSearchParams(periodToQuery(getPeriod())).toString();
}

export function subscribePeriod(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("hashchange", syncPeriodFromHash);
  listeners.add(listener);
  // A quiet read may already have understood this link; the link still has to
  // carry the period, which only the full form writes.
  sync(false);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("hashchange", syncPeriodFromHash);
  };
}

export function usePeriod(): Period {
  return useSyncExternalStore(subscribePeriod, getPeriod);
}

/** Tests pin "today" here. Also forgets the current period so each test starts clean. */
export function configurePeriodStore(options: { asOf?: () => string }): void {
  asOf = options.asOf ?? localToday;
  current = null;
  currentCompare = null;
  rememberedPeriod = null;
  rememberedCompare = null;
  currentCategories = null;
  rememberedCategories = null;
  syncedHash = null;
}
