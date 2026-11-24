// src/ui/lib/useMastheadSummary.ts
//
// The head's data flow, in two stages.
//
// The reads are keyed on the plan and the refresh tick only. The scenario is
// composed over them in memory, because the scrubber replaces the scenario
// object on every slider step and one drag must not re-issue nine fetches.
// Splitting it also lets App read the budget's Charity line before it builds
// the live scenario, which needs that figure as the maaser baseline.
import { useEffect, useMemo, useRef, useState } from "react";

import {
  loadDb,
  getAccountsUI,
  getAccountBalancesUI,
  getCategorySettingsUI,
  getUncategorizedUI,
  getRulesUI,
  getConnectorStatusUI,
  getSeedStatusUI,
  getTrailingUI,
  getBudgetLinesUI,
  getBudgetExtrasUI,
  getSalarySettingsUI,
  type Db,
  type SeedStatus,
  type TrailingSummary,
  type ConnectorStatus,
  getTransactionsUI,
  getTransactionAdjustmentsUI,
  getCategoryMappingsUI,
  getPlanUI,
} from "./db";
import { getBankGraceUI, getLifestyleGroupsUI } from "./db-setup";
import type { LifestyleGroup } from "../../domain/lifestyle-groups";
import { summariseForMasthead, type MastheadSummary, type MastheadSummaryInput } from "./instrument";
import type { Scenario } from "../../domain/scenario";
import type { WhatIf } from "../../domain/what-if";
import type { Account, NormalizedTxn } from "../../domain/types";
import type { AccountBalance, BudgetLine, Goal, GoalAccountLink, Plan } from "../../domain/plan-types";
import type { CategorySetting } from "../../domain/category-settings";
import type { CategorizationRule } from "../../domain/rules";
import { DEFAULT_SALARY_ASSUMPTIONS, type SalaryAssumptions } from "../../domain/salary";
import type { TransactionAdjustment } from "../../domain/adjustments";
import { prepareTransactions } from "../../domain/pipeline";
import { spentMonthToDate, type MonthToDate } from "../../domain/compare";
import { spendingCurves, type SpendingCurves } from "../../domain/spending-curve";
import { incomeMonthToDate, type IncomeMonthToDate } from "../../domain/income-month";
import { localDateIso } from "../../domain/period";
import { firstMonthOf, type MonthSource } from "../../domain/dashboard-month";
import { bankProblems, type BankProblem } from "../../domain/bank-problems";

export interface MastheadFetchers {
  loadDb: () => Promise<Db>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getAccountBalances: (db: Db) => Promise<AccountBalance[]>;
  getCategorySettings: (db: Db) => Promise<CategorySetting[]>;
  getUncategorized: (db: Db) => Promise<NormalizedTxn[]>;
  getRules: (db: Db) => Promise<CategorizationRule[]>;
  getConnectorStatus: (db: Db) => Promise<ConnectorStatus>;
  getSeedStatus: (db: Db) => Promise<SeedStatus>;
  getTrailing: (db: Db, months?: number) => Promise<TrailingSummary>;
  getBudgetLines: (db: Db, planId: string) => Promise<BudgetLine[]>;
  getBudgetExtras: typeof getBudgetExtrasUI;
  getSalarySettings: (db: Db) => Promise<SalaryAssumptions>;
  // For the Spent this month tile. Any of the three failing leaves that tile empty, nothing else.
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
  getAdjustments: (db: Db) => Promise<TransactionAdjustment[]>;
  getCategoryMappings: (db: Db) => Promise<Record<string, string>>;
  /** The budget year, for the top bar's Year statement. A failure drops the Year view only. */
  getPlan: (db: Db, planId: string) => Promise<Plan | null>;
  /** The saved lifestyle groups (null: the starter groups) and bank grace days. A failure of either falls back to the starter groups and the usual rule. */
  getLifestyleGroups: () => Promise<LifestyleGroup[] | null>;
  getBankGrace: () => Promise<Record<string, number>>;
}

