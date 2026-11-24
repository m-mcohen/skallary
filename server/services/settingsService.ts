// server/services/settingsService.ts
//
// Thin helper over the app_settings key/value table (migrations/0008).
// Split out of readService.ts so both readService (GET /api/accounts) and
// seedBudgetService (POST /api/plans/:id/seed-budget) can depend on the
// household settings without an import cycle between the two service modules.
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";
import { reseedDue, reseedDueAt } from "../../src/domain/reseed.js";
import {
  cleanHousehold, householdFromSetting, includePartnerFromSetting, HOUSEHOLD_KEY, INCLUDE_PARTNER_KEY,
  type Household,
} from "../../src/domain/household.js";
import {
  charityPotFromSetting, cleanCharityPot, cleanRateBps, rateBpsFromSetting, CHARITY_POT_KEY, POT_RATE_KEY,
  type CharityPotSetting,
} from "../../src/domain/charity-pot.js";
import type { Account } from "../../src/domain/types.js";
import { isFilingStatus, type TaxProfile } from "../../src/domain/tax.js";
import {
  cleanLaunchBrowser, isSetupStepId, isSetupStepState, isStarterFiling, setupProgressFromStored, SETUP_PROGRESS_KEY,
  type LaunchBrowser, type SetupProgress, type SetupStepId, type SetupStepState, type StarterFiling,
} from "../../src/domain/setup-progress.js";
import type { LifestyleGroup } from "../../src/domain/lifestyle-groups.js";

// app_settings keys stamped by every successful seed (seedBudgetService
// imports these; the dependency runs seed -> settings, never back).
export const LAST_SEED_AT_KEY = "last_seed_at";
export const LAST_SEED_WINDOW_KEY = "last_seed_window_months";

// The household's names: the person using the app and an
// optional partner. Nothing saved reads as null: the first-run interview asks.
export function getHousehold(): Household | null {
  return householdFromSetting(sqliteFinanceRepository().getSetting(HOUSEHOLD_KEY));
}

/** Saves the household's names; a bad value throws a plain message and writes nothing. */
export function setHousehold(raw: unknown): void {
  const h = cleanHousehold(raw);
  if (typeof h === "string") throw new Error(h);
  sqliteFinanceRepository().setSetting(HOUSEHOLD_KEY, JSON.stringify(h));
}

// Whether the partner's own accounts count, stored as 'true'/'false'. Nothing saved
// reads as true: everything in the household counts until the user says otherwise.
export function getIncludePartnerAccounts(): boolean {
  return includePartnerFromSetting(sqliteFinanceRepository().getSetting(INCLUDE_PARTNER_KEY));
}

export function setIncludePartnerAccounts(on: boolean): void {
  sqliteFinanceRepository().setSetting(INCLUDE_PARTNER_KEY, on ? "true" : "false");
}

// --- The household settings the first-run interview fills ---
// Each getter reads "absent" exactly as the contract says; a stored value that no longer
// parses reads as absent too. Each setter checks its value first and writes nothing when
// it is wrong, throwing a plain message the routes pass on.

