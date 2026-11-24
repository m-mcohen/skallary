// src/help/household-words.ts -- the partner's name and the charity pot's name in the help
// text. The help is static data, so the entries that name them read them through these
// functions when they are shown (getters in glossary.ts and screens/*). The names are
// remembered when the app reads the household (src/ui/lib/db-setup.ts) and the salary settings
// (src/ui/lib/db.ts); with no partner stored the help says "your partner".
import type { Household } from "../domain/household";
import type { CharityPot } from "../domain/charity-pot";

let partnerName: string | null = null;
let pot: Pick<CharityPot, "on" | "name"> | null = null;

/** Remembers the charity pot (null: off) for the help and the screens that name it. */
export function rememberPotForHelp(p: Pick<CharityPot, "on" | "name"> | null | undefined): void {
  pot = p ?? null;
}

/** True while the charity pot is on: its help entries show only then. */
export function potOn(): boolean {
  return !!pot && pot.on;
}

/** The pot's name as the user gave it, or "charity" before one is known. */
export function potName(): string {
  return pot?.name ?? "charity";
}

export function rememberHouseholdForHelp(h: Household | null): void {
  partnerName = h?.partnerName ?? null;
}

/** "Sam" or "your partner". */
export function partner(): string {
  return partnerName ?? "your partner";
}

/** "Sam's" or "your partner's"; `start` capitalizes the fallback at the start of a sentence. */
export function partners(start = false): string {
  if (partnerName) return `${partnerName}'s`;
  return start ? "Your partner's" : "your partner's";
}