const defaultFetchers: MastheadFetchers = {
  loadDb,
  getAccounts: getAccountsUI,
  getAccountBalances: getAccountBalancesUI,
  getCategorySettings: getCategorySettingsUI,
  getUncategorized: getUncategorizedUI,
  getRules: getRulesUI,
  getConnectorStatus: getConnectorStatusUI,
  getSeedStatus: getSeedStatusUI,
  getTrailing: getTrailingUI,
  getBudgetLines: getBudgetLinesUI,
  getBudgetExtras: getBudgetExtrasUI,
  getSalarySettings: getSalarySettingsUI,
  getTransactions: getTransactionsUI,
  getAdjustments: getTransactionAdjustmentsUI,
  getCategoryMappings: getCategoryMappingsUI,
  getPlan: getPlanUI,
  getLifestyleGroups: getLifestyleGroupsUI,
  getBankGrace: getBankGraceUI,
};

/** Everything the head reads, before any scenario is laid over it. */
export type MastheadInputs = Omit<MastheadSummaryInput, "scenario"> & {
  /** Average monthly spend over the trailing twelve complete months. */
  trailingCents: number;
  /** The months that average covers, oldest first, so the figure can open its ledger. */
  trailingWindow?: string[];
  /** Spending this month through today, against the same days of last month. Null when it could not be read. */
  spentThisMonth?: MonthToDate | null;
  /** The Dashboard chart's lines, from the same rows as spentThisMonth. Null when they could not be read. */
  spendingCurves?: SpendingCurves | null;
  /** Income this month so far against last month, the top payers, and what investments paid. Null when it could not be read. */
  incomeThisMonth?: IncomeMonthToDate | null;
  /** What the Dashboard's month bar needs to show a past month. Null when the rows could not be read. */
  monthSource?: MonthSource | null;
  /** The transactions could not be read, so the top bar has no statement: it says so rather than loading forever. */
  equationUnreadable?: boolean;
  lastSeedAt: string | null;
  reseedDue: boolean;
  /** Banks that need a sign-in or have sent nothing new for more than 3 days (optional: absent means none). */
  bankProblems?: BankProblem[];
};

/** The head's summary plus the reads that are not part of the projection. */
export type HeadState = MastheadSummary &
  Pick<MastheadInputs, "trailingCents" | "trailingWindow" | "spentThisMonth" | "spendingCurves" | "incomeThisMonth" | "monthSource" | "equationUnreadable" | "lastSeedAt" | "reseedDue" | "bankProblems">;

/**
 * The raw reads, refreshed when the plan or the tick changes and at no other
 * time.
 *
 * Wrapped in try/catch like every other load in this shell: the server may not
 * be reachable yet (headless build, preview), and the head must degrade to a
 * neutral state rather than take the app down with it.
 */
