// src/ui/NowSection.tsx
//
// Now: what is true today, and what needs you.
//
// Anything waiting on a decision -- the transactions no rule covers, and a
// budget due for a re-seed -- with the fix right there, because that is the
// only recurring task in the app and it should never be more than one glance
// away. The position statement that used to follow moved to Accounts, Balances
// (src/ui/PositionCard.tsx); positionGroups is re-exported below
// for one release so older imports keep working.
//
// This replaces the Overview cards, which repeated figures already in the head
// ten inches above them. A statement has no chrome: margin and alignment do
// the work a card border used to do.
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  loadDb,
  getUncategorizedUI,
  getCategoriesUI,
  createCategoryUI,
  fileCategorizationUI,
  undoCategorizationUI,
  getTransactionsUI,
  getRulesUI,
  getTransactionAdjustmentsUI,
  getCategoryMappingsUI,
  getRecurringChoicesUI,
  getTransactionNotesUI,
  getSeedStatusUI,
  type Db,
  type SeedStatus,
} from "./lib/db";
import CategoryPicker, { TRANSFER_CHOICE } from "./CategoryPicker";
import FilingExtras from "./FilingExtras";
import { showFiled } from "./lib/filed-toast";
import type { NormalizedTxn } from "../domain/types";
import { ruleKeyFor, type CategorizationRule } from "../domain/rules";
import type { TransactionAdjustment } from "../domain/adjustments";
import type { RecurringChoice } from "../domain/recurring-choices";
import { detectRecurring, type Cadence } from "../domain/recurring";
import { prepareTransactions } from "../domain/pipeline";
import { localDateIso } from "../domain/period";
import { buildFiling, type FilingInput, type RecurringChange, type TransactionNote } from "../domain/categorizations";
import { recurringChange, repeatStateFor, type RepeatState } from "../domain/repeat-state";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { formatCents } from "../domain/money";
import { formatShortDate } from "../domain/period";

export interface NowDataLayer {
  loadDb: () => Promise<Db>;
  getUncategorized: (db: Db) => Promise<NormalizedTxn[]>;
  getCategories: (db: Db) => Promise<string[]>;
  /** Records a category typed into the picker (an identity mapping), so every list knows it from then on. */
  createCategory: (db: Db, name: string) => Promise<void>;
  /** One filing: the rule, the note and the recurring mark together, with Undo. */
  fileCategorization: (db: Db, filing: FilingInput) => Promise<{ id: number }>;
  undoCategorization: (db: Db, id: number) => Promise<{ undone: boolean }>;
  /** For This repeats: what the recurring finder reads. A failed read only hides the box. */
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
  getRules: (db: Db) => Promise<CategorizationRule[]>;
  getAdjustments: (db: Db) => Promise<TransactionAdjustment[]>;
  getCategoryMappings: (db: Db) => Promise<Record<string, string>>;
  getRecurringChoices: (db: Db) => Promise<RecurringChoice[]>;
  /** The user's notes, so a waiting row shows the note it already has. */
  getNotes: (db: Db) => Promise<TransactionNote[]>;
  getSeedStatus: (db: Db) => Promise<SeedStatus>;
}

const defaultDataLayer: NowDataLayer = {
  loadDb,
  getUncategorized: getUncategorizedUI,
  getCategories: getCategoriesUI,
  createCategory: createCategoryUI,
  fileCategorization: fileCategorizationUI,
  undoCategorization: undoCategorizationUI,
  getTransactions: getTransactionsUI,
  getRules: getRulesUI,
  getAdjustments: getTransactionAdjustmentsUI,
  getCategoryMappings: getCategoryMappingsUI,
  getRecurringChoices: getRecurringChoicesUI,
  getNotes: getTransactionNotesUI,
  getSeedStatus: getSeedStatusUI,
};

export interface NowSectionProps {
  dataLayer?: Partial<NowDataLayer>;
  /** The app's budget. Kept for the Dashboard's call; the review row links to Set up budget, which reads its own. */
  planId?: string | null;
  /** Called after a filing or its Undo, so the head can refresh. */
  onChanged?: () => void;
  /** The Dashboard shows a past month: this list is today's, and says so. */
  asOfToday?: boolean;
}

