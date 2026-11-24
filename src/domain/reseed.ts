// src/domain/reseed.ts
//
// When the budget defaults are stale enough to re-seed from actuals. Pure:
// the server stamps `last_seed_at` after every seed (seedBudgetService) and
// the UI turns these two answers into the Now-inbox nudge and the Setup
// readout.

/**
 * A quarter. Long enough that a re-seed reflects a real shift in spending
 * rather than one unusual month; short enough that a raise, a move or a new
 * recurring bill doesn't sit unbudgeted for half a year.
 */
export const RESEED_INTERVAL_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * The calendar date (YYYY-MM-DD, UTC) a re-seed becomes due, or null when
 * the budget has never been seeded. An unparseable stamp counts as never
 * seeded -- a guessed date would be worse than an honest "never".
 */
export function reseedDueAt(lastSeedAt: string | null): string | null {
  if (!lastSeedAt) return null;
  const seeded = Date.parse(lastSeedAt);
  if (Number.isNaN(seeded)) return null;
  return new Date(seeded + RESEED_INTERVAL_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/**
 * True from the due DATE onward, so the flag and the date the UI prints can
 * never disagree. Never seeded is due: the nudge is how a fresh install
 * learns to seed at all.
 */
export function reseedDue(lastSeedAt: string | null, nowMs: number): boolean {
  const dueAt = reseedDueAt(lastSeedAt);
  if (dueAt === null) return true;
  // UTC on both sides, the same frame reseedDueAt prints, so the flag and the date agree (at most one evening early).
  return new Date(nowMs).toISOString().slice(0, 10) >= dueAt;
}