export function useMastheadInputs(
  planId: string | null,
  tick: number,
  fetchers?: Partial<MastheadFetchers>
): MastheadInputs | null {
  const [inputs, setInputs] = useState<MastheadInputs | null>(null);
  // Read through a ref so an inline fetchers object cannot re-run the effect.
  const fetchersRef = useRef(fetchers);
  fetchersRef.current = fetchers;

  useEffect(() => {
    const deps: MastheadFetchers = { ...defaultFetchers, ...fetchersRef.current };
    let cancelled = false;
    void (async () => {
      try {
        const db = await deps.loadDb();
        const [accounts, balances, settings, uncategorized, rules, status, seed, trailing, budgetLines, salaryAssumptions, forTile, extras, plan, savedGroups, graceDays] =
          await Promise.all([
            deps.getAccounts(db),
            deps.getAccountBalances(db),
            deps.getCategorySettings(db),
            deps.getUncategorized(db),
            deps.getRules(db),
            deps.getConnectorStatus(db),
            deps.getSeedStatus(db),
            deps.getTrailing(db, 12),
            planId ? deps.getBudgetLines(db, planId) : Promise.resolve([] as BudgetLine[]),
            // The salary route is new and optional to the reading: a failure
            // here falls back to the defaults instead of blanking Runway,
            // Drawable and Burn along with it.
            deps.getSalarySettings(db).catch(() => DEFAULT_SALARY_ASSUMPTIONS),
            // The tile's three reads, tolerated the same way: a failure empties the tile only.
            Promise.all([deps.getTransactions(db), deps.getAdjustments(db), deps.getCategoryMappings(db)]).catch(() => null),
            // Big months only add to a past month's reading, so a failure drops them rather than the head.
            (planId ? deps.getBudgetExtras(db, planId) : Promise.resolve({ changes: [], bigMonths: [], notes: [] })).catch(() => ({
              changes: [],
              bigMonths: [],
              notes: [],
            })),
            planId ? deps.getPlan(db, planId).catch(() => null) : Promise.resolve(null),
            deps.getLifestyleGroups().catch(() => null),
            deps.getBankGrace().catch(() => ({} as Record<string, number>)),
          ]);
        if (cancelled) return;
        // One prepared set for both month-to-date cards, so Spent and Income read the same rows.
        const prepared = forTile ? prepareTransactions(forTile[0], { rules, adjustments: forTile[1], accounts, mapping: forTile[2] }) : null;
        // One local today for the month cards and the month bar, so they agree on which month is this one.
        const today = localDateIso();
        setInputs({
          accounts,
          balances,
          budgetLines,
          categorySettings: settings,
          uncategorizedCount: uncategorized.length,
          ruleCount: rules.length,
          lastSyncedAt: status.lastSyncedAt,
          asOfDate: today,
          salaryAssumptions,
          lifestyleGroups: savedGroups ?? undefined,
          // Raw, for a goal's saving a month under a what-if: the What if screen reads the same.
          transactions: forTile ? forTile[0] : undefined,
          trailingCents: trailing.monthlyAverageCents,
          trailingWindow: trailing.window,
          // Local today: the tile says "through Sep 20" in the reader's own calendar.
          spentThisMonth: prepared ? spentMonthToDate(prepared, accounts, forTile![2], today) : null,
          spendingCurves: prepared ? spendingCurves(prepared, accounts, forTile![2], today) : null,
          incomeThisMonth: prepared ? incomeMonthToDate(prepared, accounts, forTile![2], today) : null,
          // Kept so the Dashboard can show a past month without reading again.
          // The budget of record, never a what-if: a what-if never changes a past month.
          monthSource: prepared
            ? { prepared, accounts, mapping: forTile![2], budgetLines, today, firstMonth: firstMonthOf(forTile![0]), bigMonths: extras.bigMonths }
            : null,
          // The top bar's statement: the same prepared rows, the big months and the budget year.
          equationSource: prepared
            ? { prepared, mapping: forTile![2], bigMonths: extras.bigMonths, changes: extras.changes, plan: plan ? { startDate: plan.startDate, endDate: plan.endDate } : null }
            : null,
          equationUnreadable: !prepared,
          lastSeedAt: seed.lastSeedAt,
          reseedDue: seed.reseedDue,
          // The same list as the Sync button's box and the banner.
          bankProblems: bankProblems({ errors: status.lastErrors ?? [], accounts, today, graceDays }),
        });
      } catch {
        if (!cancelled) setInputs(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, tick]);

  return inputs;
}

/** The head's reading: the scenario composed over the inputs, in memory only. `whatIf` is the what-if behind the scenario, if it is one. */
export function useMastheadSummary(
  inputs: MastheadInputs | null,
  scenario: Scenario | null,
  whatIf: WhatIf | null = null,
  goals: Goal[] = NO_GOALS,
  goalLinks: GoalAccountLink[] = NO_LINKS
): HeadState | null {
  return useMemo(() => {
    if (!inputs) return null;
    const { trailingCents, trailingWindow, spentThisMonth, spendingCurves, incomeThisMonth, monthSource, equationUnreadable, lastSeedAt, reseedDue, bankProblems: problems, ...summaryInput } = inputs;
    return { ...summariseForMasthead({ ...summaryInput, scenario, whatIf, goals, goalLinks }), trailingCents, trailingWindow, spentThisMonth, spendingCurves, incomeThisMonth, monthSource, equationUnreadable, lastSeedAt, reseedDue, bankProblems: problems };
  }, [inputs, scenario, whatIf, goals, goalLinks]);
}

/** Stable empty lists, so the memo above does not recompute every render. */
const NO_GOALS: Goal[] = [];
const NO_LINKS: GoalAccountLink[] = [];
