// src/ui/wishlist/SortableWishRow.tsx
//
// One Wish List row that can be dragged into place by its grip handle
// .
// Built on @dnd-kit, the library the registries' sortable lists use
// (@shadcnblocks/list-panel-list-drag-handle-leading and friends); the row is
// the app's own table row, so the table keeps its columns. The handle also
// works from the keyboard: Space to pick up, arrows to move, Space to drop.
// The only motion is the row following the pointer, which is the information
// (where it will land); it is dropped when the reader asks for reduced motion.
import type { CSSProperties, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";

import { TableCell, TableRow } from "@/components/ui/table";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface SortableWishRowProps {
  id: string;
  index: number;
  name: string;
  disabled: boolean;
  children: ReactNode;
}

export default function SortableWishRow({ id, index, name, disabled, children }: SortableWishRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: prefersReducedMotion() ? undefined : transition,
  };
  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      data-testid="wish-row"
      data-wish-row={index}
      className={isDragging ? "relative z-10 bg-muted" : undefined}
    >
      <TableCell className="w-12">
        <div className="flex items-center gap-1">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${name}`}
            disabled={disabled}
            className="cursor-grab touch-none rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing disabled:cursor-default disabled:opacity-50"
          >
            <GripVerticalIcon className="size-4" />
          </button>
          <span data-testid="wish-order" className="tabular-nums text-muted-foreground">
            {index + 1}
          </span>
        </div>
      </TableCell>
      {children}
    </TableRow>
  );
}