/** The date the budget was last reviewed (or seeded), as "Jun 1". */
function seedDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}


/** The text a rule made from this row matches on: the payee, lower-cased. */


export default function NowSection({ dataLayer, onChanged, asOfToday = false }: NowSectionProps) {
  const deps = useMemo<NowDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);
  const [db, setDb] = useState<Db | null>(null);
  const [queue, setQueue] = useState<NormalizedTxn[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [seed, setSeed] = useState<SeedStatus | null>(null);
  // This repeats: what the box shows for a row. Null until read, or if the read failed.
  const [repeatFor, setRepeatFor] = useState<((t: NormalizedTxn) => RepeatState | null) | null>(null);
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async (h: Db) => {
      const [q, c, s] = await Promise.all([
        deps.getUncategorized(h),
        deps.getCategories(h),
        deps.getSeedStatus(h),
      ]);
      setQueue(q);
      setCategories(c);
      setSeed(s);
      // An extra: with no notes read, the boxes start empty and an empty box changes nothing.
      const read = await deps.getNotes(h).catch(() => [] as TransactionNote[]);
      setNotes(new Map(read.map((n) => [n.sourceTransactionId, n.note])));
      // An extra: if any of these reads fails, the queue still works without This repeats.
      try {
        const [txns, rules, adjustments, mapping, choices] = await Promise.all([
          deps.getTransactions(h),
          deps.getRules(h),
          deps.getAdjustments(h),
          deps.getCategoryMappings(h),
          deps.getRecurringChoices(h),
        ]);
        const prepared = prepareTransactions(txns, { rules, adjustments, mapping });
        const series = detectRecurring(prepared, mapping, localDateIso(), choices);
        setRepeatFor(() => (t: NormalizedTxn) => repeatStateFor(t, rowName(t), { prepared, mapping, series, choices }));
      } catch {
        setRepeatFor(null);
      }
    },
    [deps]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const h = await deps.loadDb();
        if (cancelled) return;
        setDb(h);
        await reload(h);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps, reload]);

  const file = async (t: NormalizedTxn, choice: string, created: boolean, extras: WaitingExtras) => {
    if (!db || !choice) return;
    const isTransfer = choice === TRANSFER_CHOICE;
    // Waiting on you always writes a rule for the payee (buildFiling, from "Now").
    const writes = buildFiling({ txn: t, choice, isTransfer, from: "Now", needsCategory: true, alsoRule: false });
    if (!writes) return;
    setBusy(true);
    setError(null);
    try {
      // A name the picker has never seen: record it first, so every list knows it.
      if (created) await deps.createCategory(db, choice);
      const label = rowName(t);
      const toCategory = isTransfer ? "Transfer (not spending)" : choice;
      const { id } = await deps.fileCategorization(db, {
        sourceTransactionId: t.sourceTransactionId,
        label,
        fromCategory: "Uncategorized",
        toCategory,
        ...writes,
        // Sent only when changed, so an empty box never deletes a note it did not show.
        ...(extras.note.trim() !== (notes.get(t.sourceTransactionId) ?? "") ? { note: extras.note } : {}),
        // A transfer is never a bill (plan call 2).
        ...(extras.recurring && !isTransfer ? { recurring: extras.recurring } : {}),
      });
      await reload(db);
      onChanged?.();
      showFiled(`Filed ${label} as ${toCategory}.`, async () => {
        await deps.undoCategorization(db, id);
        await reload(db);
        onChanged?.();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reseedDue = !!seed?.reseedDue;
  const waiting = queue.length + (reseedDue ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* ---- Waiting on you ---- */}
      <Card aria-label="Waiting on you" foldId="dash-waiting">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardDescription className="uppercase tracking-wider">
            Waiting on you{asOfToday && <span className="normal-case tracking-normal">, as of today</span>}
          </CardDescription>
          <Badge data-testid="inbox-count" variant={waiting > 0 ? "default" : "outline"}>
            {waiting}
          </Badge>
        </CardHeader>
        <CardContent>
          {waiting === 0 ? (
            <p className="text-sm text-muted-foreground">
              {"Nothing. Every transaction has a home."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {/* The budget itself can be the thing waiting: a review older than
                  ninety days is last season's spending. First row, above the
                  transactions, because it changes every figure in the head.
                  It opens Set up budget, a
                  preview where nothing changes until the user applies. */}
              {reseedDue && (
                <li className="flex items-center gap-3 py-2">
                  <span className="flex-1 text-sm">
                    {seed?.lastSeedAt ? `Budget reviewed ${seedDate(seed.lastSeedAt)}` : "Budget never reviewed"}
                    {" · review due"}
                  </span>
                  <a className={buttonVariants({ size: "sm" })} href="#/budget/month?setup=1">
                    Review your budget
                  </a>
                </li>
              )}
              {queue.slice(0, 20).map((t) => (
                <WaitingRow
                  key={t.sourceTransactionId}
                  t={t}
                  categories={categories}
                  busy={busy}
                  repeat={repeatFor ? repeatFor(t) : null}
                  existingNote={notes.get(t.sourceTransactionId) ?? null}
                  onFile={(choice, created, extras) => void file(t, choice, created, extras)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

/** The payee as the row shows it. */
function rowName(t: NormalizedTxn): string {
  return t.payee ?? t.merchant ?? t.description ?? "This transaction";
}

/** What the picker's Note box and This repeats say at the moment of the pick. */
interface WaitingExtras {
  note: string;
  recurring: RecurringChange | undefined;
}

/**
 * One waiting transaction: its name, date, amount and picker. The Note box and
 * This repeats sit inside the picker's list, so a pick files them too.
 */
function WaitingRow({
  t,
  categories,
  busy,
  repeat,
  existingNote,
  onFile,
}: {
  t: NormalizedTxn;
  categories: string[];
  busy: boolean;
  repeat: RepeatState | null;
  /** The note this row already has, shown in the box until the user changes it. */
  existingNote: string | null;
  onFile: (choice: string, created: boolean, extras: WaitingExtras) => void;
}) {
  // Null until the user touches them: until then the boxes follow the data, which can arrive
  // after the row is drawn. A box that started unticked and
  // never caught up would have removed a mark the user never touched.
  const [noteDraft, setNote] = useState<string | null>(null);
  const [repeatsChoice, setRepeats] = useState<boolean | null>(null);
  const [cadenceChoice, setCadence] = useState<Cadence | null>(null);
  const [onlyAmountChoice, setOnlyAmount] = useState<boolean | null>(null);
  const note = noteDraft ?? existingNote ?? "";
  const repeats = repeatsChoice ?? repeat?.current != null;
  const cadence = cadenceChoice ?? repeat?.current ?? repeat?.guess ?? "monthly";
  // Only charges of about this amount: follows the row's mark until the user touches it.
  const onlyAmount = onlyAmountChoice ?? repeat?.markAmountCents != null;
  const [typed, setTyped] = useState("");
  const name = t.payee ?? t.merchant ?? "this transaction";
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="flex-1 text-sm">
        {t.payee ?? t.merchant ?? t.description ?? "Unknown"}
        <span className="ml-2 font-mono text-xs text-muted-foreground tabular-nums">{formatShortDate(t.date)}</span>
      </span>
      <span className="w-24 text-right font-mono text-xs tabular-nums">{formatCents(t.amountCents)}</span>
      <CategoryPicker
        categories={categories}
        label={`File ${name} as`}
        triggerLabel={`Show categories for ${name}`}
        placeholder="File as..."
        allowTransfer
        disabled={busy || !ruleKeyFor(t)}
        className="w-52"
        onInputChange={setTyped}
        onPick={(choice, { created }) => onFile(choice, created, { note, recurring: recurringChange(repeat, repeats, cadence, onlyAmount) })}
        footer={
          <FilingExtras
            note={note}
            onNote={setNote}
            repeat={repeat}
            showRepeat={typed.trim().toLowerCase() !== "transfer (not spending)"}
            repeats={repeats}
            onRepeats={setRepeats}
            cadence={cadence}
            onCadence={setCadence}
            onlyAmount={onlyAmount}
            onOnlyAmount={setOnlyAmount}
          />
        }
      />
    </li>
  );
}

export { positionGroups } from "./PositionCard";
