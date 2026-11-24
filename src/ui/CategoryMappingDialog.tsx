// src/ui/CategoryMappingDialog.tsx
//
// P11 (Plan 2, last task): the category-mapping editor. category_mappings
// maps a Monarch/source category name -> the user's planning category;
// rollupMonthly (src/domain/rollups.ts) consults it, and an unmapped source
// category falls through to its own raw name there. This component's only
// job is letting the user create/update those overrides -- no domain logic
// lives here, and no rollup/forecast math is reimplemented.
//
// Registries-first per the brief: this repo already has @shadcn/select and
// @shadcn/input (installed for P9's BudgetGrid, see src/components/ui/select.tsx
// and input.tsx), so this task only needed `npx shadcn@latest add @shadcn/dialog
// @shadcn/table` -> src/components/ui/dialog.tsx, table.tsx. Checked the
// @shadcn-studio variants the brief flagged: `select-01` is a single-purpose
// native <select> gender-field demo, and `dialog-01` is a destructive-action
// confirmation (wraps AlertDialog, "Are you absolutely sure?") -- neither fits
// an editable mapping table, so this composes the same plain @shadcn
// dialog/table/select/input/button primitives BudgetGrid.tsx and Charts.tsx
// already use. No 401s encountered (dialog/table/select are all free @shadcn
// primitives, not shadcnblocks Pro blocks).
//
// Same injectable-data-layer / try-catch-around-the-load pattern as
// BudgetGrid.tsx and Charts.tsx: App.tsx uses the real src/ui/lib/db.ts
// functions (the default export below), tests inject stubs, and headless
// `vite build`/`vite preview` with no server behind /api render a neutral
// state instead of crashing.
//
// Saving a row re-fetches transactions + mappings from the db (not just the
// mappings) so a newly-typed planning category immediately becomes available
// as a Select option for every other row in the same dialog session. Per the
// brief, the budget grid/forecast picking up the change is a next-load
// concern -- there's no live cross-component sync wired here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { loadDb, getTransactionsUI, getCategoryMappingsUI, setCategoryMappingUI, type Db } from "./lib/db";
import type { NormalizedTxn } from "../domain/types";

import { Button } from "@/components/ui/button";
import CategoryPicker from "./CategoryPicker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Injectable data layer (mirrors BudgetGrid.tsx's BudgetGridDataLayer / Charts.tsx's ChartsDataLayer)
// ---------------------------------------------------------------------------

export interface CategoryMappingDataLayer {
  loadDb: () => Promise<Db>;
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
  getCategoryMappings: (db: Db) => Promise<Record<string, string>>;
  setCategoryMapping: (db: Db, sourceCategory: string, planningCategory: string) => Promise<void>;
}

const defaultDataLayer: CategoryMappingDataLayer = {
  loadDb,
  getTransactions: getTransactionsUI,
  getCategoryMappings: getCategoryMappingsUI,
  setCategoryMapping: setCategoryMappingUI,
};

export interface CategoryMappingDialogProps {
  /** Override any subset of the data layer (tests inject stubs; App.tsx uses the default). */
  dataLayer?: Partial<CategoryMappingDataLayer>;
  /** Render already open -- tests use this to skip driving the trigger button. */
  defaultOpen?: boolean;
  /** Show the list in a card, with no button to open it: Settings, Mappings. */
  inline?: boolean;
}

type Phase = "loading" | "unavailable" | "empty" | "ready" | "error";

