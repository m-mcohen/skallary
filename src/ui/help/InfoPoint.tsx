// src/ui/help/InfoPoint.tsx -- the small "i" beside a confusing number.
// It shows the SAME definition the help article
// uses, looked up by glossary id, so a term cannot mean two things in two
// places. Used sparingly on purpose: only on the handful of labels that are
// not self-explanatory (Drawable, Burn, Held back, Salary needed, Reaches the
// balance and the like). An unknown id renders nothing rather than a dead icon.
//
// A popover, not a tooltip: it opens on click or tap, so it works on a phone
// and stays open while it is read. @shadcn/popover, added for this.
import type { ReactNode } from "react";
import { InfoIcon } from "lucide-react";

import { findTerm } from "../../help/glossary";

import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

/** `children`: live figures shown under the definition, such as the steps from gross to take-home. */
export default function InfoPoint({ termId, children }: { termId: string; children?: ReactNode }) {
  const term = findTerm(termId);
  if (!term) return null;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            // "About Monthly budget", not "What is Monthly budget?", which read badly for a term like What-if.
            aria-label={`About ${term.term}`}
            // p-1 with -m-1: a larger tap target without moving the layout; at least 24 px.
            className="-m-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full p-1 align-middle text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          />
        }
      >
        <InfoIcon className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 normal-case tracking-normal">
        <PopoverHeader>
          <PopoverTitle>{term.term}</PopoverTitle>
        </PopoverHeader>
        <p className="text-sm font-normal text-muted-foreground">{term.definition}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}
