// src/domain/networth.ts
//
// Pure. Net worth today (the headline and the By account table) and net worth
// over time (the chart) follow ONE account rule and ONE sign rule, so the
// chart's last point is the headline.
//
// Over time comes from the balance readings each sync stores. A back-cast from
// transactions was tried and could not recover balances: it mixed in archived
// records, dropped live accounts before their first transaction, and transfers
// between owned accounts cancel to zero in the feed. Months before the first
// reading are left off.
import type { AccountBalance, BalanceReading } from "./plan-types";
import type { Period } from "./period";
import type { Account } from "./types";
import { isCardAccount, isLoanAccount } from "./runway";

export interface NetWorthMonth {
  period: string;
  cents: number;
  /** The day of the latest reading inside this month. */
  lastRecordedOn: string;
}

/**
 * Whether an account's balance is part of net worth.
 *
 * An ARCHIVED record is the superseded record of a live account (or one no
 * longer connected), so it is left out. The partner's own accounts follow the
 * include switch, the same rule Drawable uses. The spending switch
 * (includeInSpend) does NOT decide this: an account whose transactions are not
 * spending is still the household's money.
 */
export function countsTowardNetWorth(account: Account, includePartner: boolean): boolean {
  if (account.archived) return false;
  return account.owner !== "partner" || includePartner;
}

/** Card and loan balances always SUBTRACT, whichever sign the feed reports. */
function signed(account: Account, rawCents: number): number {
  return isCardAccount(account) || isLoanAccount(account) ? -Math.abs(rawCents) : rawCents;
}

/** The accounts that make up net worth today, each with its signed amount. */
export function netWorthRows(
  accounts: Account[],
  balances: AccountBalance[],
  includePartner: boolean
): { account: Account; cents: number }[] {
  const byId = new Map(balances.map((b) => [b.accountId, b.balanceCents]));
  const rows: { account: Account; cents: number }[] = [];
  for (const account of accounts) {
    if (!countsTowardNetWorth(account, includePartner)) continue;
    const raw = byId.get(account.id);
    if (raw === undefined) continue;
    rows.push({ account, cents: signed(account, raw) });
  }
  return rows;
}

export function netWorthCents(accounts: Account[], balances: AccountBalance[], includePartner: boolean): number {
  return netWorthRows(accounts, balances, includePartner).reduce((sum, r) => sum + r.cents, 0);
}

/** One point per day that has a reading, each counted account's latest reading on or before it, signed, summed; `period` is the day. */
export function netWorthByDay(accounts: Account[], readings: BalanceReading[], includePartner: boolean): NetWorthMonth[] {
  return netWorthSeries(accounts, readings, includePartner, 10);
}

function netWorthSeries(accounts: Account[], readings: BalanceReading[], includePartner: boolean, keyLength: 7 | 10): NetWorthMonth[] {
  const counted = new Map(accounts.filter((a) => countsTowardNetWorth(a, includePartner)).map((a) => [a.id, a]));
  const mine = readings
    .filter((r) => counted.has(r.accountId))
    .sort((a, b) => (a.recordedOn < b.recordedOn ? -1 : a.recordedOn > b.recordedOn ? 1 : 0));

  const out: NetWorthMonth[] = [];
  const latest = new Map<string, number>();
  let i = 0;
  while (i < mine.length) {
    const period = mine[i].recordedOn.slice(0, keyLength);
    let lastRecordedOn = mine[i].recordedOn;
    for (; i < mine.length && mine[i].recordedOn.slice(0, keyLength) === period; i++) {
      latest.set(mine[i].accountId, mine[i].balanceCents);
      lastRecordedOn = mine[i].recordedOn;
    }
    let cents = 0;
    for (const [id, raw] of latest) cents += signed(counted.get(id)!, raw);
    out.push({ period, cents, lastRecordedOn });
  }
  return out;
}

/**
 * The points whose month the period touches, including a month it only partly
 * covers. Nothing is recomputed: the period only chooses which months are drawn.
 */
export function pointsInPeriod<T extends { period: string }>(points: T[], period: Period): T[] {
  const first = period.from ? period.from.slice(0, 7) : null;
  const last = period.to ? period.to.slice(0, 7) : null;
  return points.filter((p) => (!first || p.period.slice(0, 7) >= first) && (!last || p.period.slice(0, 7) <= last));
}