export default function CategoryMappingDialog({ dataLayer, defaultOpen, inline = false }: CategoryMappingDialogProps) {
  const deps = useMemo<CategoryMappingDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);

  const [db, setDb] = useState<Db | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sourceCategories, setSourceCategories] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [selectDraft, setSelectDraft] = useState<Record<string, string>>({});
  const [savingRow, setSavingRow] = useState<string | null>(null);

  const refresh = useCallback(
    async (handle: Db) => {
      const [txns, mapped] = await Promise.all([deps.getTransactions(handle), deps.getCategoryMappings(handle)]);
      const distinct = [...new Set(txns.map((t) => t.sourceCategory).filter((c): c is string => Boolean(c)))].sort();
      setSourceCategories(distinct);
      setMappings(mapped);
      return distinct;
    },
    [deps]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let handle: Db;
      try {
        handle = await deps.loadDb();
      } catch {
        // Expected when the local Node server is unreachable (headless build / preview).
        if (!cancelled) setPhase("unavailable");
        return;
      }
      if (cancelled) return;
      setDb(handle);

      try {
        const distinct = await refresh(handle);
        if (cancelled) return;
        setPhase(distinct.length === 0 ? "empty" : "ready");
      } catch (e) {
        if (!cancelled) {
          setErrorMessage(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Data layer only meaningfully changes identity across remounts in this app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Known planning categories = every distinct value currently mapped to, so
  // the Select offers reuse of categories the user already created.
  const planningCategories = useMemo(() => [...new Set(Object.values(mappings))].sort(), [mappings]);

  const handleSave = useCallback(
    async (sourceCategory: string) => {
      if (!db) return;
      // Whatever the picker handed over: an existing planning category, or a new
      // name typed into it. The mapping itself is what makes a new
      // planning category exist.
      const value = (selectDraft[sourceCategory] ?? "").trim();
      if (!value) return;

      setSavingRow(sourceCategory);
      try {
        await deps.setCategoryMapping(db, sourceCategory, value);
        // Re-fetch so this dialog reflects the change immediately (per the brief:
        // no live cross-component sync needed, but the dialog itself must update).
        await refresh(db);
        setSelectDraft((prev) => ({ ...prev, [sourceCategory]: "" }));
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingRow(null);
      }
    },
    [db, deps, selectDraft, refresh]
  );

  let content: React.ReactNode;
  if (phase === "loading") {
    content = <Skeleton className="h-64 w-full rounded-lg" />;
  } else if (phase === "unavailable") {
    content = (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>
          No local database connection. The local server is not reachable. Restart the app.
        </AlertDescription>
      </Alert>
    );
  } else if (phase === "error") {
    content = (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load category mappings</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
    );
  } else if (phase === "empty") {
    content = (
      <Alert>
        <AlertTitle>No categories yet</AlertTitle>
        <AlertDescription>Import transactions first. Mappings are built from what is in the data.</AlertDescription>
      </Alert>
    );
  } else {
    content = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source category</TableHead>
            <TableHead>Planning category</TableHead>
            <TableHead>Set to</TableHead>
            <TableHead className="w-1" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sourceCategories.map((source) => {
            const current = mappings[source] ?? source; // rollupMonthly's own unmapped fallback
            const isMapped = source in mappings;
            return (
              <TableRow key={source}>
                <TableCell className="font-medium">{source}</TableCell>
                <TableCell className="text-muted-foreground">
                  {current}
                  {!isMapped && " (unmapped)"}
                </TableCell>
                <TableCell>
                  {/* Type to filter, or type a new planning category.
                      Keyed by the current mapping so the box clears after a save. */}
                  <CategoryPicker
                    key={`${source}|${current}`}
                    categories={planningCategories}
                    label={`Planning category for ${source}`}
                    placeholder="Choose, or type a new one"
                    value={selectDraft[source] ?? ""}
                    className="w-56"
                    onPick={(choice) => setSelectDraft((prev) => ({ ...prev, [source]: choice }))}
                    // What the box shows is what Save writes: typing past a pick clears the
                    // draft until the next pick. (After a pick the box shows the picked
                    // name, which equals the draft, so that change keeps it.)
                    onInputChange={(text) =>
                      setSelectDraft((prev) => (prev[source] === text ? prev : { ...prev, [source]: "" }))
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    onClick={() => handleSave(source)}
                    disabled={savingRow === source || !selectDraft[source]?.trim()}
                  >
                    Save
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  const description =
    "Map each source category to a planning category. Unmapped categories fall through to their raw name in the budget.";

  if (inline) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Category mappings</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{content}</CardContent>
      </Card>
    );
  }

  return (
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger render={<Button variant="outline" />}>Manage category mappings</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Category mappings</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">{content}</div>
      </DialogContent>
    </Dialog>
  );
}
