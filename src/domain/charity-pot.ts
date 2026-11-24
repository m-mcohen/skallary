// src/domain/charity-pot.ts -- the optional charity pot: its settings, and what it owes.
import type { OwnerSlot } from "./household";
export type PotKind = "percent" | "monthly" | "yearly";
export interface CharityPot {
  on: boolean; name: string; kind: PotKind;
  rateBps: number | null;          // used when kind = "percent"
  fixedCents: number | null;       // monthly: a month; yearly: a year
  fixedFrom: string | null;        // "YYYY-MM"
  counts: { me: boolean; partner: boolean; joint: boolean }; // which owner slots' accounts count toward a percent pot
  floorCents: number;
}

/** The pot as stored under `charity_pot`; the rate and floor live in their own keys. */
export type StoredCharityPot = Omit<CharityPot, "rateBps" | "floorCents">;

/** The app_settings key that holds the charity pot. */
export const CHARITY_POT_KEY = "charity_pot";

const POT_KINDS: readonly PotKind[] = ["percent", "monthly", "yearly"];
const MAX_POT_NAME = 40;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A stored pot from untrusted input, or a plain message saying what is wrong. */
export function cleanCharityPot(raw: unknown): StoredCharityPot | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "The charity pot needs its settings.";
  const { on, name, kind, fixedCents, fixedFrom, counts } = raw as Record<string, unknown>;
  if (typeof on !== "boolean") return "The charity pot is either on or off.";
  if (typeof name !== "string" || name.trim() === "") return "Give the pot a name.";
  if (name.trim().length > MAX_POT_NAME) return `The pot's name is at most ${MAX_POT_NAME} characters.`;
  if (typeof kind !== "string" || !(POT_KINDS as readonly string[]).includes(kind)) {
    return "The pot is a share of pay, a set amount a month, or a set amount a year.";
  }
  const fixed = kind === "percent" ? null : fixedCents;
  if (fixed !== null && (typeof fixed !== "number" || !Number.isInteger(fixed) || fixed < 0)) {
    return "The set amount is in whole dollars and cents, zero or more.";
  }
  if (kind !== "percent" && fixed === null) return "Type the set amount.";
  const from = fixedFrom ?? null;
  if (from !== null && (typeof from !== "string" || !MONTH.test(from))) return "The start month reads like 2026-03.";
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return "Say whose accounts count toward the pot.";
  const c = counts as Record<string, unknown>;
  if (typeof c.me !== "boolean" || typeof c.partner !== "boolean" || typeof c.joint !== "boolean") {
    return "Say whose accounts count toward the pot.";
  }
  return {
    on, name: name.trim(), kind: kind as PotKind, fixedCents: fixed as number | null, fixedFrom: from,
    counts: { me: c.me, partner: c.partner, joint: c.joint },
  };
}

/** The stored pot, or null when nothing usable is saved (the pot is then off). */
export function charityPotFromSetting(raw: string | null): StoredCharityPot | null {
  if (raw === null) return null;
  try {
    const p = cleanCharityPot(JSON.parse(raw));
    return typeof p === "string" ? null : p;
  } catch {
    return null;
  }
}

// --- What the pot owes, a month and over a span ---
// Months are "YYYY-MM". A percent pot's figures run the same float operations, in the same
// order, as the single rate they replace (rate = rateBps / 10000, times the base, rounded
// once), so a percent pot gives the same cents as before to the cent.

const monthIndex = (m: string): number => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const monthOf = (i: number): string => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const previousMonth = (m: string): string => monthOf(monthIndex(m) - 1);
const later = (a: string, b: string): string => (a > b ? a : b);

/** The rate a percent pot gives, as a fraction (0.05 for 500 basis points); 0 with no rate. */
const rateOf = (pot: CharityPot): number => (pot.rateBps ?? 0) / 10000;

/**
 * A yearly pot's share owed from `anchor` through `m`: a twelfth of the year a month, rounded on
 * the running count, so any twelve months in a row add up to the year exactly.
 */
function yearlyShareThrough(pot: CharityPot, anchor: string, m: string): number {
  const n = m < anchor ? 0 : monthIndex(m) - monthIndex(anchor) + 1;
  return Math.round(((pot.fixedCents ?? 0) * n) / 12);
}

/**
 * The fraction of pay the money screens use. No pot passed (undefined): the given rate, as
 * before the pot existed. Off, or a set amount: 0 (a set amount is not a share of pay).
 */
