// src/ui/shell/PeriodPicker.tsx
//
// The period the history screens (Reports, Net worth, Transactions) look at.
// It sits in the top bar because one choice drives all three, and it names the
// period in words at all times so a figure is never ambiguous about its dates.
//
// @shadcn/calendar and @shadcn-studio/date-picker-02
// fit a custom range but bring in react-day-picker and date-fns. This uses the
// popover, button, input, and label already installed, with two date boxes for a
// custom range (the same boxes Transactions had). Everything a calendar would
// replace is inside this one file.
import { useState, type FormEvent } from "react";
import { CalendarIcon, ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

import {
  PERIOD_PRESETS,
  customPeriod,
  periodLabel,
  resolvePeriod,
  validDate,
} from "../../domain/period";
import { periodAsOf, pickPeriod, usePeriod } from "../lib/period-store";

export default function PeriodPicker() {
  const period = usePeriod();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // The boxes start on the period in view each time the panel opens, so a small
  // adjustment is a small edit rather than two dates typed from nothing.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setFrom(period.from ?? "");
      setTo(period.to ?? "");
    }
    setOpen(next);
  };

  const canApply = validDate(from) != null && validDate(to) != null;
  const applyCustom = (event: FormEvent) => {
    event.preventDefault();
    if (!canApply) return;
    pickPeriod(customPeriod(from, to));
    setOpen(false);
  };

  const label = periodLabel(period);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            data-testid="period-trigger"
            aria-label={`Period: ${label}`}
          />
        }
      >
        <CalendarIcon className="size-3.5" />
        {/* Icon-only on a phone: the top bar has no room to spare there. */}
        <span className="hidden sm:inline">{label}</span>
        <ChevronDownIcon className="hidden size-3.5 sm:inline" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div role="group" aria-label="Period" className="flex flex-col gap-0.5">
          {PERIOD_PRESETS.map((preset) => {
            const active = period.preset === preset.id;
            return (
              <Button
                key={preset.id}
                variant={active ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                aria-pressed={active}
                onClick={() => {
                  pickPeriod(resolvePeriod(preset.id, periodAsOf()));
                  setOpen(false);
                }}
              >
                {preset.label}
              </Button>
            );
          })}
        </div>
        <Separator />
        <form onSubmit={applyCustom} className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Or choose your own dates</p>
          <div className="grid grid-cols-[auto_1fr] items-center gap-2">
            <Label htmlFor="period-from">From</Label>
            <Input id="period-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Label htmlFor="period-to">To</Label>
            <Input id="period-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={!canApply}>
            Apply
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
