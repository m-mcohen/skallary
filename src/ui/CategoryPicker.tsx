// src/ui/CategoryPicker.tsx
//
// The one control for choosing a category, wherever a category is chosen.
// Built on the registry combobox (`@shadcn/combobox`, Base UI)
// rather than the native select it replaces.
//
// What it does NOT do: write anything. It hands the host a choice and says
// whether it is new; the host records a new category (an identity mapping, so
// the name appears in every list from then on) and applies the choice the way
// it always has. The "and everything like it" switch stays with the host too,
// because only the host knows whether a rule makes sense.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { PlusIcon, ArrowLeftRightIcon } from "lucide-react";

import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

/** The choice that means "a transfer between my own accounts", not a category. */
export const TRANSFER_CHOICE = "__transfer__";
const TRANSFER_LABEL = "Transfer (not spending)";

interface PickerItem {
  value: string;
  label: string;
  kind: "category" | "transfer" | "create";
}

export interface CategoryPickerProps {
  categories: string[];
  /** The accessible name of the box, for example "Category" or "File Netflix as". */
  label: string;
  /** The accessible name of the open button, for example "Show categories for Netflix". */
  triggerLabel?: string;
  placeholder?: string;
  /** Offer "Transfer (not spending)" as a choice. */
  allowTransfer?: boolean;
  /** Offer "Create ..." when the typed name matches no category. Default true. */
  allowCreate?: boolean;
  disabled?: boolean;
  /** Open with the list showing and the cursor in the box (a row that was just clicked). */
  autoFocus?: boolean;
  /** What the box shows before anything is typed. */
  value?: string | null;
  /** A choice was made. `created` is true for a name that is not in `categories`. */
  onPick: (choice: string, meta: { created: boolean }) => void;
  /** The list closed with nothing chosen. Never called for a pick. */
  onCancel?: () => void;
  /**
   * The text in the box changed. After a pick the box shows the picked name, so
   * a host that keeps a draft can tell a pick from later typing by comparing.
   */
  onInputChange?: (text: string) => void;
  /**
   * Shown inside the list, under the choices: the host's "and everything like
   * it" switch. Inside, so using it cannot close the list (a click outside
   * would), and so the option is right there when a new category is created.
   */
  footer?: ReactNode;
  /** What the list says when nothing matches. Defaults to the category wording. */
  emptyText?: string;
  className?: string;
}

/**
 * The exact category a typed name means, ignoring case and surrounding spaces,
 * so "groceries" picks "Groceries" rather than creating a near-duplicate.
 */
export function matchCategory(categories: string[], typed: string): string | null {
  const q = typed.trim().toLowerCase();
  if (!q) return null;
  return categories.find((c) => c.trim().toLowerCase() === q) ?? null;
}

export default function CategoryPicker({
  categories,
  label,
  triggerLabel = "Show categories",
  placeholder = "Type to search, or add",
  allowTransfer = false,
  allowCreate = true,
  disabled = false,
  autoFocus = false,
  value = null,
  onPick,
  onCancel,
  onInputChange,
  footer,
  emptyText = "No category matches. Keep typing to add one.",
  className,
}: CategoryPickerProps) {
  const [inputValue, setInputValue] = useState(value ?? "");
  const [open, setOpen] = useState(autoFocus);
  // The picked item stays selected so the box keeps showing its name (Base UI
  // clears the box after a pick when nothing is selected).
  const [selected, setSelected] = useState<PickerItem | null>(null);
  // Set the instant a pick happens, read when the list closes: the close that a
  // pick causes is not a cancel. A ref, because Base UI closes synchronously.
  const pickedRef = useRef(false);

  const items = useMemo<PickerItem[]>(() => {
    const q = inputValue.trim().toLowerCase();
    const rank = (c: string) => {
      const n = c.toLowerCase();
      return n === q ? 0 : n.startsWith(q) ? 1 : 2;
    };
    // Exact name first, then names that start with the text, then the rest,
    // each group in the list's own order. Enter takes the first row.
    const matches: PickerItem[] = categories
      .filter((c) => q === "" || c.toLowerCase().includes(q))
      .map((c, i) => ({ c, i, r: rank(c) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ c }) => ({ value: c, label: c, kind: "category" as const }));
    const transfer: PickerItem[] =
      allowTransfer && (q === "" || TRANSFER_LABEL.toLowerCase().includes(q))
        ? [{ value: TRANSFER_CHOICE, label: TRANSFER_LABEL, kind: "transfer" }]
        : [];
    const typed = inputValue.trim();
    const create: PickerItem[] =
      allowCreate && typed && !matchCategory(categories, typed)
        ? [{ value: typed, label: `Create "${typed}"`, kind: "create" }]
        : [];
    // A name that starts no existing name is most likely new: Create comes first,
    // so Enter creates it. Text that starts a name is most likely a filter, so
    // that name comes first and Enter picks it, the way every combobox does.
    const startsAny = q !== "" && categories.some((c) => c.toLowerCase().startsWith(q));
    return create.length > 0 && !startsAny ? [...create, ...matches, ...transfer] : [...matches, ...transfer, ...create];
  }, [categories, inputValue, allowTransfer, allowCreate]);

  return (
    <Combobox<PickerItem>
      items={items}
      // Filtering is done above, so that the "Create" row and the transfer row
      // can be added to the list; the built-in filter would hide them.
      filter={null}
      autoHighlight
      value={selected}
      disabled={disabled}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) return;
        if (pickedRef.current) pickedRef.current = false;
        else onCancel?.();
      }}
      inputValue={inputValue}
      onInputValueChange={(next) => {
        setInputValue(next);
        onInputChange?.(next);
      }}
      // What the box shows after a pick: the created name itself, not 'Create "..."'.
      itemToStringLabel={(item) => (item.kind === "create" ? item.value : item.label)}
      itemToStringValue={(item) => item.value}
      isItemEqualToValue={(a, b) => a.value === b.value && a.kind === b.kind}
      onValueChange={(item) => {
        if (!item) return;
        pickedRef.current = true;
        setSelected(item);
        onPick(item.value, { created: item.kind === "create" });
      }}
    >
      <ComboboxInput
        aria-label={label}
        triggerLabel={triggerLabel}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={className}
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          <ComboboxCollection>
            {(item: PickerItem) => (
              <ComboboxItem key={`${item.kind}:${item.value}`} value={item} data-kind={item.kind}>
                {item.kind === "create" && <PlusIcon className="size-4 opacity-60" aria-hidden="true" />}
                {item.kind === "transfer" && <ArrowLeftRightIcon className="size-4 opacity-60" aria-hidden="true" />}
                {item.label}
              </ComboboxItem>
            )}
          </ComboboxCollection>
        </ComboboxList>
        {footer && (
          <div data-testid="category-picker-footer" className="border-t px-2 py-1.5 text-xs text-muted-foreground">
            {footer}
          </div>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