function readJson(key: string): unknown {
  const raw = sqliteFinanceRepository().getSetting(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function fail(message: string): never {
  throw new Error(message);
}

/** The charity pot as stored, with its rate (no floor), or null: the pot is off. */
export function getCharityPotStored(): CharityPotSetting | null {
  const repo = sqliteFinanceRepository();
  const stored = charityPotFromSetting(repo.getSetting(CHARITY_POT_KEY));
  return stored ? { ...stored, rateBps: rateBpsFromSetting(repo.getSetting(POT_RATE_KEY)) } : null;
}

/** Saves the pot; a `rateBps` in the body (whole basis points, or null for none) saves the rate too. */
export function setCharityPotStored(raw: unknown): void {
  const pot = cleanCharityPot(raw);
  if (typeof pot === "string") fail(pot);
  const hasRate = !!raw && typeof raw === "object" && "rateBps" in raw;
  const rate = hasRate ? cleanRateBps((raw as { rateBps: unknown }).rateBps) : null;
  if (typeof rate === "string") fail(rate);
  const repo = sqliteFinanceRepository();
  repo.setSetting(CHARITY_POT_KEY, JSON.stringify(pot));
  if (hasRate) repo.setSetting(POT_RATE_KEY, rate === null ? "" : String(rate));
}

/**
 * The accounts as the money screens use them: with the pot off, no account is the pot account,
 * so its rows read as ordinary rows and no pot column, ledger or mark shows.
 */
export function withPotAccount(accounts: Account[]): Account[] {
  const pot = charityPotFromSetting(sqliteFinanceRepository().getSetting(CHARITY_POT_KEY));
  if (pot?.on) return accounts;
  return accounts.map((a) => (a.maaserPot ? { ...a, maaserPot: false } : a));
}

const FILING_STATUS_KEY = "tax_filing_status";
const CHILD_COUNT_KEY = "salary_child_count";
const MAX_CHILDREN = 10;

/**
 * Filing status and child count; null for either means not set up (the screens show the
 * set-this-up card). A missing, blank or non-numeric child count is absent, as
 * getSalarySettings reads it.
 */
export function getTaxProfile(): TaxProfile {
  const repo = sqliteFinanceRepository();
  const status = repo.getSetting(FILING_STATUS_KEY);
  const childrenRaw = repo.getSetting(CHILD_COUNT_KEY);
  const n = childrenRaw === null || childrenRaw.trim() === "" ? NaN : Number(childrenRaw);
  return {
    filingStatus: isFilingStatus(status) ? status : null,
    children: Number.isInteger(n) && n >= 0 ? n : null,
  };
}

/** Saves both: `{ filingStatus, children }`. */
export function setTaxProfile(raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Choose how you file and how many children you claim.");
  const { filingStatus, children } = raw as Record<string, unknown>;
  if (!isFilingStatus(filingStatus)) fail("Choose single, married filing jointly, or head of household.");
  if (typeof children !== "number" || !Number.isInteger(children) || children < 0 || children > MAX_CHILDREN) {
    fail(`The number of children is a whole number from 0 to ${MAX_CHILDREN}.`);
  }
  const repo = sqliteFinanceRepository();
  repo.setSetting(FILING_STATUS_KEY, filingStatus);
  repo.setSetting(CHILD_COUNT_KEY, String(children));
}

const STARTER_FILING_KEY = "starter_filing";

/** How the starter set files spending; null: not asked yet. */
export function getStarterFiling(): StarterFiling | null {
  const raw = sqliteFinanceRepository().getSetting(STARTER_FILING_KEY);
  return isStarterFiling(raw) ? raw : null;
}

export function setStarterFiling(v: unknown): void {
  if (!isStarterFiling(v)) fail("Choose the standard rules, the categories only, or a checklist.");
  sqliteFinanceRepository().setSetting(STARTER_FILING_KEY, v);
}

const LIFESTYLE_GROUPS_KEY = "lifestyle_groups";
const MAX_GROUP_NAME = 40;

function cleanLifestyleGroups(raw: unknown): LifestyleGroup[] | string {
  if (!Array.isArray(raw)) return "The groups are a list.";
  const ids = new Set<number>();
  const out: LifestyleGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object" || Array.isArray(g)) return "Each group needs a name and its categories.";
    const { id, name, categories } = g as Record<string, unknown>;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || ids.has(id)) return "Each group needs its own number.";
    if (typeof name !== "string" || name.trim() === "" || name.trim().length > MAX_GROUP_NAME) {
      return `Each group needs a name of at most ${MAX_GROUP_NAME} characters.`;
    }
    if (!Array.isArray(categories) || !categories.every((c) => typeof c === "string" && c.trim() !== "")) {
      return "A group's categories are a list of category names.";
    }
    ids.add(id);
    out.push({ id, name: name.trim(), categories: (categories as string[]).map((c) => c.trim()) });
  }
  return out;
}

