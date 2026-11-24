// src/ui/dashboard/MonthBar.tsx -- the Dashboard's month bar: previous and next arrows beside the month name, plus a
// This month button shown only on a past month. Next stops at this month (no
// future months); previous stops at the first month with transactions.
//
// The closest pieces were @shadcn-studio/pagination-02 (chevron
// previous and next) and @shadcn-studio/button-group-06 (a value between a
// decrement and an increment button). Neither was installed: this is the app's
// own outline Button in that shape. Icon buttons are size-8, a 32 px click area
// (the minimum is 24). No motion.
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import InfoPoint from "../help/InfoPoint";
import { formatMonthShort, formatPeriodLabel } from "../../domain/period";
import type { MonthNav } from "../../domain/dashboard-month";

export default function MonthBar({ nav, onChoose }: { nav: MonthNav; onChoose: (month: string) => void }) {
  return (
    <div role="group" aria-label="Month" className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label={nav.previous ? `Previous month: ${formatMonthShort(nav.previous)}` : "Previous month (none before the first month with transactions)"}
        disabled={!nav.previous}
        onClick={() => nav.previous && onChoose(nav.previous)}
      >
        <ChevronLeftIcon aria-hidden />
      </Button>
      <h2 data-testid="dash-month-name" aria-live="polite" className="min-w-36 text-center text-base font-medium">
        {formatPeriodLabel(nav.month)}
      </h2>
      <Button
        variant="outline"
        size="icon"
        aria-label={nav.next ? `Next month: ${formatMonthShort(nav.next)}` : "Next month (none after this month)"}
        disabled={!nav.next}
        onClick={() => nav.next && onChoose(nav.next)}
      >
        <ChevronRightIcon aria-hidden />
      </Button>
      {!nav.current && (
        <Button variant="outline" onClick={() => onChoose(nav.thisMonth)}>
          This month
        </Button>
      )}
      <InfoPoint termId="month-bar" />
    </div>
  );
}
