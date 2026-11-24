// src/domain/account-filter.ts
//
// Each account's owner slot (me, partner, joint) and the "include the partner's accounts"
// setting are the single exclusion lever for calc-facing account lists (spend rollup, seed,
// drawable). The partner's own accounts drop out unless the setting is on; shared accounts
// and the user's own always count. Pure, with no database dependency: callers pass the
// accounts and the current setting (settingsService.getIncludePartnerAccounts()).
import type { Account } from "./types";

/** An account counts toward spend and drawable when it is includeInSpend AND (not the partner's own, or the partner's are included). */
export function isIncludedForCalc(acct: Account, includePartner: boolean): boolean {
  return acct.includeInSpend && (acct.owner !== "partner" || includePartner);
}

/**
 * Returns accounts with includeInSpend rewritten to the effective value, so
 * existing includeInSpend-based domain fns (rollupMonthly, drawableLiquidCents)
 * honor the owner + toggle with no signature change.
 */
export function withEffectiveInclude(accounts: Account[], includePartner: boolean): Account[] {
  return accounts.map((a) => ({ ...a, includeInSpend: isIncludedForCalc(a, includePartner) }));
}