/** The household's own lifestyle groups, or null: the starter groups apply. */
export function getLifestyleGroupsStored(): LifestyleGroup[] | null {
  const v = readJson(LIFESTYLE_GROUPS_KEY);
  if (v === undefined) return null;
  const groups = cleanLifestyleGroups(v);
  return typeof groups === "string" ? null : groups;
}

export function setLifestyleGroups(raw: unknown): void {
  const groups = cleanLifestyleGroups(raw);
  if (typeof groups === "string") fail(groups);
  sqliteFinanceRepository().setSetting(LIFESTYLE_GROUPS_KEY, JSON.stringify(groups));
}

const BANK_GRACE_KEY = "bank_grace_days";
const MAX_GRACE_DAYS = 90;

/** The good entries of a grace list (names trimmed, lower case), and the first problem found (null when none). */
function readBankGrace(raw: unknown): { grace: Record<string, number>; problem: string | null } {
  const grace: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { grace, problem: "List each bank with the days it may lag." };
  let problem: string | null = null;
  for (const [name, days] of Object.entries(raw as Record<string, unknown>)) {
    const key = name.trim().toLowerCase();
    if (key === "") problem ??= "Each bank needs its name.";
    else if (key in grace) problem ??= "A bank is listed twice.";
    else if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_GRACE_DAYS) {
      problem ??= `A bank may lag from 1 to ${MAX_GRACE_DAYS} days.`;
    } else grace[key] = days;
  }
  return { grace, problem };
}

/**
 * Banks that may lag before they count as a problem, by name (trimmed, lower case); {} when
 * none. A bad stored entry is dropped and the good ones kept.
 */
export function getBankGraceDays(): Record<string, number> {
  const v = readJson(BANK_GRACE_KEY);
  return v === undefined ? {} : readBankGrace(v).grace;
}

export function setBankGraceDays(raw: unknown): void {
  const { grace, problem } = readBankGrace(raw);
  if (problem !== null) fail(problem);
  sqliteFinanceRepository().setSetting(BANK_GRACE_KEY, JSON.stringify(grace));
}

const LAUNCH_BROWSER_KEY = "launch_browser";

/** Where the app opens, or null: the usual fallback with no profile. */
export function getLaunchBrowser(): LaunchBrowser | null {
  const v = readJson(LAUNCH_BROWSER_KEY);
  if (v === undefined) return null;
  const b = cleanLaunchBrowser(v);
  return typeof b === "string" ? null : b;
}

export function setLaunchBrowser(raw: unknown): void {
  const b = cleanLaunchBrowser(raw);
  if (typeof b === "string") fail(b);
  sqliteFinanceRepository().setSetting(LAUNCH_BROWSER_KEY, JSON.stringify(b));
}

/** How far the interview has got; {} when nothing is done. A bad stored entry is dropped and the good ones kept. */
export function getSetupProgress(): SetupProgress {
  const v = readJson(SETUP_PROGRESS_KEY);
  return v === undefined ? {} : setupProgressFromStored(v);
}

/** Marks one step done or skipped; the other steps and the finish time stay as they are. */
export function setSetupStep(id: SetupStepId, state: SetupStepState): void {
  if (!isSetupStepId(id)) fail("That is not a set-up step.");
  if (!isSetupStepState(state)) fail("A step is either done or skipped.");
  const next: SetupProgress = { ...getSetupProgress(), [id]: state };
  sqliteFinanceRepository().setSetting(SETUP_PROGRESS_KEY, JSON.stringify(next));
}

/** Saves the interview's finish time, once: a later finish keeps the first time. */
export function markSetupFinished(iso: string): void {
  const progress = getSetupProgress();
  if (progress.finishedAt) return;
  sqliteFinanceRepository().setSetting(SETUP_PROGRESS_KEY, JSON.stringify({ ...progress, finishedAt: iso }));
}

