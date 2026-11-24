// src/ui/reports/CategoryFilter.tsx
//
// Narrow Reports, Spending to chosen budget lines.
// The registry search found the multi-select comboboxes with chips; this follows
// the installed `@shadcn/combobox` (Base UI) in its "multiple" form, the same
// component the app's category picker is built on, so no component was added.
// "All categories" clears the choice.
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";

export interface CategoryFilterProps {
  /** Every budget line there is to choose from, A to Z. */
  options: string[];
  /** What is chosen now. Empty means every category. */
  chosen: string[];
  onChoose: (next: string[]) => void;
}

export default function CategoryFilter({ options, chosen, onChoose }: CategoryFilterProps) {
  const anchor = useComboboxAnchor();
  // A chosen line with no spending in the history still shows, so it can be removed.
  const items = [...options, ...chosen.filter((c) => !options.includes(c))];
  return (
    <div data-testid="category-filter" className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Show</span>
      <Combobox multiple autoHighlight items={items} value={chosen} onValueChange={(next) => onChoose(next as string[])}>
        <ComboboxChips ref={anchor} className="min-w-64 max-w-xl flex-1">
          <ComboboxValue>
            {(values: string[]) => (
              <>
                {values.map((value) => (
                  <ComboboxChip key={value}>{value}</ComboboxChip>
                ))}
                <ComboboxChipsInput aria-label="Categories to show" placeholder={values.length === 0 ? "All categories. Type to choose some" : "Add a category"} />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No category matches.</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <Button variant="outline" size="sm" disabled={chosen.length === 0} onClick={() => onChoose([])}>
        All categories
      </Button>
    </div>
  );
}
