import type { NormalizedTxn } from "./types";
import { isSavingCategory, isInvestmentIncomeCategory } from "./savings";

// Income detection. Exact-match list plus any category containing "income"
// (e.g. Monarch's "Other Income", "Business Income") -- these previously fell
// through as EXPENSES and showed up as negative expense lines, deflating the
// budget. No expense category contains
// the word "income", so the substring is safe.
export function isIncomeCategory(name: string): boolean {
  const n = name.toLowerCase();
  return ["paychecks", "income", "interest", "bonus", "interest income"].includes(n) || n.includes("income");
}

// Money moving between the user's own accounts, by category name. Paying a card
// moves money from checking to the card; the purchases on the card are the
// spending, already counted in their own categories. The pair matcher catches
// most card payments; the ones it misses (a leg outside the tracked accounts, or
// more than 3 days apart) showed up as spending. The label
// stays, the spending does not. Exact name, any case, read on the PLANNING
// category, so the mappings table stays the owner of the taxonomy: mapping a
// feed category into this name makes it a transfer, and mapping this name to
// another makes it spending again (Settings, Mappings is the undo path).
export function isTransferCategory(name: string): boolean {
  return name.trim().toLowerCase() === "credit card payment";
}

// The order below IS the design. First match wins.
//
//   1. a wash counts nowhere;
//   2. a crossing into a savings destination is SAVING -- and it must beat the
//      transfer flag, because the pair matcher has already set that flag on
//      both legs of the very move we are trying to count;
//   3. a saving CATEGORY is saving, the escape hatch for legacy rows whose
//      second leg is not in the data;
//   4. transfers, as before;
//   5. investment income before ordinary income, since "Interest" would
//      otherwise be swallowed by the income test below it.
export function classify(txn: NormalizedTxn, mapping: Record<string, string>) {
  const raw = txn.sourceCategory ?? "Uncategorized";
  const planningCategory = mapping[raw] ?? raw;

  if (txn.isWash) return { planningCategory, kind: "transfer" as const };
  // The user's explicit "this is a transfer" beats everything below it.
  if (txn.transferByCorrection) return { planningCategory, kind: "transfer" as const };
  if (txn.savingBucket) return { planningCategory: txn.savingBucket, kind: "saving" as const };
  if (isSavingCategory(planningCategory)) return { planningCategory, kind: "saving" as const };

  if (txn.isTransfer || isTransferCategory(planningCategory)) {
    return { planningCategory, kind: "transfer" as const };
  }
  if (isInvestmentIncomeCategory(planningCategory) || isInvestmentIncomeCategory(raw)) {
    return { planningCategory, kind: "investment_income" as const };
  }
  const isIncome = isIncomeCategory(planningCategory) || isIncomeCategory(raw);
  return { planningCategory, kind: isIncome ? ("income" as const) : ("expense" as const) };
}
