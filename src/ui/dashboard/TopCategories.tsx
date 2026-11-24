// src/ui/dashboard/TopCategories.tsx -- Top categories folds away. Closed, one line: the top three
// and how many more. Open, the full list with each Last month line. Starts
// closed; open or closed is remembered in this browser. Built on the registry
// Collapsible (@shadcn/collapsible). The chevron's turn shows which state it is
// in, and stands still for reduced motion.
import { useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { formatCents } from "../../domain/money";

export const TOP_CATEGORIES_KEY = "finance.dashboard.topCategoriesOpen";

function remembered(): boolean {
  try {
    return localStorage.getItem(TOP_CATEGORIES_KEY) === "open";
  } catch {
    return false;
  }
}

function remember(open: boolean): void {
  try {
    localStorage.setItem(TOP_CATEGORIES_KEY, open ? "open" : "closed");
  } catch {
    // A browser that refuses storage still folds; it just forgets.
  }
}

export interface TopItem {
  category: string;
  cents: number;
}

/** "Groceries $612.40, Dining $340.10, Gas $188.00, +2 more". */
export function summaryLine(items: TopItem[]): string {
  const top = items.slice(0, 3).map((c) => `${c.category} ${formatCents(c.cents)}`);
  const more = items.length - top.length;
  return more > 0 ? `${top.join(", ")}, +${more} more` : top.join(", ");
}

export default function TopCategories({
  items,
  renderAmount,
  renderBefore,
  emptyText,
}: {
  items: TopItem[];
  /** The amount, usually a link to its ledger. */
  renderAmount: (c: TopItem) => ReactNode;
  /** The Last month line under the amount, when there is one. */
  renderBefore?: (c: TopItem) => ReactNode;
  emptyText: string;
}) {
  const [open, setOpen] = useState(remembered);
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        remember(next);
      }}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 pb-2 text-left text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
        <ChevronRightIcon
          aria-hidden="true"
          className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
        Top categories
      </CollapsibleTrigger>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        !open && (
          <p data-testid="top-categories-summary" className="text-sm">
            {summaryLine(items)}
          </p>
        )
      )}
      {items.length > 0 && (
        <CollapsibleContent>
          <ul className="flex flex-col divide-y">
            {items.map((c) => (
              <li key={c.category} data-testid={`month-top-${c.category}`} className="flex items-start justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 truncate">{c.category}</span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="font-mono tabular-nums">{renderAmount(c)}</span>
                  {renderBefore?.(c)}
                </span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
