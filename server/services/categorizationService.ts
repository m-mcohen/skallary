// server/services/categorizationService.ts
//
// One server call per filing, and its Undo. A
// filing's rule, one-row change, note, recurring mark and log row are written in
// one SQLite transaction, so a filing can never half-save, and Undo knows exactly
// what it wrote. Undo deletes what the filing added: adding a rule never edits an
// older one (the newer simply wins), so deleting it lets the older one rule again.
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";
import { RECENT_DAYS, validateFiling, type CategorizationLogEntry, type FilingInput } from "../../src/domain/categorizations.js";
import type { RecurringChoice } from "../../src/domain/recurring-choices.js";
import type { CategorizationRule } from "../../src/domain/rules.js";

type FilingRule = Omit<CategorizationRule, "id">;

/** Undo of a line that is not in the log. The route answers 404. */
export class NotFoundError extends Error {}

type RecurringPart = Pick<
  CategorizationLogEntry,
  "recurringPayeeKey" | "recurringAccountId" | "priorRecurringChoice" | "writtenRecurringChoice"
>;

/** Writes a checked filing. Throws the plain-words reason for one that does not pass. */
export function fileCategorization(input: unknown, now: () => Date = () => new Date()): { id: number } {
  const f = validateFiling(input);
  if (typeof f === "string") throw new Error(f);
  return writeFiling(f, now().toISOString());
}

function writeFiling(f: FilingInput, at: string): { id: number } {
  const repo = sqliteFinanceRepository();
  return repo.inTransaction(() => {
    const ruleId = f.rule ? repo.addCategorizationRule(aheadOfOlder(f.rule, repo.getCategorizationRules())) : null;
    const adjustmentId = f.adjustment ? repo.addTransactionAdjustment(f.adjustment) : null;
    if (f.note !== undefined) repo.setTransactionNote(f.sourceTransactionId, f.note, at);
    let recurring: RecurringPart = {
      recurringPayeeKey: null,
      recurringAccountId: null,
      priorRecurringChoice: null,
      writtenRecurringChoice: null,
    };
    if (f.recurring) {
      const key = f.recurring.action === "save" ? f.recurring.choice.payeeKey : f.recurring.payeeKey;
      const account = f.recurring.action === "save" ? f.recurring.choice.accountId : f.recurring.accountId;
      // A mark is keyed by merchant, account and the amount it names, if any.
      const amount = (f.recurring.action === "save" ? f.recurring.choice.amountCents : f.recurring.amountCents) ?? null;
      const prior = repo.getRecurringChoice(key, account, amount);
      let written: RecurringChoice | null = null;
      if (f.recurring.action === "save") {
        written = { ...f.recurring.choice, amountCents: amount, createdAt: at };
        repo.upsertRecurringChoice(written);
      } else {
        repo.deleteRecurringChoice(key, account, amount);
      }
      recurring = { recurringPayeeKey: key, recurringAccountId: account, priorRecurringChoice: prior, writtenRecurringChoice: written };
    }
    const id = repo.addCategorizationLog({
      createdAt: at,
      sourceTransactionId: f.sourceTransactionId,
      label: f.label,
      fromCategory: f.fromCategory,
      toCategory: f.toCategory,
      ruleId,
      adjustmentId,
      ...recurring,
    });
    return { id };
  });
}

/**
 * Rules apply lowest priority number first, the older one first on a tie, so a
 * second filing of the same merchant at the same priority would never take
 * effect on the other rows. The new rule goes one
 * ahead of any older rule for the same merchant; Undo deletes it, and the older
 * rule rules again. Existing rules are never renumbered, so no figure moves.
 */
function aheadOfOlder(rule: FilingRule, existing: CategorizationRule[]): FilingRule {
  const key = (rule.payeeContains ?? "").toLowerCase();
  const same = existing.filter((r) => (r.payeeContains ?? "").toLowerCase() === key);
  return { ...rule, priority: Math.min(rule.priority, ...same.map((r) => r.priority - 1)) };
}

/** The last RECENT_DAYS of filings, newest first. Older rows stay in the table. */
export function listRecentCategorizations(now: () => Date = () => new Date()): CategorizationLogEntry[] {
  const since = new Date(now().getTime() - RECENT_DAYS * 86_400_000).toISOString();
  return sqliteFinanceRepository().listCategorizationLog(since);
}

/** The same mark: same choice, rhythm and time it was made. Null equals only null. */
function sameChoice(a: RecurringChoice | null, b: RecurringChoice | null): boolean {
  if (a === null || b === null) return a === b;
  return a.choice === b.choice && a.cadence === b.cadence && a.createdAt === b.createdAt && (a.amountCents ?? null) === (b.amountCents ?? null);
}

/**
 * The mark this filing replaced, unless the filing that wrote that mark has itself
 * been undone: then the mark before that one, and so on.
 * Without this, undoing two filings oldest first brought back the older filing's mark.
 */
function liveMarkBefore(entry: CategorizationLogEntry, log: CategorizationLogEntry[]): RecurringChoice | null {
  let prior = entry.priorRecurringChoice;
  const seen = new Set<number>([entry.id]);
  for (;;) {
    const writer = log.find(
      (e) =>
        !seen.has(e.id) &&
        e.undoneAt &&
        e.recurringPayeeKey === entry.recurringPayeeKey &&
        e.recurringAccountId === entry.recurringAccountId &&
        prior !== null &&
        sameChoice(e.writtenRecurringChoice, prior)
    );
    if (!writer) return prior;
    seen.add(writer.id);
    prior = writer.priorRecurringChoice;
  }
}

export function undoCategorization(id: number, now: () => Date = () => new Date()): { undone: boolean } {
  const repo = sqliteFinanceRepository();
  const entry = Number.isInteger(id) ? repo.getCategorizationLog(id) : null;
  if (!entry) throw new NotFoundError("That categorization is not in the list.");
  if (entry.undoneAt) return { undone: false };
  repo.inTransaction(() => {
    if (entry.ruleId != null) repo.deleteCategorizationRule(entry.ruleId);
    if (entry.adjustmentId != null) repo.deleteTransactionAdjustment(entry.adjustmentId);
    // The note is the user's writing, not a category: Undo leaves it.
    if (entry.recurringPayeeKey && entry.recurringAccountId) {
      const amount = entry.writtenRecurringChoice?.amountCents ?? entry.priorRecurringChoice?.amountCents ?? null;
      const current = repo.getRecurringChoice(entry.recurringPayeeKey, entry.recurringAccountId, amount);
      // Plan call 4: a later change to this merchant's mark wins over the Undo.
      if (sameChoice(current, entry.writtenRecurringChoice)) {
        const prior = liveMarkBefore(entry, repo.listCategorizationLog(""));
        if (prior) repo.upsertRecurringChoice(prior);
        else repo.deleteRecurringChoice(entry.recurringPayeeKey, entry.recurringAccountId, amount);
      }
    }
    repo.markCategorizationUndone(entry.id, now().toISOString());
  });
  return { undone: true };
}
