// src/ui/TransactionsSection.tsx
//
// Every transaction, listed. The largest gap this app had: thousands of rows, and the
// only place you could see one was the "needs a category" queue.
//
// Entirely client-side, and that is a deliberate choice rather than a shortcut.
// GET /api/transactions returns the whole set (~1MB over localhost), and
// prepareTransactions() is pure -- so category, transfer flag, and every manual
// correction resolve here, through the SAME functions the budget rollup uses. A
// server-side filter endpoint would have been a second implementation of
// categorisation, and the two would drift.
//
// The preparation runs once per LOAD, never per keystroke. Pushing thousands of rows
// through applyRules on every character typed is the obvious way to make this
// unusable.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

import {
  loadDb,
  getTransactionsUI,
  getAccountsUI,
  getRulesUI,
  getTransactionAdjustmentsUI,
  getCategoryMappingsUI,
  getCategoriesUI,
  createCategoryUI,
  fileCategorizationUI,
  undoCategorizationUI,
  getRecentCategorizationsUI,
  getTransactionNotesUI,
  saveTransactionNoteUI,
  getMaaserMarksUI,
  saveMaaserMarkUI,
  deleteMaaserMarkUI,
  getRecurringChoicesUI,
  saveRecurringChoiceUI,
  getMerchantRenamesUI,
  getZelleMemoNamesUI,
  type Db,
} from "./lib/db";
import CategoryPicker, { TRANSFER_CHOICE } from "./CategoryPicker";
import FilingExtras from "./FilingExtras";
import NoteCell from "./transactions/NoteCell";
import MaaserMarkCell, { type MaaserMarkChoice } from "./transactions/MaaserMarkCell";
import type { MaaserMark } from "../domain/maaser-marks";
import { potLabel, type CharityPot } from "../domain/charity-pot";
import { getCharityPotUI } from "./lib/db-setup";
import RecentCategorizations from "./transactions/RecentCategorizations";
import { showFiled } from "./lib/filed-toast";
import { buildFiling, type CategorizationLogEntry, type FilingInput, type RecurringChange, type TransactionNote } from "../domain/categorizations";
import { recurringChange, repeatStateFor, type RepeatState } from "../domain/repeat-state";
import { financeGridTheme } from "./lib/grid-theme";
import { prepareTransactions } from "../domain/pipeline";
import {
  EMPTY_FILTER,
  filterRows,
  ledgerTotal,
  type LedgerTotal,
  summarise,
  toRows,
  withRunningTotal,
  type LedgerRow,
  type TxnFilter,
  type TxnRow,
} from "../domain/transactions-view";
import { formatCents } from "../domain/money";
import { formatDateRange, formatShortDate, type Period } from "../domain/period";
import { displayAccountName } from "../domain/account-display";
import { usePeriod } from "./lib/period-store";
import type { LedgerView } from "./lib/ledger-link";
import type { Account, NormalizedTxn } from "../domain/types";
import { ruleKeyFor, type CategorizationRule } from "../domain/rules";
import { RepeatIcon } from "lucide-react";
import { detectRecurring, isBillCandidate, isRecurringTxn, usualAmount, type Cadence, type RecurringSeries } from "../domain/recurring";
import { guessCadence, type RecurringChoice, type RecurringChoiceInput } from "../domain/recurring-choices";
import { localDateIso } from "../domain/period";
import MarkRecurringDialog, { type MarkRecurringTarget } from "./recurring/MarkRecurringDialog";
import { bankName, renameMap, type MerchantRename, type RenameMap } from "../domain/merchants";
import { merchantHref } from "./lib/merchant-link";
import type { TransactionAdjustment } from "../domain/adjustments";

// BudgetGrid does the same registration at module scope. Doing it here too is
// idempotent and keeps this file self-sufficient -- so a screen that renders
// Transactions without BudgetGrid does not get an unregistered-module error.
ModuleRegistry.registerModules([AllCommunityModule]);

