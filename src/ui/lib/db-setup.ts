// src/ui/lib/db-setup.ts -- client calls for the household settings routes
// (server/api/settingsRoutes.ts). Same helpers as db.ts.
import { api } from "./db";
import type { Household } from "../../domain/household";
import type { CharityPotSetting, StoredCharityPot } from "../../domain/charity-pot";
import type { FilingStatus, TaxProfile } from "../../domain/tax";
import type { LifestyleGroup } from "../../domain/lifestyle-groups";
import type { LaunchBrowser, SetupProgress, SetupStepId, StarterFiling } from "../../domain/setup-progress";
import { rememberHouseholdPeople } from "../../domain/account-display";
import { rememberHouseholdForHelp, rememberPotForHelp } from "../../help/household-words";

function remember(h: Household | null): void {
  rememberHouseholdPeople(h);
  rememberHouseholdForHelp(h);
}

/** The household's names, or null before the first-run interview. Account names and the help use them from here on. */
export async function getHouseholdUI(): Promise<Household | null> {
  const h = await api<Household | null>("/settings/household");
  remember(h);
  return h;
}

export async function setHouseholdUI(h: Household): Promise<void> {
  const saved = await api<Household | null>("/settings/household", { method: "PUT", body: JSON.stringify(h) });
  remember(saved);
}

export async function getIncludePartnerUI(): Promise<boolean> {
  const { includePartner } = await api<{ includePartner: boolean }>("/settings/include-partner");
  return includePartner;
}

export async function setIncludePartnerUI(on: boolean): Promise<void> {
  await api<void>("/settings/include-partner", { method: "POST", body: JSON.stringify({ includePartner: on }) });
}

// --- The settings the first-run interview fills ---
// Each setter's route refuses a bad value with a 400 and writes nothing; `api` then throws.

function put<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

/** The charity pot as stored, with its rate, or null when none is saved (the pot is off). */
export function getCharityPotUI(): Promise<CharityPotSetting | null> {
  return api<CharityPotSetting | null>("/settings/charity-pot");
}

/** Saves the pot; a `rateBps` (whole basis points, or null for none) saves its rate too. */
export async function setCharityPotUI(pot: StoredCharityPot & { rateBps?: number | null }): Promise<void> {
  const saved = await put<CharityPotSetting | null>("/settings/charity-pot", pot);
  rememberPotForHelp(saved);
}

/** Filing status and child count; null for either means not set up. */
export function getTaxProfileUI(): Promise<TaxProfile> {
  return api<TaxProfile>("/settings/tax");
}

export async function setTaxProfileUI(p: { filingStatus: FilingStatus; children: number }): Promise<void> {
  await put<TaxProfile>("/settings/tax", p);
}

/** How the starter set files spending, or null when not asked yet. */
export async function getStarterFilingUI(): Promise<StarterFiling | null> {
  const { filing } = await api<{ filing: StarterFiling | null }>("/settings/starter-filing");
  return filing;
}

export async function setStarterFilingUI(filing: StarterFiling): Promise<void> {
  await put<{ filing: StarterFiling | null }>("/settings/starter-filing", { filing });
}

/**
 * Starts filing the chosen way: adds the standard categories, plus every starter rule
 * ("standard-rules") or the ticked ones ("checklist"), and saves the choice. Safe to repeat.
 */
export function applyStarterFilingUI(choice: StarterFiling, ruleIds?: string[]): Promise<{ categoriesAdded: number; rulesAdded: number }> {
  return api<{ categoriesAdded: number; rulesAdded: number }>("/setup/starter", { method: "POST", body: JSON.stringify({ choice, ruleIds }) });
}

/** The household's own lifestyle groups, or null when the starter groups apply. */
export function getLifestyleGroupsUI(): Promise<LifestyleGroup[] | null> {
  return api<LifestyleGroup[] | null>("/settings/lifestyle-groups");
}

export async function setLifestyleGroupsUI(groups: LifestyleGroup[]): Promise<void> {
  await put<LifestyleGroup[] | null>("/settings/lifestyle-groups", groups);
}

/** Banks that may lag, by name (trimmed, lower case), with their days. */
export function getBankGraceUI(): Promise<Record<string, number>> {
  return api<Record<string, number>>("/settings/bank-grace");
}

export async function setBankGraceUI(grace: Record<string, number>): Promise<void> {
  await put<Record<string, number>>("/settings/bank-grace", grace);
}

/** Where the app opens, or null for the usual fallback. */
export function getLaunchBrowserUI(): Promise<LaunchBrowser | null> {
  return api<LaunchBrowser | null>("/settings/launch-browser");
}

export async function setLaunchBrowserUI(b: LaunchBrowser): Promise<void> {
  await put<LaunchBrowser | null>("/settings/launch-browser", b);
}

/** How far the interview has got. */
export function getSetupProgressUI(): Promise<SetupProgress> {
  return api<SetupProgress>("/settings/setup-progress");
}

/** Marks one step done or skipped; returns the progress as saved. */
export function setSetupStepUI(step: SetupStepId, state: "done" | "skipped"): Promise<SetupProgress> {
  return put<SetupProgress>(`/settings/setup-progress/${step}`, { state });
}

/** Ends the interview: makes this year's budget when there is none, and saves the finish time. */
export function finishSetupUI(): Promise<{ planId: string; created: boolean }> {
  return api<{ planId: string; created: boolean }>("/setup/finish", { method: "POST" });
}

/** Opens the folder the bank-link setup token is saved in (Windows only; refused on sample data). Throws the server's plain message. */
export async function openTokenFolderUI(): Promise<void> {
  const res = await fetch("/api/setup/open-token-folder", { method: "POST", credentials: "same-origin" });
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? "The folder could not be opened.");
}
