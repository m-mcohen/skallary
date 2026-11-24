// server/services/starterService.ts -- applies the starter set the household chose. Called only from the filing step; nothing runs it at start-up, so an existing
// database is never touched unless its owner asks.
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";
import { setStarterFiling } from "./settingsService.js";
import {
  STANDARD_CATEGORIES, STARTER_RULES, STARTER_RULE_PRIORITY, starterRuleNote,
} from "../../src/domain/starter-set.js";
import { isStarterFiling, type StarterFiling } from "../../src/domain/setup-progress.js";

const key = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** A name another rule skips (Uber Eats inside Uber) runs one step earlier, whenever it was added. */
const priorityOf = (match: string) =>
  STARTER_RULES.some((r) => r.skips && key(r.skips) === key(match)) ? STARTER_RULE_PRIORITY - 1 : STARTER_RULE_PRIORITY;

/**
 * Adds the standard categories (each a category mapped to itself) and the chosen starter rules.
 * Safe to run again: a category whose name already has a mapping, in any case, keeps it; a rule
 * whose merchant already has a rule is not added twice. Saves the choice as `starter_filing`.
 */
export function applyStarterFiling(choice: StarterFiling, ruleIds?: string[]): { categoriesAdded: number; rulesAdded: number } {
  if (!isStarterFiling(choice)) throw new Error("Choose the standard rules, the categories only, or a checklist.");
  let rules = choice === "standard-rules" ? [...STARTER_RULES] : [];
  if (choice === "checklist") {
    const ids = ruleIds ?? [];
    if (!Array.isArray(ids) || ids.some((id) => !STARTER_RULES.some((r) => r.id === id))) {
      throw new Error("One of the ticked rules is not a starter rule.");
    }
    rules = STARTER_RULES.filter((r) => ids.includes(r.id));
  }

  const repo = sqliteFinanceRepository();
  const mapped = new Set(Object.keys(repo.getCategoryMappings()).map(key));
  let categoriesAdded = 0;
  for (const c of STANDARD_CATEGORIES) {
    if (mapped.has(key(c.name))) continue;
    repo.setCategoryMapping(c.name, c.name);
    mapped.add(key(c.name));
    categoriesAdded++;
  }

  // A hold-back rule (files nothing) does not count as covering its merchant.
  const existing = repo.getCategorizationRules();
  const holds = existing.filter((r) => r.action === "categorize" && !r.toCategory && (r.note ?? "").startsWith("Starter rule"));
  const covered = new Set(existing.filter((r) => !holds.includes(r)).flatMap((r) => [key(r.memoContains), key(r.payeeContains)]).filter(Boolean));
  const fresh = rules.filter((r) => !covered.has(key(r.match)));
  // A hold-back for a merchant now chosen goes, so the chosen rule files its rows.
  for (const h of holds) if (fresh.some((r) => key(r.match) === key(h.memoContains))) repo.deleteCategorizationRule(h.id);
  const held = new Set(holds.map((h) => key(h.memoContains)));
  const holdBacks = fresh
    .filter((r) => r.skips && !rules.some((o) => key(o.match) === key(r.skips)) && !covered.has(key(r.skips)) && !held.has(key(r.skips)))
    .map((r) => ({
      priority: priorityOf(r.skips!),
      memoContains: r.skips!,
      action: "categorize" as const,
      toCategory: null,
      note: `${starterRuleNote(r)} (leaves ${r.skips} unfiled)`,
    }));
  if (holdBacks.length) repo.addCategorizationRules(holdBacks);
  const rulesAdded = fresh.length === 0 ? 0 : repo.addCategorizationRules(fresh.map((r) => ({
    priority: priorityOf(r.match),
    memoContains: r.match,
    action: "categorize" as const,
    toCategory: r.planningCategory,
    note: starterRuleNote(r),
  })));

  setStarterFiling(choice);
  return { categoriesAdded, rulesAdded };
}
