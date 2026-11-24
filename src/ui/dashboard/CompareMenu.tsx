// src/ui/dashboard/CompareMenu.tsx -- "Compare with": a tick box for each comparison the
// Dashboard can show. On both the This month so far card and the Spending by day chart, so the
// choice is still at hand when either card is folded away; both menus change the one shared set.
// Built on the app's registry dropdown menu (@shadcn/dropdown-menu).
import { ChevronDownIcon, GitCompareArrowsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { TICKS, setTick, useTicks } from "./compare-ticks";

export default function CompareMenu({ testId = "compare-menu" }: { testId?: string }) {
  const ticks = useTicks();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" data-testid={testId} />}
      >
        <GitCompareArrowsIcon className="size-3.5" />
        Compare with
        <ChevronDownIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {TICKS.map((t) => (
          <DropdownMenuCheckboxItem
            key={t.id}
            data-testid={`${testId}-${t.id}`}
            checked={ticks.includes(t.id)}
            onCheckedChange={(on) => setTick(t.id, on)}
          >
            {t.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
