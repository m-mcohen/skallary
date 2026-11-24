// server/services/snapshotService.ts
//
// One Drawable snapshot per sync (Notes history). Net worth over time comes
// from account_balance_readings (0026), not from these rows. Before this the only
// snapshot was written at migration time.
//
// The write is best-effort at the caller: a failure here logs and lets the
// sync succeed, because a missed snapshot is a hole in the chart, not a lost
// sync.
import crypto from "node:crypto";
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";
import { drawableLiquidCents } from "../../src/domain/runway.js";
import { prepareTransactions } from "../../src/domain/pipeline.js";
import { rollupMonthly } from "../../src/domain/rollups.js";
import type { SnapshotHistoryEntry } from "../../src/domain/notes-types.js";
import { trailingMonthlyBurnCents } from "../../src/domain/burn.js";
import { withEffectiveInclude } from "../../src/domain/account-filter.js";
import { getIncludePartnerAccounts } from "./settingsService.js";

export function writeSnapshot(planId: string, note: string | null = null): SnapshotHistoryEntry {
  const repo = sqliteFinanceRepository();
  // The EFFECTIVE account list, as every screen reads it: the partner's own
  // accounts drop out unless the include setting is on, so a snapshot's
  // Drawable always agrees with the top bar's.
  const accounts = withEffectiveInclude(repo.getAccounts(), getIncludePartnerAccounts());
  const balances = repo.getAccountBalances();
  const drawableCents = drawableLiquidCents(accounts, balances);

  // Server-side reprise of what useMastheadSummary computes on the client.
  // Same pipeline, same rollup, so the snapshot reads what the Forecast screen
  // would have said at this moment.
  const txns = repo.getTransactions();
  const rules = repo.getCategorizationRules();
  const adjustments = repo.getTransactionAdjustments();
  const mapping = repo.getCategoryMappings();
  const prepared = prepareTransactions(txns, { rules, adjustments, accounts });
  const rollups = rollupMonthly(prepared, accounts, mapping);
  const now = new Date().toISOString();
  // MONTHLY averages over complete months (src/domain/burn.ts). These columns
  // once held 3 and 12 month totals; migration 0019 rescales the
  // older rows.
  //
  // Burn is SPENDING. Money put away is not burned -- it is still the user's, and
  // counting a brokerage contribution as burn would shorten the runway for the
  // act of saving, which is backwards. trailingMonthlyBurnCents counts only
  // `expense`, so the saving and investment-income rows pass through untouched.
  const burn3moCents = trailingMonthlyBurnCents(rollups, 3, now.slice(0, 7));
  const burn12moCents = trailingMonthlyBurnCents(rollups, 12, now.slice(0, 7));

  const entry: SnapshotHistoryEntry = {
    id: crypto.randomUUID(),
    planId,
    asOf: now,
    drawableCents,
    burn3moCents,
    burn12moCents,
    note,
    createdAt: now,
  };
  // upsertSnapshotHistory is INSERT ... ON CONFLICT(id) DO UPDATE. A fresh
  // UUID per call means every write appends -- snapshots accumulate; they
  // never overwrite each other.
  repo.upsertSnapshotHistory(entry);
  return entry;
}