export interface TransactionsDataLayer {
  loadDb: () => Promise<Db>;
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getRules: (db: Db) => Promise<CategorizationRule[]>;
  getAdjustments: (db: Db) => Promise<TransactionAdjustment[]>;
  getCategoryMappings: (db: Db) => Promise<Record<string, string>>;
  getCategories: (db: Db) => Promise<string[]>;
  /** Records a category typed into the picker (an identity mapping), so every list knows it from then on. */
  createCategory: (db: Db, name: string) => Promise<void>;
  /** One filing: the rule or one-row change, the note and the recurring mark together. */
  fileCategorization: (db: Db, filing: FilingInput) => Promise<{ id: number }>;
  undoCategorization: (db: Db, id: number) => Promise<{ undone: boolean }>;
  getRecentCategorizations: (db: Db) => Promise<CategorizationLogEntry[]>;
  /** The user's notes. A failed read leaves the screen working, with no notes shown. */
  getNotes: (db: Db) => Promise<TransactionNote[]>;
  saveNote: (db: Db, id: string, note: string) => Promise<void>;
  /** The pot marks. Not an extra: with none read, every gift left out would show as counting. */
  getMaaserMarks: (db: Db) => Promise<MaaserMark[]>;
  /** The charity pot (null: off, so no marks show). A failed read keeps the marks on the user's own accounts. */
  getCharityPot: () => Promise<Pick<CharityPot, "on" | "name" | "kind" | "counts"> | null>;
  saveMaaserMark: typeof saveMaaserMarkUI;
  deleteMaaserMark: typeof deleteMaaserMarkUI;
  /** The user's recurring choices, for Mark as recurring. */
  getRecurringChoices: (db: Db) => Promise<RecurringChoice[]>;
  saveRecurringChoice: (db: Db, choice: RecurringChoiceInput) => Promise<void>;
  /** The merchant rename list: only the Merchant column follows it. */
  getMerchantRenames: (db: Db) => Promise<MerchantRename[]>;
  /** Settings, Merchants: old Zelle rows named by the person in the note. */
  getZelleMemoNames: (db: Db) => Promise<boolean>;
}

const defaultDataLayer: TransactionsDataLayer = {
  loadDb,
  getTransactions: getTransactionsUI,
  getAccounts: getAccountsUI,
  getRules: getRulesUI,
  getAdjustments: getTransactionAdjustmentsUI,
  getCategoryMappings: getCategoryMappingsUI,
  getCategories: getCategoriesUI,
  createCategory: createCategoryUI,
  fileCategorization: fileCategorizationUI,
  undoCategorization: undoCategorizationUI,
  getRecentCategorizations: getRecentCategorizationsUI,
  getNotes: getTransactionNotesUI,
  saveNote: saveTransactionNoteUI,
  getMaaserMarks: getMaaserMarksUI,
  getCharityPot: getCharityPotUI,
  saveMaaserMark: saveMaaserMarkUI,
  deleteMaaserMark: deleteMaaserMarkUI,
  getRecurringChoices: getRecurringChoicesUI,
  saveRecurringChoice: saveRecurringChoiceUI,
  getMerchantRenames: getMerchantRenamesUI,
  getZelleMemoNames: getZelleMemoNamesUI,
};

/** Sentinel for the picker's one non-category choice. */

type Phase = "loading" | "unavailable" | "ready";

interface Loaded {
  txns: NormalizedTxn[];
  accounts: Account[];
  mapping: Record<string, string>;
  categories: string[];
  /** The recurring charges, with the user's choices applied: which rows show the filled repeat button. */
  recurring: RecurringSeries[];
  /** The merchant rename list: the names in the Merchant column, nothing else. */
  renames: RenameMap;
  /** The user's recurring choices, for whether This repeats starts ticked. */
  choices: RecurringChoice[];
  /** The user's notes, by transaction id. */
  notes: Map<string, string>;
  /** The pot marks, by transaction id. */
  marks: Map<string, MaaserMark>;
  /** The charity pot; null: off; undefined: not read (the marks follow the user's own accounts). */
  pot: Pick<CharityPot, "on" | "name" | "kind" | "counts"> | null | undefined;
}

export interface TransactionsSectionProps {
  dataLayer?: Partial<TransactionsDataLayer>;
  /** Seeds the filter, so the Dashboard inbox can deep-link into a view. */
  initialFilter?: Partial<TxnFilter>;
  /**
   * Set when a summed figure on another screen linked here. The screen then
   * reads as a ledger: what was clicked, the dates, a total that equals that
   * figure, and the rows oldest first with a running total.
   */
  ledger?: LedgerView | null;
  /** Overrides the shared period. Tests pin it so none depends on today's date. */
  period?: Period;
  /** Today, for which recurring charges have stopped. Defaults to today; tests pin it. */
  asOfDate?: string;
}

const MONEY = "font-mono tabular-nums";

const COUNTED_NOTE = "Counted accounts only. Transfers between your accounts are left out.";

/**
 * What a ledger is, when it is NOT a category total. An account's figure on the
 * Accounts screen is a balance and a bill's is a typical amount; neither is a
 * sum of these rows, and the header must not let it look like one.
 */
/**
 * A two-sided ledger's header. Saving and investment income only appear once
 * there is something in them, so an ordinary ledger reads exactly as it always
 * has rather than growing two permanent zeroes.
 */
function ledgerSummaryText(sums: LedgerTotal): string {
  const parts = [
    `Income ${formatCents(sums.incomeCents)}`,
    ...(sums.investmentIncomeCents !== 0 ? [`Investment income ${formatCents(sums.investmentIncomeCents)}`] : []),
    `Expense ${formatCents(sums.expenseCents)}`,
    ...(sums.savingCents !== 0 ? [`Saved ${formatCents(sums.savingCents)}`] : []),
    `Left over ${formatCents(sums.netCents)}`,
  ];
  return parts.join(" · ");
}