export function effectiveMaaserRate(pot: CharityPot | null | undefined, legacyRate: number): number {
  if (pot === undefined) return legacyRate;
  if (pot === null || !pot.on || pot.kind !== "percent") return 0;
  return rateOf(pot);
}

/** What the pot owes over `fromMonth` to `toMonth`, both included. */
export function potOwedCents(pot: CharityPot, countedIncomeCents: number, fromMonth: string, toMonth: string): number {
  if (!pot.on) return 0;
  if (pot.kind === "percent") return Math.round(rateOf(pot) * countedIncomeCents);
  // With no start month, a yearly pot runs on calendar years, as potMonthCents reads it.
  const anchor = pot.fixedFrom ?? (pot.kind === "yearly" ? `${fromMonth.slice(0, 4)}-01` : fromMonth);
  const start = later(fromMonth, anchor);
  if (start > toMonth) return 0;
  if (pot.kind === "monthly") return (pot.fixedCents ?? 0) * (monthIndex(toMonth) - monthIndex(start) + 1);
  return yearlyShareThrough(pot, anchor, toMonth) - yearlyShareThrough(pot, anchor, previousMonth(start));
}

/**
 * The pot's amount for one month of the Budget and Forecast. A percent pot takes its rate of
 * `payBaseAnnualCents` (the W-2 pay after tax and benefits, a year) over twelve, rounded once.
 */
export function potMonthCents(pot: CharityPot, month: string, payBaseAnnualCents: number): number {
  if (!pot.on) return 0;
  if (pot.kind === "percent") return Math.round((rateOf(pot) * payBaseAnnualCents) / 12);
  if (pot.kind === "monthly") return pot.fixedFrom !== null && month < pot.fixedFrom ? 0 : pot.fixedCents ?? 0;
  const anchor = pot.fixedFrom ?? `${month.slice(0, 4)}-01`;
  return yearlyShareThrough(pot, anchor, month) - yearlyShareThrough(pot, anchor, previousMonth(month));
}

/** The pot a year, for the salary math. No pot passed (undefined): the given rate of the base. */
export function potAnnualModelCents(pot: CharityPot | null | undefined, baseAnnualCents: number, legacyRate: number): number {
  if (pot === undefined) return legacyRate * baseAnnualCents;
  if (pot === null || !pot.on) return 0;
  if (pot.kind === "percent") return rateOf(pot) * baseAnnualCents;
  return pot.kind === "monthly" ? (pot.fixedCents ?? 0) * 12 : pot.fixedCents ?? 0;
}

/** Whether an owner slot's accounts count toward the pot. No pot passed (undefined): the user's own only. */
export function potCountsOwner(pot: Pick<CharityPot, "on" | "counts"> | null | undefined, owner: OwnerSlot): boolean {
  if (pot === undefined) return owner === "me";
  if (pot === null || !pot.on) return false;
  return pot.counts[owner];
}

/** True when the pot is on: every pot line, panel, label and help entry shows only then. */
export function potIsOn(pot: Pick<CharityPot, "on"> | null | undefined): boolean {
  return !!pot && pot.on;
}

/** The pot's name on screen; "Charity" when there is no pot. */
export function potLabel(pot: Pick<CharityPot, "name"> | null | undefined): string {
  return pot?.name ?? "Charity";
}

/**
 * The pot the money screens use, from its three keys: the stored pot, the rate (a missing, blank
 * or non-numeric rate reads as none) and the floor. Null when no pot is stored: the pot is off.
 */
export function composeCharityPot(stored: StoredCharityPot | null, rateBpsRaw: string | null, floorCents: number): CharityPot | null {
  if (!stored) return null;
  return { ...stored, rateBps: rateBpsFromSetting(rateBpsRaw), floorCents };
}

/** The app_settings key that holds a percent pot's rate, in basis points ("500" = 5 percent). */
export const POT_RATE_KEY = "salary_maaser_rate_bps";

/** The stored rate in basis points; a missing, blank or non-numeric value reads as none (null). */
export function rateBpsFromSetting(raw: string | null): number | null {
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** A rate from untrusted input: whole basis points from 0 to 10,000, or null for none; else a plain message. */
export function cleanRateBps(raw: unknown): number | null | string {
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 10_000) {
    return "The share of pay is a percent from 0 to 100, to two decimal places.";
  }
  return raw;
}

/** The pot as the settings screen reads and saves it: the stored pot and its rate. */
export type CharityPotSetting = StoredCharityPot & { rateBps: number | null };
