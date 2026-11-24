// src/ui/shell/ComparePicker.tsx
//
// What the period is compared with: nothing, the previous period, the same
// period last year, or an average. Reports only, since it is the one screen that
// shows comparisons. It sits beside the period picker because the two read as one
// sentence: "Last month, compared with the same period last year".
//
// Each choice says what it would mean for the period in view ("Aug 1 to Aug 20,
// 2026"), so the same-days rule is visible before it is chosen rather than
// discovered afterwards in a column header.
import { useState } from "react";
import { ChevronDownIcon, GitCompareArrowsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { COMPARE_OPTIONS, baselineFor } from "../../domain/compare";
import { pickCompare, useCompare, usePeriod } from "../lib/period-store";

export default function ComparePicker() {
  const period = usePeriod();
  const compare = useCompare();
  const [open, setOpen] = useState(false);

  const label = COMPARE_OPTIONS.find((o) => o.id === compare)?.label ?? "No comparison";
  // A period with no start or no end (all time, or an open-ended range) has nothing before it.
  const comparable = period.from != null && period.to != null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            data-testid="compare-trigger"
            aria-label={`Compare to: ${label}`}
          />
        }
      >
        <GitCompareArrowsIcon className="size-3.5" />
        {/* Icon-only on a phone, like the period picker beside it. */}
        <span className="hidden sm:inline">{label}</span>
        <ChevronDownIcon className="hidden size-3.5 sm:inline" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div role="group" aria-label="Compare to" className="flex flex-col gap-0.5">
          {COMPARE_OPTIONS.map((option) => {
            const active = compare === option.id;
            const baseline = baselineFor(period, option.id);
            return (
              <Button
                key={option.id}
                variant={active ? "secondary" : "ghost"}
                size="sm"
                className="h-auto flex-col items-start gap-0 py-1.5"
                aria-pressed={active}
                aria-label={option.label}
                disabled={option.id !== "none" && !comparable}
                onClick={() => {
                  pickCompare(option.id);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {baseline && (
                  <span
                    data-testid={`compare-hint-${option.id}`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    {baseline.caption}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
        {!comparable && (
          <p data-testid="compare-unavailable" className="text-xs text-muted-foreground">
            {period.preset === "all"
              ? "All time has nothing before it. Choose a period with a start and an end to compare."
              : "Choose a period with a start and an end to compare."}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