function ledgerNote(view: LedgerView["view"]): string | null {
  if (view === "account") return "Activity in this account over these dates, transfers included. This is not the balance.";
  if (view === "series") return "The payments in this recurring charge. Recurring shows the usual amount, the middle of the last 3, not a total.";
  if (view === "maaser") return "The rows behind this figure on the charity pot's ledger. A figure that is a difference, such as what the pot owes you, lists the rows on both sides, so the total beside it is not that figure. A row marked as part income counts only the part marked.";
  return null;
}

/** What a category ledger leaves out: one direction (Reports), and accounts that are not counted. */
function scopeNote(filter: TxnFilter): string | null {
  const parts = [
    filter.flow === "in" ? "Money that came back on spending categories only." : null,
    filter.flow === "out" ? "Purchases only; refunds and credits are on their own line in Reports." : null,
    filter.countedAccountsOnly ? COUNTED_NOTE : null,
  ].filter((p): p is string => p != null);
  return parts.length > 0 ? parts.join(" ") : null;
}

export default function TransactionsSection({
  dataLayer,
  initialFilter,
  ledger = null,
  period: pinned,
  asOfDate,
}: TransactionsSectionProps) {
  // The dates belong to the period in the top bar, shared with Reports and Net
  // worth. While a click-through ledger is open, the period IS that ledger's
  // dates (see period-store), so one rule covers both.
  const shared = usePeriod();
  const period = pinned ?? shared;
  const deps = useMemo<TransactionsDataLayer>(
    () => ({ ...defaultDataLayer, ...dataLayer }),
    [dataLayer]
  );

  const dbRef = useRef<Db | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [filter, setFilter] = useState<TxnFilter>({
    ...EMPTY_FILTER,
    ...initialFilter,
    from: period.from,
    to: period.to,
  });
  // The committed search term. Typing updates `searchInput`; this follows 150ms
  // later, so a keystroke does not refilter thousands of rows.
  const [searchInput, setSearchInput] = useState(filter.search);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Recent categorizations: the last 30 days of filings, each with Undo.
  const [recentOpen, setRecentOpen] = useState(false);

  const reload = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    const [txns, accounts, rules, adjustments, mapping, categories, choices, renames, zelleByMemo, notes, marks, pot] = await Promise.all([
      deps.getTransactions(db),
      deps.getAccounts(db),
      deps.getRules(db),
      deps.getAdjustments(db),
      deps.getCategoryMappings(db),
      deps.getCategories(db),
      // The repeat button is an extra: a failed read leaves the screen working, with the app's own list.
      deps.getRecurringChoices(db).catch(() => [] as RecurringChoice[]),
      // An extra too: with no list, the Merchant column shows the bank's names.
      deps.getMerchantRenames(db).catch(() => [] as MerchantRename[]),
      deps.getZelleMemoNames(db).catch(() => false),
      // An extra too: with no notes read, the icons show empty and search skips notes.
      deps.getNotes(db).catch(() => [] as TransactionNote[]),
      // Not an extra: with no marks read, every gift left out would show as counting.
      deps.getMaaserMarks(db),
      deps.getCharityPot().catch(() => undefined),
    ]);
    // Prepared HERE, once: rules, the transfer matcher, and every manual
    // correction resolve in this one pass. Rules and the recurring finder read the
    // bank's name; the rename list only names the Merchant column.
    const prepared = prepareTransactions(txns, { rules, adjustments, accounts, mapping });
    setLoaded({
      txns: prepared,
      accounts,
      mapping,
      categories,
      recurring: detectRecurring(prepared, mapping, asOfDate ?? localDateIso(), choices),
      renames: renameMap(renames, { zelleByMemo }),
      choices,
      notes: new Map(notes.map((n) => [n.sourceTransactionId, n.note])),
      marks: new Map(marks.map((m) => [m.sourceTransactionId, m])),
      pot,
    });
  }, [deps, asOfDate]);

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
        // Expected when the local server is unreachable.
        if (!cancelled) setPhase("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps, reload]);

  useEffect(() => {
    const id = setTimeout(() => setFilter((f) => ({ ...f, search: searchInput })), 150);
    return () => clearTimeout(id);
  }, [searchInput]);

  // A new period re-filters what is already loaded. Nothing is fetched again,
  // and every other filter (search, account, category) is left as it was.
  useEffect(() => {
    setFilter((f) =>
      f.from === period.from && f.to === period.to ? f : { ...f, from: period.from, to: period.to }
    );
  }, [period.from, period.to]);

  // The tab strip in AppShell drives which filter is on. Without this, the
  // useState above only reads initialFilter once, so switching between All and
  // Needs a category would not refilter -- and worse, would leave a stale
  // needsCategory=true set after the user clicked back to All.
  const wantsNeedsCategory = initialFilter?.needsCategory ?? false;
  useEffect(() => {
    setFilter((f) => (f.needsCategory === wantsNeedsCategory ? f : { ...f, needsCategory: wantsNeedsCategory }));
  }, [wantsNeedsCategory]);

  // Same treatment for a ?category= deep-link from Reports. JSON.stringify
  // as the dep so a new array reference with the same contents does not
  // retrigger, and a real value change does.
  const wantedCategoriesKey = JSON.stringify(initialFilter?.categories ?? []);
  useEffect(() => {
    const wanted = (JSON.parse(wantedCategoriesKey) as string[]);
    setFilter((f) =>
      JSON.stringify(f.categories) === wantedCategoriesKey ? f : { ...f, categories: wanted }
    );
  }, [wantedCategoriesKey]);

  const rows = useMemo(
    () => (loaded ? toRows(loaded.txns, loaded.accounts, loaded.mapping, loaded.renames, loaded.notes, loaded.marks, loaded.pot) : []),
    [loaded]
  );
  const visible = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const totals = useMemo(() => summarise(visible), [visible]);
  // A ledger reads oldest first with a running total. The plain screen keeps
  // filterRows' newest-first order.
  const isLedger = ledger != null;
  // A maaser figure's rows mix money in and out, so a running total would mean nothing there.
  const runs = isLedger && ledger?.view !== "maaser";
  const gridRows = useMemo<TxnRow[]>(
    () => (runs ? withRunningTotal(visible, filter.kind, ledger?.view === "account") : visible),
    [runs, visible, filter.kind, ledger?.view]
  );
  const ledgerSums = useMemo(() => ledgerTotal(visible), [visible]);
  // An average only makes sense for one side; a two-sided ledger shows its three totals as they are.
  const oneSidedCents =
    filter.kind === "expense"
      ? ledgerSums.expenseCents
      : filter.kind === "income"
        ? ledgerSums.incomeCents
        : filter.kind === "saving"
          ? ledgerSums.savingCents
          : filter.kind === "investment_income"
            ? ledgerSums.investmentIncomeCents
            : null;

  const set = <K extends keyof TxnFilter>(key: K, value: TxnFilter[K]) =>
    setFilter((f) => ({ ...f, [key]: value }));

  // The pot column shows while the pot is on (or, when it could not be read, as it always has).
  const pot = loaded?.pot;
  const potOn = pot === undefined || (pot !== null && pot.on);
  const columns = useMemo<ColDef<TxnRow>[]>(
    () => [
      // "Sep 30", the year only outside this year; the ISO value still sorts.
      { headerName: "Date", field: "txn.date", width: 120, cellClass: MONEY, valueFormatter: (p) => formatShortDate(String(p.value)) },
      { headerName: "Account", field: "accountName", width: 220 },
      {
        // The shown merchant name, opening its page. The
        // bank's own name is in the link's title, so a rename can be traced.
        headerName: "Merchant",
        width: 260,
        valueGetter: (p) => p.data?.merchant ?? "",
        cellRenderer: (p: ICellRendererParams<TxnRow>) => (p.data ? <MerchantCell row={p.data} /> : null),
      },
      {
        // The user's note: an icon with no heading text; screen readers hear "Note".
        colId: "note",
        headerName: "Note",
        headerComponent: () => <span className="sr-only">Note</span>,
        width: 52,
        sortable: false,
        cellRenderer: (p: ICellRendererParams<TxnRow>) => (p.data ? <NoteCellFor row={p.data} /> : null),
      },
      {
        // The two per-row pot marks: only on rows where one applies, and only while the pot is on.
        colId: "maaser",
        headerName: potLabel(potOn ? pot : null),
        hide: !potOn,
        width: 200,
        sortable: false,
        cellRenderer: (p: ICellRendererParams<TxnRow>) => (p.data ? <MaaserMarkCellFor row={p.data} /> : null),
      },
      {
        headerName: "Category",
        width: 220,
        cellRenderer: (p: ICellRendererParams<TxnRow>) =>
          p.data ? <CategoryCell row={p.data} /> : null,
      },
      {
        headerName: "Amount",
        field: "txn.amountCents",
        width: 140,
        type: "rightAligned",
        cellClass: MONEY,
        valueFormatter: (p) => formatCents(p.value as number),
      },
      {
        colId: "recurring",
        headerName: "Recurring",
        width: 104,
        sortable: false,
        cellRenderer: (p: ICellRendererParams<TxnRow>) => (p.data ? <RecurringCell row={p.data} /> : null),
      },
      ...(runs
        ? [
            {
              colId: "running",
              headerName: "Running total",
              width: 160,
              type: "rightAligned",
              cellClass: MONEY,
              valueGetter: (p) => (p.data as LedgerRow | undefined)?.runningCents ?? 0,
              valueFormatter: (p) => formatCents(p.value as number),
            } satisfies ColDef<TxnRow>,
          ]
        : []),
    ],
    [runs, potOn, pot]
  );

  /**
   * One filing, one call. Which write happens depends on
   * the row (buildFiling): a BLANK row takes a forward payee rule, since
   * applyRules fills blanks; an ALREADY-CATEGORIZED row takes an id-matched
   * one-row change, since a rule never overwrites a category, plus the rule when
   * "and everything like it" is ticked. The note and This repeats ride along, and
   * the toast offers Undo.
   */
  const apply = useCallback(
    async (row: TxnRow, choice: string, alsoRule: boolean, created: boolean, extras: FilingExtrasChoice) => {
      const db = dbRef.current;
      if (!db) return;
      const isTransfer = choice === TRANSFER_CHOICE;
      const writes = buildFiling({ txn: row.txn, choice, isTransfer, from: "Transactions", needsCategory: row.needsCategory, alsoRule });
      if (!writes) return;
      setBusy(true);
      setError(null);
      try {
        // A name the picker has never seen: record it first, so every list knows it.
        if (created) await deps.createCategory(db, choice);
        const toCategory = isTransfer ? TRANSFER_LABEL : choice;
        const { id } = await deps.fileCategorization(db, {
          sourceTransactionId: row.txn.sourceTransactionId,
          label: rowLabel(row),
          fromCategory: row.planningCategory,
          toCategory,
          ...writes,
          ...(extras.note.trim() !== (row.note ?? "") ? { note: extras.note } : {}),
          // A transfer is never a bill (plan call 2).
          ...(extras.recurring && !isTransfer ? { recurring: extras.recurring } : {}),
        });
        // Re-fetches and re-runs prepareTransactions, so the row updates in place.
        await reload();
        showFiled(`Filed ${rowLabel(row)} as ${toCategory}.`, async () => {
          await deps.undoCategorization(db, id);
          await reload();
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [deps, reload]
  );

  const saveNote = useCallback(
    async (row: TxnRow, note: string) => {
      const db = dbRef.current;
      if (!db) return;
      await deps.saveNote(db, row.txn.sourceTransactionId, note);
      await reload();
    },
    [deps, reload]
  );

  const saveMaaser = useCallback(
    async (row: TxnRow, choice: MaaserMarkChoice) => {
      const db = dbRef.current;
      if (!db) return;
      const id = row.txn.sourceTransactionId;
      if (choice === null) await deps.deleteMaaserMark(db, id);
      else await deps.saveMaaserMark(db, { sourceTransactionId: id, kind: choice.kind, countedCents: choice.countedCents });
      await reload();
    },
    [deps, reload]
  );

  // Mark as recurring: which row's dialog is open, and the save.
  const [marking, setMarking] = useState<{ row: TxnRow; target: MarkRecurringTarget } | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const openMark = useCallback(
    (row: TxnRow) => {
      if (!loaded) return;
      const key = ruleKeyFor(row.txn);
      const series = loaded.recurring.find((s) => s.key === key && s.accountIds.includes(row.txn.accountId));
      const dates = loaded.txns
        .filter((t) => t.accountId === row.txn.accountId && ruleKeyFor(t) === key && isBillCandidate(t, loaded.mapping))
        .map((t) => t.date);
      setMarkError(null);
      setMarking({
        row,
        target: {
          label: rowLabel(row),
          accountName: row.accountName,
          alreadyCadence: series?.cadence ?? null,
          guess: guessCadence(dates),
          amountCents: Math.abs(row.txn.amountCents),
        },
      });
    },
    [loaded]
  );
  const saveMark = async (cadence: Cadence, onlyAmount = false) => {
    const db = dbRef.current;
    if (!db || !marking) return;
    setBusy(true);
    setMarkError(null);
    try {
      await deps.saveRecurringChoice(db, {
        payeeKey: ruleKeyFor(marking.row.txn),
        accountId: marking.row.txn.accountId,
        choice: "recurring",
        cadence,
        label: rowLabel(marking.row),
        // Only charges of about this amount.
        ...(onlyAmount ? { amountCents: Math.abs(marking.row.txn.amountCents) } : {}),
      });
      setMarking(null);
      await reload();
    } catch (e) {
      setMarkError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const recurringContext = useMemo(
    () => ({
      canMark: (row: TxnRow) => loaded != null && row.kind === "expense" && isBillCandidate(row.txn, loaded.mapping),
      isRecurring: (row: TxnRow) => (loaded ? isRecurringTxn(loaded.recurring, row.txn) : false),
      open: openMark,
      // This repeats in the picker: the same test as the repeat button.
      repeatFor: (row: TxnRow): RepeatState | null =>
        loaded && row.kind === "expense"
          ? repeatStateFor(row.txn, rowLabel(row), { prepared: loaded.txns, mapping: loaded.mapping, series: loaded.recurring, choices: loaded.choices })
          : null,
    }),
    [loaded, openMark]
  );

  if (phase === "loading") return <Skeleton className="h-96 w-full" />;

  if (phase === "unavailable") {
    return (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>
          The local server is not reachable. Restart the app.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <RecurringContext.Provider value={recurringContext}>
    <PickerContext.Provider value={{ categories: loaded?.categories ?? [], apply, saveNote, saveMaaser, busy, pot }}>
    <div className="flex min-w-0 flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {ledger && (
        <div
          data-testid="ledger-header"
          className="flex flex-wrap items-end justify-between gap-3 rounded-md border bg-card p-4"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-base font-medium">{ledger.label}</h2>
            <p className="text-sm text-muted-foreground">
              {formatDateRange(filter.from, filter.to)} &middot;{" "}
              <span className={MONEY}>{visible.length}</span>{" "}
              {visible.length === 1 ? "transaction" : "transactions"}
            </p>
            {(ledgerNote(ledger.view) ?? scopeNote(filter)) && (
              <p data-testid="ledger-note" className="text-xs text-muted-foreground">
                {ledgerNote(ledger.view) ?? scopeNote(filter)}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <p data-testid="ledger-total" className={`text-lg font-medium ${MONEY}`}>
              {ledger.view === "account" || ledger.view === "maaser"
                ? `In ${formatCents(totals.inCents)} · Out ${formatCents(totals.outCents)}`
                : ledger.view === "series" && visible.length === 0
                ? "0 payments"
                : ledger.view === "series"
                ? `${visible.length} ${visible.length === 1 ? "payment" : "payments"} · usual ${formatCents(
                    Math.abs(
                      usualAmount(
                        // Oldest first, same-day ties by id: the finder's own order (recurring.ts runsByKey).
                        [...visible]
                          .sort((a, b) => a.txn.date.localeCompare(b.txn.date) || a.txn.sourceTransactionId.localeCompare(b.txn.sourceTransactionId))
                          .map((r) => r.txn.amountCents)
                      )
                    )
                  )}`
                : ledger.divideBy && oneSidedCents != null
                ? formatCents(Math.round(oneSidedCents / ledger.divideBy))
                : oneSidedCents != null
                ? formatCents(oneSidedCents)
                : ledgerSummaryText(ledgerSums)}
            </p>
            {ledger.divideBy && oneSidedCents != null && (
              // The figure that was clicked was an average. Both numbers are
              // shown, so the rows below still add up to something on screen.
              <p data-testid="ledger-average-note" className="text-xs text-muted-foreground">
                {formatCents(oneSidedCents)} in total, divided by {ledger.divideBy} months
              </p>
            )}
            <div className="flex gap-3 text-sm">
              <a href={ledger.back} className="underline-offset-4 hover:underline">
                Back
              </a>
              <a href="#/transactions" className="underline-offset-4 hover:underline">
                Show all transactions
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Filters, one row, above the grid. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search merchant, category, or note..."
          className="w-72"
        />
        <select
          aria-label="Account"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={filter.accountIds[0] ?? ""}
          onChange={(e) => set("accountIds", e.target.value ? [e.target.value] : [])}
        >
          <option value="">All accounts</option>
          {/* Live accounts by short name, archived records in their own group. */}
          {loaded?.accounts.filter((a) => !a.archived).map((a) => (
            <option key={a.id} value={a.id}>
              {displayAccountName(a.name)}
            </option>
          ))}
          {loaded && loaded.accounts.some((a) => a.archived) && (
            <optgroup label="Archived">
              {loaded.accounts.filter((a) => a.archived).map((a) => (
                <option key={a.id} value={a.id}>
                  {displayAccountName(a.name)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <select
          aria-label="Filter by category"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={filter.categories[0] ?? ""}
          onChange={(e) => set("categories", e.target.value ? [e.target.value] : [])}
        >
          <option value="">All categories</option>
          {loaded?.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Input
          type="number"
          aria-label="Minimum amount"
          placeholder="Min $"
          className="w-28"
          onChange={(e) =>
            set("minCents", e.target.value ? Math.round(Number(e.target.value) * 100) : null)
          }
        />
        <Input
          type="number"
          aria-label="Maximum amount"
          placeholder="Max $"
          className="w-28"
          onChange={(e) =>
            set("maxCents", e.target.value ? Math.round(Number(e.target.value) * 100) : null)
          }
        />
        <Button
          variant={filter.needsCategory ? "default" : "outline"}
          size="sm"
          aria-pressed={filter.needsCategory}
          onClick={() => set("needsCategory", !filter.needsCategory)}
        >
          Needs a category
        </Button>
        <select
          aria-label="Transfers"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={filter.transfers}
          onChange={(e) => set("transfers", e.target.value as TxnFilter["transfers"])}
        >
          <option value="exclude">Hide transfers</option>
          <option value="include">Show transfers</option>
          <option value="only">Transfers only</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => setRecentOpen(true)}>
          Recent categorizations
        </Button>
      </div>

      {/* What is on screen right now -- not the whole set. */}
      <div data-testid="txn-summary" className="text-xs text-muted-foreground">
        <span className={MONEY}>{totals.count}</span>{" "}
        {totals.count === 1 ? "transaction" : "transactions"} &middot;{" "}
        <span className={MONEY}>{formatCents(totals.inCents)}</span> in &middot;{" "}
        <span className={MONEY}>{formatCents(totals.outCents)}</span> out
        &middot; net <span className={MONEY}>{formatCents(totals.netCents)}</span>
      </div>

      {visible.length === 0 ? (
        // These two are different problems needing different actions from you,
        // so they get different messages.
        rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">No transactions match these filters.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // The period is not one of "these filters": it lives in the top bar.
                setFilter({ ...EMPTY_FILTER, from: period.from, to: period.to });
                setSearchInput("");
              }}
            >
              Clear filters
            </Button>
          </div>
        )
      ) : (
        // A fixed height so the GRID scrolls, not the page -- and so AG Grid's
        // row virtualization stays on. domLayout="autoHeight" would render all
        // rows and defeat it.
        <div className="h-[calc(100svh-20rem)] min-h-80 w-full">
          <AgGridReact<TxnRow>
            theme={financeGridTheme}
            rowData={gridRows}
            columnDefs={columns}
            // Re-sorting a ledger would make its running total meaningless.
            defaultColDef={{ sortable: !runs }}
            getRowId={(p) => p.data.txn.sourceTransactionId}
            suppressCellFocus
          />
        </div>
      )}
      <RecentCategorizations
        open={recentOpen}
        onOpenChange={setRecentOpen}
        load={() => (dbRef.current ? deps.getRecentCategorizations(dbRef.current) : Promise.resolve([]))}
        undo={(id) => (dbRef.current ? deps.undoCategorization(dbRef.current, id) : Promise.resolve({ undone: false }))}
        onUndone={() => void reload()}
      />
      <MarkRecurringDialog
        target={marking?.target ?? null}
        busy={busy}
        error={markError}
        onSave={(cadence, onlyAmount) => void saveMark(cadence, onlyAmount)}
        onClose={() => setMarking(null)}
      />
    </div>
    </PickerContext.Provider>
    </RecurringContext.Provider>
  );
}

/**
 * The Merchant cell: the shown name, opening the merchant's page. Back returns to
 * this list as it is. A row with no name at all has no page to open.
 */
function MerchantCell({ row }: { row: TxnRow }) {
  const bank = bankName(row.txn);
  if (!bank) return <span className="text-muted-foreground">{row.merchant}</span>;
  return (
    <a
      href={merchantHref(row.merchant, window.location.hash.startsWith("#/") ? window.location.hash : "#/transactions")}
      title={`Bank name: ${bank}`}
      className="underline-offset-4 hover:underline"
    >
      {row.merchant}
    </a>
  );
}

/** The merchant as a row shows it. */
function rowLabel(row: TxnRow): string {
  return row.txn.payee ?? row.txn.merchant ?? ruleKeyFor(row.txn);
}

// The repeat button. Only on money-out spending rows with a
// merchant name: a transfer or card payment is never a recurring charge.
const RecurringContext = createContext<{
  canMark: (row: TxnRow) => boolean;
  isRecurring: (row: TxnRow) => boolean;
  open: (row: TxnRow) => void;
  repeatFor: (row: TxnRow) => RepeatState | null;
} | null>(null);

function RecurringCell({ row }: { row: TxnRow }) {
  const ctx = useContext(RecurringContext);
  if (!ctx || !ctx.canMark(row)) return null;
  const on = ctx.isRecurring(row);
  const label = on ? `${rowLabel(row)} is recurring` : `Mark ${rowLabel(row)} as recurring`;
  return (
    <Button
      variant={on ? "secondary" : "ghost"}
      size="icon"
      // Unmarked, it is drawn in the text color so it reads as a button.
      className={`size-7 ${on ? "text-primary" : "text-foreground"}`}
      aria-label={label}
      title={label}
      onClick={() => ctx.open(row)}
    >
      <RepeatIcon className="size-3.5" />
    </Button>
  );
}

// Cell renderers are constructed by AG Grid, not by us, so the picker reaches
// its dependencies through context rather than props.
const PickerContext = createContext<{
  categories: string[];
  apply: (row: TxnRow, choice: string, alsoRule: boolean, created: boolean, extras: FilingExtrasChoice) => void;
  saveNote: (row: TxnRow, note: string) => Promise<void>;
  saveMaaser: (row: TxnRow, choice: MaaserMarkChoice) => Promise<void>;
  busy: boolean;
  /** The charity pot, for its name and kind on the mark cells. */
  pot?: Pick<CharityPot, "on" | "name" | "kind" | "counts"> | null;
} | null>(null);

/** What the picker's Note box and This repeats say at the moment of the pick. */
interface FilingExtrasChoice {
  note: string;
  recurring: RecurringChange | undefined;
}

const TRANSFER_LABEL = "Transfer (not spending)";

/** The note icon, reaching the save through the picker's context (AG Grid builds the cell). */
function NoteCellFor({ row }: { row: TxnRow }) {
  const ctx = useContext(PickerContext);
  if (!ctx) return null;
  return <NoteCell note={row.note} onSave={(note) => ctx.saveNote(row, note)} />;
}

/**
 * The pot mark control, only on a row where one applies (a gift or an income row on a counted account).
 * A set-amount pot does not depend on income, so its income rows take no mark.
 */
function MaaserMarkCellFor({ row }: { row: TxnRow }) {
  const ctx = useContext(PickerContext);
  if (!ctx || row.maaserRole === null) return null;
  if (row.maaserRole === "income" && ctx.pot && ctx.pot.kind !== "percent") return null;
  return <MaaserMarkCell role={row.maaserRole} mark={row.maaserMark} amountCents={row.txn.amountCents} potName={potLabel(ctx.pot)} onSave={(choice) => ctx.saveMaaser(row, choice)} />;
}

function CategoryCell({ row }: { row: TxnRow }) {
  const ctx = useContext(PickerContext);
  const recurringCtx = useContext(RecurringContext);
  const [open, setOpen] = useState(false);
  // A blank row ALWAYS writes the forward rule -- that is the review queue's
  // behaviour, and there is no per-row correction to prefer over it. For a row
  // that already has a category the rule is opt-in, because the common case is
  // fixing this one transaction.
  const [alsoRule, setAlsoRule] = useState(row.needsCategory);
  // The Note box and This repeats, read when a category is picked.
  const repeat = open && recurringCtx ? recurringCtx.repeatFor(row) : null;
  const [note, setNote] = useState(row.note ?? "");
  const [repeats, setRepeats] = useState(false);
  const [cadence, setCadence] = useState<Cadence>("monthly");
  // Only charges of about this amount: follows the row's mark until the user touches it.
  const [onlyAmountChoice, setOnlyAmount] = useState<boolean | null>(null);
  const onlyAmount = onlyAmountChoice ?? repeat?.markAmountCents != null;
  const [typed, setTyped] = useState("");
  // Each opening starts from the row as it is now.
  useEffect(() => {
    if (!open) return;
    setNote(row.note ?? "");
    setRepeats(repeat?.current != null);
    setCadence(repeat?.current ?? repeat?.guess ?? "monthly");
    setOnlyAmount(null);
    setTyped("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!ctx) {
    return (
      <span
        data-testid={`txn-category-${row.txn.sourceTransactionId}`}
        className={row.needsCategory ? "text-muted-foreground" : undefined}
      >
        {row.planningCategory}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid={`txn-category-${row.txn.sourceTransactionId}`}
        onClick={() => setOpen(true)}
        className={
          "w-full text-left hover:underline " +
          (row.needsCategory ? "text-muted-foreground" : "")
        }
      >
        {row.planningCategory}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* Type to filter, or add a new category. The switch beside it
          decides whether the choice, new or not, also becomes a rule. */}
      <CategoryPicker
        categories={ctx.categories}
        label="Category"
        allowTransfer
        autoFocus
        disabled={ctx.busy}
        className="w-56"
        onPick={(choice, { created }) => {
          setOpen(false);
          ctx.apply(row, choice, alsoRule, created, { note, recurring: recurringChange(repeat, repeats, cadence, onlyAmount) });
        }}
        onCancel={() => setOpen(false)}
        onInputChange={setTyped}
        footer={
          <div className="flex flex-col gap-2">
            <FilingExtras
              note={note}
              onNote={setNote}
              repeat={repeat}
              showRepeat={typed.trim().toLowerCase() !== TRANSFER_LABEL.toLowerCase()}
              repeats={repeats}
              onRepeats={setRepeats}
              cadence={cadence}
              onCadence={setCadence}
              onlyAmount={onlyAmount}
              onOnlyAmount={setOnlyAmount}
            />
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={alsoRule}
                disabled={row.needsCategory}
                onChange={(e) => setAlsoRule(e.target.checked)}
              />
              and everything like it
            </label>
          </div>
        }
      />
    </div>
  );
}
