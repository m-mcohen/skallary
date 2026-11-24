// src/domain/bank-problems.ts
//
// The banks that need attention, each named once. Pure: no I/O, and today and
// the per-bank grace come in as parameters.
//
// Two kinds, because SimpleFIN only reports one of them:
//   sign-in  The Bridge said con.auth for that connection: sign in again on its
//            website.
//   quiet    No error at all, but the bank's newest balance is more than
//            QUIET_AFTER_DAYS days old (a card that stops sending, with SimpleFIN
//            saying nothing).
// A bank that is both is listed once, as sign-in, carrying its last data date.
//
// The Sync button's box, the red banner on every screen, the Dashboard's footer
// line and Settings, Bank connection all read this one list.
import type { Account } from "./types";
import type { MappedError } from "./simplefin";
import { signInNeeded } from "./simplefin";
import { formatShortDate } from "./period";

/** A bank is quiet when its newest balance is MORE than this many days old (4 or more). A bank with its own grace waits that many days instead. */
export const QUIET_AFTER_DAYS = 3;

/** Where a sign-in is fixed: the SimpleFIN Bridge sign-in page. */
export const BRIDGE_URL = "https://beta-bridge.simplefin.org/auth/login";

export type BankProblem =
  | { kind: "sign-in"; bank: string; lastDataDate: string | null }
  | { kind: "quiet"; bank: string; lastDataDate: string };

export interface BankProblemsInput {
  /** The last sync's saved warnings. */
  errors: Pick<MappedError, "code" | "message" | "connectionName">[];
  accounts: Pick<Account, "institution" | "balanceDate" | "archived">[];
  /** Local calendar date, YYYY-MM-DD. */
  today: string;
  /**
   * Banks that may lag before they are named, by name (trimmed, lower case) with their days.
   * A bank whose sign-in lapses often, and cannot be kept signed in, is the usual case. {} when none.
   */
  graceDays: Record<string, number>;
}

const DAY_MS = 86_400_000;
const UNNAMED_BANK = "A bank with no name";

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Bank names match without minding case or stray spaces: the connection's name and the account's institution come from two fields. */
function sameBank(name: string): string {
  return name.trim().toLowerCase();
}

/** The days a bank may lag, or undefined; an inherited name such as "constructor" is not a bank. */
function graceFor(graceDays: Record<string, number>, key: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(graceDays, key) ? graceDays[key] : undefined;
}

export function bankProblems({ errors, accounts, today, graceDays }: BankProblemsInput): BankProblem[] {
  // Each bank's newest balance date, from live accounts that have one.
  const newest = new Map<string, { bank: string; date: string }>();
  for (const a of accounts) {
    if (a.archived || !a.balanceDate) continue;
    const bank = a.institution?.trim() || UNNAMED_BANK;
    const key = sameBank(bank);
    const seen = newest.get(key);
    if (!seen || a.balanceDate > seen.date) newest.set(key, { bank, date: a.balanceDate });
  }

  const problems: BankProblem[] = [];
  const listed = new Set<string>();
  for (const name of signInNeeded(errors)) {
    const key = sameBank(name);
    if (listed.has(key)) continue;
    listed.add(key);
    const lastDataDate = newest.get(key)?.date ?? null;
    // A bank given grace waits like a quiet one; with no dated account it shows.
    const patience = graceFor(graceDays, key);
    if (patience !== undefined && lastDataDate && daysBetween(lastDataDate, today) <= patience) continue;
    problems.push({ kind: "sign-in", bank: name.trim(), lastDataDate });
  }

  const quiet: BankProblem[] = [];
  for (const [key, { bank, date }] of newest) {
    if (listed.has(key)) continue;
    if (daysBetween(date, today) > (graceFor(graceDays, key) ?? QUIET_AFTER_DAYS)) quiet.push({ kind: "quiet", bank, lastDataDate: date });
  }
  // Oldest first: the longest silence is the one most worth a look.
  quiet.sort((a, b) => (a.lastDataDate! < b.lastDataDate! ? -1 : a.lastDataDate! > b.lastDataDate! ? 1 : a.bank.localeCompare(b.bank)));
  return [...problems, ...quiet];
}

/** "Lakeshore needs a sign-in (no new data since Oct 3)" or "No new data from Harbor Card since Sep 22". */
export function bankProblemShort(p: BankProblem, today: string): string {
  if (p.kind === "quiet") return `No new data from ${p.bank} since ${formatShortDate(p.lastDataDate, today)}`;
  return p.lastDataDate
    ? `${p.bank} needs a sign-in (no new data since ${formatShortDate(p.lastDataDate, today)})`
    : `${p.bank} needs a sign-in`;
}

/** What to do about it, as one sentence. */
export function bankProblemStep(p: BankProblem): string {
  return p.kind === "sign-in"
    ? `Sign in to ${p.bank} on the SimpleFIN Bridge site.`
    : "Check its sign-in on the SimpleFIN Bridge site.";
}

/** "1 bank needs you", "2 banks need you". */
export function banksNeedYou(count: number): string {
  return count === 1 ? "1 bank needs you" : `${count} banks need you`;
}