// Stored as 'true'/'false' in app_settings under 'show_guide_lines'. Missing
// (never set) reads as true: the "This page answers" line shows by default,
// and the switch under Settings, Guide turns it off for every screen at once.
export function getShowGuideLines(): boolean {
  const raw = sqliteFinanceRepository().getSetting("show_guide_lines");
  return raw === null ? true : raw === "true";
}

export function setShowGuideLines(show: boolean): void {
  sqliteFinanceRepository().setSetting("show_guide_lines", show ? "true" : "false");
}

// --- The theme: light, dark, or follow the computer ---------
// Absent (or anything unreadable) means "system": Match my computer.
export type ThemePreference = "light" | "dark" | "system";

export function getTheme(): ThemePreference {
  const raw = sqliteFinanceRepository().getSetting("ui_theme");
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function setTheme(theme: ThemePreference): void {
  sqliteFinanceRepository().setSetting("ui_theme", theme);
}

// --- Old Zelle rows named by the person in the note --
// Off until the user turns it on, after looking over the names it would create.
const ZELLE_NAMES_KEY = "merchant_zelle_memo_names";

export function getZelleMemoNames(): boolean {
  return sqliteFinanceRepository().getSetting(ZELLE_NAMES_KEY) === "true";
}

export function setZelleMemoNames(on: unknown): void {
  if (typeof on !== "boolean") throw new Error("The Zelle naming switch is either on or off.");
  sqliteFinanceRepository().setSetting(ZELLE_NAMES_KEY, on ? "true" : "false");
}

// --- The floor kept in the pot account -------------------------------------
// Whole cents, never negative. Nothing until it is typed: what the pot can give is
// its balance less this.
const MAASER_FLOOR_KEY = "maaser_floor_cents";

export function getMaaserFloorCents(): number {
  const raw = sqliteFinanceRepository().getSetting(MAASER_FLOOR_KEY);
  const n = raw === null ? 0 : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function setMaaserFloorCents(cents: unknown): void {
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0) {
    throw new Error("The floor is an amount in whole dollars and cents, zero or more.");
  }
  sqliteFinanceRepository().setSetting(MAASER_FLOOR_KEY, String(cents));
}

// --- Seed date + re-seed due -------------------------------------------------
// seedBudgetService stamps the keys after every seed; this is the read side
// plus the one manual write.

export interface SeedStatus {
  lastSeedAt: string | null;
  windowMonths: number | null;
  reseedDueAt: string | null;
  reseedDue: boolean;
}

export function getSeedStatus(now: () => number = Date.now): SeedStatus {
  const repo = sqliteFinanceRepository();
  const lastSeedAt = repo.getSetting(LAST_SEED_AT_KEY);
  const windowRaw = repo.getSetting(LAST_SEED_WINDOW_KEY);
  const windowMonths = windowRaw === null ? null : Number(windowRaw);
  return {
    lastSeedAt,
    windowMonths: windowMonths !== null && Number.isFinite(windowMonths) ? windowMonths : null,
    reseedDueAt: reseedDueAt(lastSeedAt),
    reseedDue: reseedDue(lastSeedAt, now()),
  };
}

/**
 * Sets the seed date by hand. Exists for one backfill (the live seed ran
 * before stamping did) and for a UI that seeds by another path. The stamp is
 * stored as given so the caller's timezone survives; only parseability is
 * checked, because an unparseable stamp would read as "never seeded" forever.
 */
export function setLastSeedAt(lastSeedAt: string): void {
  if (typeof lastSeedAt !== "string" || Number.isNaN(Date.parse(lastSeedAt))) {
    throw new Error(`lastSeedAt must be an ISO date-time, got ${JSON.stringify(lastSeedAt)}.`);
  }
  sqliteFinanceRepository().setSetting(LAST_SEED_AT_KEY, lastSeedAt);
}
