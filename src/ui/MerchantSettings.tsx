// src/ui/MerchantSettings.tsx -- Settings, Merchants.
//
// Three pieces, in reading order:
// 1. Suggested merges, one pair at a time, each with Accept (writes one rename,
//    from -> into) or Dismiss (stored, so the pair never comes back). Nothing is
//    applied without a click.
// 2. Your renames: each entry with Remove (asks first; removing is the undo, past
//    and future rows alike), and a form to add one by hand.
// 3. Dismissed suggestions, each with Show again.
// 4. Names on Zelle payments: "Name old Zelle payments by
//    the person in the note", a switch that starts off, with what it would do counted
//    beside it. The stock
//    @shadcn/switch, installed, as the What if list uses.
// A rename changes only the name shown. Category rules and recurring charges keep
// reading the bank's name (the user's option A).
//
// Registries searched first: "list" (shadcn-studio list-02, outlined Item
// cards, not installed here), "settings" (shadcnblocks settings blocks, Pro),
// "combobox" (the stock @shadcn/combobox, installed) and "data table". This screen
// is business UI over the user's own data, so it uses the installed Card, Button, Input,
// the app's CategoryPicker (built on @shadcn/combobox) and useConfirm (alert dialog).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import CategoryPicker from "./CategoryPicker";
import { useConfirm } from "./ConfirmDialog";
import {
  loadDb,
  getTransactionsUI,
  getMerchantRenamesUI,
  saveMerchantRenameUI,
  deleteMerchantRenameUI,
  getSuggestionDismissalsUI,
  dismissSuggestionUI,
  showSuggestionAgainUI,
  getZelleMemoNamesUI,
  setZelleMemoNamesUI,
  type Db,
} from "./lib/db";
import {
  namesBeforeRenames,
  renameMap,
  suggestMerges,
  zelleMemoNames,
  type MergeSuggestion,
  type MerchantRename,
  type MerchantRenameInput,
  type SuggestionDismissal,
} from "../domain/merchants";
import type { NormalizedTxn } from "../domain/types";

export interface MerchantSettingsDataLayer {
  loadDb: () => Promise<Db>;
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
  getMerchantRenames: (db: Db) => Promise<MerchantRename[]>;
  saveMerchantRename: (db: Db, rename: MerchantRenameInput) => Promise<void>;
  deleteMerchantRename: (db: Db, sourceName: string) => Promise<void>;
  getSuggestionDismissals: (db: Db) => Promise<SuggestionDismissal[]>;
  dismissSuggestion: (db: Db, d: { kind: SuggestionDismissal["kind"]; fromName: string; intoName: string }) => Promise<void>;
  showSuggestionAgain: (db: Db, id: string) => Promise<void>;
  /** "Show names from Zelle payment notes". */
  getZelleMemoNames: (db: Db) => Promise<boolean>;
  setZelleMemoNames: (db: Db, on: boolean) => Promise<void>;
}

const defaultDataLayer: MerchantSettingsDataLayer = {
  loadDb,
  getTransactions: getTransactionsUI,
  getMerchantRenames: getMerchantRenamesUI,
  saveMerchantRename: saveMerchantRenameUI,
  deleteMerchantRename: deleteMerchantRenameUI,
  getSuggestionDismissals: getSuggestionDismissalsUI,
  dismissSuggestion: dismissSuggestionUI,
  showSuggestionAgain: showSuggestionAgainUI,
  getZelleMemoNames: getZelleMemoNamesUI,
  setZelleMemoNames: setZelleMemoNamesUI,
};

interface Loaded {
  txns: NormalizedTxn[];
  renames: MerchantRename[];
  dismissals: SuggestionDismissal[];
  zelleByMemo: boolean;
}

const count = (n: number) => `${n} ${n === 1 ? "transaction" : "transactions"}`;

