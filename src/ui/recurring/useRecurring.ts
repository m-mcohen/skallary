// src/ui/recurring/useRecurring.ts
//
// One loader for everything that shows recurring charges: the Dashboard's
// Recurring panel and the Recurring screen. It reads the
// transactions and the user's choices, prepares the rows exactly as every other
// screen does, and runs the detector with the choices applied.
//
// The choices are read on their own: if that read fails the app's own list is
// still shown, and the screen says so (a hidden charge would otherwise come back
// without a word).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteRecurringChoiceUI,
  getAccountsUI,
  getCategoryMappingsUI,
  getCategorySettingsUI,
  getRecurringChoicesUI,
  getRulesUI,
  getTransactionAdjustmentsUI,
  getTransactionsUI,
  loadDb,
  saveRecurringChoiceUI,
  type Db,
} from "../lib/db";
import { prepareTransactions } from "../../domain/pipeline";
import { auditAgainstBudget, detectRecurring, type BillsAudit, type RecurringSeries } from "../../domain/recurring";
import type { RecurringChoice, RecurringChoiceInput } from "../../domain/recurring-choices";
import { displayAccountName } from "../../domain/account-display";
import type { Account, NormalizedTxn } from "../../domain/types";
import type { CategorizationRule } from "../../domain/rules";
import type { TransactionAdjustment } from "../../domain/adjustments";
import type { CategorySetting } from "../../domain/category-settings";

export interface RecurringDataLayer {
  loadDb: () => Promise<Db>;
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getRules: (db: Db) => Promise<CategorizationRule[]>;
  getAdjustments: (db: Db) => Promise<TransactionAdjustment[]>;
  getCategoryMappings: (db: Db) => Promise<Record<string, string>>;
  getCategorySettings: (db: Db) => Promise<CategorySetting[]>;
  getRecurringChoices: (db: Db) => Promise<RecurringChoice[]>;
  saveRecurringChoice: (db: Db, choice: RecurringChoiceInput) => Promise<void>;
  deleteRecurringChoice: (db: Db, payeeKey: string, accountId: string, amountCents?: number | null) => Promise<void>;
}

export const defaultRecurringDataLayer: RecurringDataLayer = {
  loadDb,
  getTransactions: getTransactionsUI,
  getAccounts: getAccountsUI,
  getRules: getRulesUI,
  getAdjustments: getTransactionAdjustmentsUI,
  getCategoryMappings: getCategoryMappingsUI,
  getCategorySettings: getCategorySettingsUI,
  getRecurringChoices: getRecurringChoicesUI,
  saveRecurringChoice: saveRecurringChoiceUI,
  deleteRecurringChoice: deleteRecurringChoiceUI,
};

export interface RecurringData {
  series: RecurringSeries[];
  /** Account id -> the name shown on screen. */
  accountNames: Record<string, string>;
  choices: RecurringChoice[];
  /** True when the choices could not be read: the list is the app's own. */
  choicesUnavailable: boolean;
  audit: BillsAudit;
  asOf: string;
}

export type RecurringPhase = "loading" | "unavailable" | "ready";

export function useRecurring(dataLayer: Partial<RecurringDataLayer> | undefined, asOf: string) {
  const deps = useMemo<RecurringDataLayer>(() => ({ ...defaultRecurringDataLayer, ...dataLayer }), [dataLayer]);
  const dbRef = useRef<Db | null>(null);
  const [phase, setPhase] = useState<RecurringPhase>("loading");
  const [data, setData] = useState<RecurringData | null>(null);

  const reload = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    const [txns, accounts, rules, adjustments, mapping, settings, choices] = await Promise.all([
      deps.getTransactions(db),
      deps.getAccounts(db),
      deps.getRules(db),
      deps.getAdjustments(db),
      deps.getCategoryMappings(db),
      deps.getCategorySettings(db),
      deps.getRecurringChoices(db).catch(() => null),
    ]);
    const prepared = prepareTransactions(txns, { rules, adjustments, mapping });
    const series = detectRecurring(prepared, mapping, asOf, choices ?? []);
    const recurringCategories = settings.filter((s) => s.recurring === true).map((s) => s.planningCategory);
    setData({
      series,
      accountNames: Object.fromEntries(accounts.map((a) => [a.id, displayAccountName(a.name)])),
      choices: choices ?? [],
      choicesUnavailable: choices == null,
      audit: auditAgainstBudget(series, recurringCategories),
      asOf,
    });
  }, [deps, asOf]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await deps.loadDb();
        if (cancelled) return;
        dbRef.current = db;
        await reload();
        if (!cancelled) setPhase("ready");
      } catch {
        if (!cancelled) setPhase("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps, reload]);

  /** Save a choice, then re-read so every list agrees with it. Throws the server's words. */
  const save = useCallback(
    async (choice: RecurringChoiceInput) => {
      if (!dbRef.current) return;
      await deps.saveRecurringChoice(dbRef.current, choice);
      await reload();
    },
    [deps, reload]
  );

  /** Show again: delete a choice, then re-read. */
  const remove = useCallback(
    async (payeeKey: string, accountId: string, amountCents: number | null = null) => {
      if (!dbRef.current) return;
      await deps.deleteRecurringChoice(dbRef.current, payeeKey, accountId, amountCents);
      await reload();
    },
    [deps, reload]
  );

  return { phase, data, save, remove };
}
