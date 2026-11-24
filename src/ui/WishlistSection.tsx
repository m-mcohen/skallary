// src/ui/WishlistSection.tsx
//
// The Wish List: one-time things the user wants to buy, in the order the user would
// buy them.
// Each item is a name and a cost; the order is set by dragging a row by its
// handle. Nothing here reaches the forecast, the runway or the top bar. Since
// The Forecast reads no start or end month on a
// What if change either, so only a car's or a mortgage's down payment is one-time.
//
// The stored row still carries the old kind, date and budget-line columns
// (no schema change); this screen always writes them as a wish with no date
// and no line.
//
// Composed from the installed @shadcn primitives (table, dialog, input, label,
// button, alert, skeleton); the drag handle rows are @dnd-kit, the library the
// registries' sortable lists use (see src/ui/wishlist/SortableWishRow.tsx).
// Same injectable data layer and not-connected handling as GoalsSection.tsx.
import { useCallback, useEffect, useMemo, useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

import { loadDb, listWishlistItemsUI, upsertWishlistItemUI, deleteWishlistItemUI, reorderWishlistUI, type Db } from "./lib/db";
import type { WishlistItem } from "../domain/plan-types";
import { wishlistTotal } from "../domain/wishlist";
import { formatWholeDollars, parseDollarsToCents } from "../domain/money";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConfirm } from "./ConfirmDialog";
import SortableWishRow from "./wishlist/SortableWishRow";

// ---------------------------------------------------------------------------
// Injectable data layer
// ---------------------------------------------------------------------------

export interface WishlistDataLayer {
  loadDb: () => Promise<Db>;
  listWishlistItems: (db: Db) => Promise<WishlistItem[]>;
  upsertWishlistItem: (db: Db, item: WishlistItem) => Promise<void>;
  deleteWishlistItem: (db: Db, id: string) => Promise<void>;
  /** Save the whole order, top first. */
  reorderWishlist: (db: Db, ids: string[]) => Promise<void>;
}

const defaultDataLayer: WishlistDataLayer = {
  loadDb,
  listWishlistItems: listWishlistItemsUI,
  upsertWishlistItem: upsertWishlistItemUI,
  deleteWishlistItem: deleteWishlistItemUI,
  reorderWishlist: reorderWishlistUI,
};

export interface WishlistSectionProps {
  /** Override any subset of the data layer (tests inject stubs; the app uses the default). */
  dataLayer?: Partial<WishlistDataLayer>;
  /** Render the add-item dialog already open -- tests use this to skip driving the trigger button. */
  defaultDialogOpen?: boolean;
}

type ItemsPhase = "loading" | "unavailable" | "empty" | "ready" | "error";

function emptyDraft() {
  return { name: "", costDollars: "" };
}

