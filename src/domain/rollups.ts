import type { NormalizedTxn, Account } from "./types";
import { classify } from "./dedup";
import { countedByAccount, inSpendScope } from "./scope";
import { MAASER_CATEGORY, potAccountIds, potRowKind } from "./maaser-pot";

export type RollupKind = "expense" | "income" | "saving" | "investment_income";
export type MonthlyRollup = { period: string; planningCategory: string; kind: RollupKind; amountCents: number; };

export function rollupMonthly(txns: NormalizedTxn[], accounts: Account[], mapping: Record<string, string>): MonthlyRollup[] {
  const counted = countedByAccount(accounts);
  const potIds = potAccountIds(accounts);
  const buckets = new Map<string, MonthlyRollup>(); // key: period|cat|kind, value accumulates signed cents
  for (const t of txns) {
    // The pot's own rows are never spending or income, whether or not the feed or the matcher
    // flagged them as transfers (rule 3). One exception: a gift paid straight
    // from the pot (cash, Zelle, a check) reached a charity, so it lands on that month's Charity.
    if (potIds.has(t.accountId)) {
      if (potRowKind(t, potIds, mapping) === "gift") {
        const period = t.date.slice(0, 7);
        const key = `${period}|${MAASER_CATEGORY}|expense`;
        const b = buckets.get(key) ?? { period, planningCategory: MAASER_CATEGORY, kind: "expense" as const, amountCents: 0 };
        b.amountCents += t.amountCents;
        buckets.set(key, b);
      }
      continue;
    }
    const c = classify(t, mapping);
    // Transfers and accounts that are not counted are out. The rules live in
    // scope.ts because the Transactions ledger must apply the very same ones.
    if (c.kind === "transfer" || !inSpendScope(t.accountId, c.kind, counted)) continue;
    const period = t.date.slice(0, 7);
    const key = `${period}|${c.planningCategory}|${c.kind}`;
    const b = buckets.get(key) ?? { period, planningCategory: c.planningCategory, kind: c.kind, amountCents: 0 };
    b.amountCents += t.amountCents;                             // accumulate SIGNED
    buckets.set(key, b);
  }
  const rollups = [...buckets.values()].map((b) => ({
    ...b,
    // Spend magnitude positive. Saving flips the same way, so a contribution
    // (money leaving checking, a negative row) reads as a positive amount saved
    // and a withdrawal reads as a negative one.
    amountCents: b.kind === "expense" || b.kind === "saving" ? -b.amountCents : b.amountCents,
  }));
  return rollups.sort(
    (a, b) => a.period.localeCompare(b.period) || a.planningCategory.localeCompare(b.planningCategory) || a.kind.localeCompare(b.kind),
  );
}