export default function MerchantSettings({ dataLayer }: { dataLayer?: Partial<MerchantSettingsDataLayer> }) {
  const deps = useMemo<MerchantSettingsDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);
  const dbRef = useRef<Db | null>(null);
  const [phase, setPhase] = useState<"loading" | "unavailable" | "ready">("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ source: string; shown: string }>({ source: "", shown: "" });
  const [formKey, setFormKey] = useState(0);
  const confirm = useConfirm();

  const reload = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    const [txns, renames, dismissals, zelleByMemo] = await Promise.all([
      deps.getTransactions(db),
      deps.getMerchantRenames(db),
      deps.getSuggestionDismissals(db),
      deps.getZelleMemoNames(db).catch(() => false),
    ]);
    setLoaded({ txns, renames, dismissals, zelleByMemo });
  }, [deps]);

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

  const suggestions = useMemo<MergeSuggestion[]>(
    () => (loaded ? suggestMerges(loaded.txns, renameMap(loaded.renames, { zelleByMemo: loaded.zelleByMemo }), new Set(loaded.dismissals.map((d) => d.id))) : []),
    [loaded]
  );
  const names = useMemo(() => (loaded ? namesBeforeRenames(loaded.txns, { zelleByMemo: loaded.zelleByMemo }) : []), [loaded]);
  const zelle = useMemo(() => (loaded ? zelleMemoNames(loaded.txns) : null), [loaded]);

  /** Every write goes through here: one at a time, then a fresh read, and a refusal shown in its own words. */
  const write = async (action: (db: Db) => Promise<void>) => {
    const db = dbRef.current;
    if (!db) return;
    setBusy(true);
    setError(null);
    try {
      await action(db);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (phase === "loading") return <Skeleton className="h-72 w-full" />;
  if (phase === "unavailable" || !loaded) {
    return <p className="text-sm text-muted-foreground">The local server is not reachable. Restart the app.</p>;
  }

  const canSave = draft.source.trim() !== "" && draft.shown.trim() !== "" && !busy;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-base font-semibold">Merchants</h2>
        <p className="text-sm text-muted-foreground">
          Which names are the same merchant, and what should each be called? A rename changes only the name shown, on
          past and future transactions. Category rules and recurring charges still read the bank's name.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Suggested merges</CardTitle>
          <CardDescription>
            Accept shows the first name as the second, and adds a rename you can remove later. Dismiss keeps the two
            apart and hides the suggestion for good. Nothing changes until you press one. Zelle payments lose the
            reference code at the end of their name by themselves, so one person reads as one name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No suggestions right now.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {suggestions.map((s) => (
                <li key={s.id} data-testid={`suggestion-${s.from}`} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{s.from}</span>{" "}
                      <span className="text-muted-foreground">({count(s.fromCount)})</span> into{" "}
                      <span className="font-medium">{s.into}</span>{" "}
                      <span className="text-muted-foreground">({count(s.intoCount)})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{s.reason}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      aria-label={`Accept: show ${s.from} as ${s.into}`}
                      onClick={() => void write((db) => deps.saveMerchantRename(db, { sourceName: s.from, displayName: s.into }))}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`Dismiss: keep ${s.from} apart from ${s.into}`}
                      onClick={() => void write((db) => deps.dismissSuggestion(db, { kind: s.kind, fromName: s.from, intoName: s.into }))}
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your renames</CardTitle>
          <CardDescription>
            Each line shows a bank's name as another name. The match is the whole name, whatever its capital letters.
            Remove one to show the bank's name again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Bank name</span>
              <CategoryPicker
                key={formKey}
                categories={names}
                label="Bank name"
                triggerLabel="Show the bank's names"
                placeholder="Type to find a name"
                allowCreate={false}
                emptyText="No name matches."
                className="w-72"
                onPick={(choice) => setDraft((d) => ({ ...d, source: choice }))}
                onInputChange={(typed) => setDraft((d) => (typed === d.source ? d : { ...d, source: "" }))}
              />
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Show as</span>
              <Input
                aria-label="Show as"
                value={draft.shown}
                onChange={(e) => setDraft((d) => ({ ...d, shown: e.target.value }))}
                className="w-64"
              />
            </label>
            <Button
              disabled={!canSave}
              onClick={() =>
                void write(async (db) => {
                  await deps.saveMerchantRename(db, { sourceName: draft.source.trim(), displayName: draft.shown.trim() });
                  setDraft({ source: "", shown: "" });
                  setFormKey((k) => k + 1);
                })
              }
            >
              Save rename
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table data-testid="rename-list" className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-4">Bank name</th>
                  <th className="pb-2 pr-4">Shown as</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {loaded.renames.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-2 text-muted-foreground">
                      No renames yet. Every merchant shows the bank's name.
                    </td>
                  </tr>
                ) : (
                  loaded.renames.map((r) => (
                    <tr key={r.sourceName.toLowerCase()} className="border-b last:border-0">
                      <td className="py-1.5 pr-4">{r.sourceName}</td>
                      <td className="py-1.5 pr-4">{r.displayName}</td>
                      <td className="py-1.5 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Remove ${r.sourceName}`}
                          onClick={() =>
                            confirm.ask({
                              title: "Remove this rename?",
                              description: `${r.sourceName} will show as the bank's name again, on past and future transactions. You can add the rename again at any time.`,
                              confirmLabel: "Remove rename",
                              onConfirm: () => void write((db) => deps.deleteMerchantRename(db, r.sourceName)),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {zelle && zelle.rows > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Names on Zelle payments</CardTitle>
            <CardDescription>
              Some banks label a payment Zelle and put the sender or recipient in the transaction note. Turn this on
              to show that name. You can turn it off again to restore the original labels.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="inline-flex min-h-6 min-w-6 items-center justify-center">
                <Switch
                  checked={loaded.zelleByMemo}
                  disabled={busy}
                  aria-label="Show names from Zelle payment notes"
                  onCheckedChange={(on: boolean) => void write((db) => deps.setZelleMemoNames(db, on))}
                />
              </span>
              <span aria-hidden="true">Show names from Zelle payment notes</span>
            </div>
            <p data-testid="zelle-memo-summary" className="text-muted-foreground">
              {`${zelle.rows} ${zelle.rows === 1 ? "payment is" : "payments are"} named just Zelle. Turned on, ${zelle.rows - zelle.unparsed} of them would read as ${zelle.names.length} ${zelle.names.length === 1 ? "person" : "people"}`}
              {zelle.unparsed > 0
                ? `; ${zelle.unparsed} ${zelle.unparsed === 1 ? "note could not be read and stays" : "notes could not be read and stay"} Zelle.`
                : "."}
            </p>
          </CardContent>
        </Card>
      )}

      {loaded.dismissals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dismissed suggestions</CardTitle>
            <CardDescription>Pairs you chose to keep apart. Show again puts one back in Suggested merges.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul data-testid="dismissed-list" className="flex flex-col divide-y">
              {loaded.dismissals.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    {d.fromName} <span className="text-muted-foreground">and</span> {d.intoName}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    aria-label={`Show again: ${d.fromName} into ${d.intoName}`}
                    onClick={() => void write((db) => deps.showSuggestionAgain(db, d.id))}
                  >
                    Show again
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {confirm.dialog}
    </div>
  );
}