export default function WishlistSection({ dataLayer, defaultDialogOpen }: WishlistSectionProps) {
  const deps = useMemo<WishlistDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);
  const confirm = useConfirm();

  const [db, setDb] = useState<Db | null>(null);
  const [itemsPhase, setItemsPhase] = useState<ItemsPhase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [items, setItems] = useState<WishlistItem[]>([]);

  const [dialogOpen, setDialogOpen] = useState(!!defaultDialogOpen);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const refresh = useCallback(
    async (handle: Db) => {
      const rows = await deps.listWishlistItems(handle);
      setItems(rows);
      return rows;
    },
    [deps]
  );

  // Load the db handle and the items. An unreachable local server (headless
  // build, preview) renders a neutral "not connected" state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let handle: Db;
      try {
        handle = await deps.loadDb();
      } catch {
        if (!cancelled) setItemsPhase("unavailable");
        return;
      }
      if (cancelled) return;
      setDb(handle);
      try {
        const rows = await refresh(handle);
        if (cancelled) return;
        setItemsPhase(rows.length === 0 ? "empty" : "ready");
      } catch (e) {
        if (!cancelled) {
          setErrorMessage(e instanceof Error ? e.message : String(e));
          setItemsPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Data layer only meaningfully changes identity across remounts in this app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAddDialog = useCallback(() => {
    setEditingId(null);
    setDraft(emptyDraft());
    setFormError(null);
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((item: WishlistItem) => {
    setEditingId(item.id);
    setDraft({ name: item.name, costDollars: (item.costCents / 100).toFixed(2) });
    setFormError(null);
    setDialogOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!db) return;
    setFormError(null);
    const name = draft.name.trim();
    if (!name) {
      setFormError("Name is required.");
      return;
    }
    let costCents: number;
    try {
      costCents = parseDollarsToCents(draft.costDollars);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Invalid dollar amount.");
      return;
    }
    if (costCents <= 0) {
      setFormError("Cost must be greater than zero.");
      return;
    }
    // The order is set by dragging: an edit keeps its place, a new item goes to the bottom.
    const existing = editingId ? items.find((w) => w.id === editingId) : undefined;
    const priority = existing ? existing.priority : items.reduce((max, w) => Math.max(max, w.priority), 0) + 1;
    const item: WishlistItem = {
      id: editingId ?? `wish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      costCents,
      // A one-time item: never planned, never dated, never on a budget line.
      kind: "wish",
      targetDate: null,
      priority,
      planningCategory: null,
    };
    setSaving(true);
    try {
      await deps.upsertWishlistItem(db, item);
      await refresh(db);
      setItemsPhase("ready");
      setDialogOpen(false);
      setDraft(emptyDraft());
      setEditingId(null);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [db, deps, draft, editingId, items, refresh]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!db) return;
      setDeletingId(id);
      try {
        await deps.deleteWishlistItem(db, id);
        const rows = await refresh(db);
        setItemsPhase(rows.length === 0 ? "empty" : "ready");
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setItemsPhase("error");
      } finally {
        setDeletingId(null);
      }
    },
    [db, deps, refresh]
  );

  // Drag to reorder: the list moves at once, the whole order is saved in one
  // step, and a refusal reloads the list and says why.
  const handleDragEnd = useCallback(
    async ({ active, over }: DragEndEvent) => {
      if (!db || !over || active.id === over.id) return;
      const from = items.findIndex((w) => w.id === active.id);
      const to = items.findIndex((w) => w.id === over.id);
      if (from < 0 || to < 0) return;
      const before = items;
      const next = arrayMove(items, from, to).map((w, i) => ({ ...w, priority: i + 1 }));
      setItems(next);
      setOrderError(null);
      setReordering(true);
      try {
        await deps.reorderWishlist(db, next.map((w) => w.id));
      } catch (e) {
        setOrderError(e instanceof Error ? e.message : String(e));
        // Reload rather than restore: an add or delete may have landed while
        // this order was in flight.
        try {
          const rows = await refresh(db);
          setItemsPhase(rows.length === 0 ? "empty" : "ready");
        } catch {
          setItems(before);
        }
      } finally {
        setReordering(false);
      }
    },
    [db, deps, items, refresh]
  );

  const itemDialog = (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open: boolean) => {
        setDialogOpen(open);
        if (!open) {
          setEditingId(null);
          setDraft(emptyDraft());
          setFormError(null);
        }
      }}
    >
      <DialogTrigger render={<Button onClick={openAddDialog} />}>
        <PlusIcon />
        Add item
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingId ? "Edit wishlist item" : "Add wishlist item"}</DialogTitle>
          <DialogDescription>Something you want to buy once. New items go to the bottom of the list.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wish-name">Name</Label>
            <Input id="wish-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. New couch" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wish-cost">Cost</Label>
            <Input
              id="wish-cost"
              inputMode="decimal"
              value={draft.costDollars}
              onChange={(e) => setDraft((d) => ({ ...d, costDollars: e.target.value }))}
              placeholder="$0.00"
            />
          </div>
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  let body: React.ReactNode;
  if (itemsPhase === "loading") {
    body = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  } else if (itemsPhase === "unavailable") {
    body = (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>No local database connection. The local server is not reachable. Restart the app.</AlertDescription>
      </Alert>
    );
  } else if (itemsPhase === "error") {
    body = (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load the wishlist</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
    );
  } else if (itemsPhase === "empty") {
    body = (
      <Alert>
        <AlertTitle>No wishlist items yet</AlertTitle>
        <AlertDescription>Add something you want to buy once, then drag the list into the order you would buy them.</AlertDescription>
      </Alert>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={(e) => void handleDragEnd(e)}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <SortableContext items={items.map((w) => w.id)} strategy={verticalListSortingStrategy}>
                {items.map((item, index) => (
                  <SortableWishRow key={item.id} id={item.id} index={index} name={item.name} disabled={reordering}>
                    {/* A long name is shortened by the layout (the whole name is on hover), so the
                        controls never get pushed off a 1280 px screen. */}
                    <TableCell className="max-w-[16rem] font-medium xl:max-w-[30rem]" data-testid="wish-name">
                      <span className="block truncate" title={item.name}>
                        {item.name}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatWholeDollars(item.costCents)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="icon-sm" onClick={() => openEditDialog(item)} aria-label={`Edit ${item.name}`} title={`Edit ${item.name}`}>
                          <PencilIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() =>
                            confirm.ask({
                              title: `Delete ${item.name}?`,
                              description: "This removes the item from the Wish List. This cannot be undone.",
                              confirmLabel: "Delete item",
                              onConfirm: () => void handleDelete(item.id),
                            })
                          }
                          disabled={deletingId === item.id}
                          aria-label={`Delete ${item.name}`}
                          title={`Delete ${item.name}`}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </SortableWishRow>
                ))}
              </SortableContext>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="font-medium tabular-nums">{formatWholeDollars(wishlistTotal(items).totalCents)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </DndContext>
        {orderError && (
          <Alert variant="destructive">
            <AlertDescription>Order not saved: {orderError}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {confirm.dialog}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-base font-semibold">Wish List</h2>
          <p className="text-sm text-muted-foreground">
            One-time things you want to buy, in the order you would buy them. Drag a row by its handle to change the order.
          </p>
        </div>
        {itemsPhase !== "loading" && itemsPhase !== "unavailable" && itemDialog}
      </div>
      {body}
    </div>
  );
}
