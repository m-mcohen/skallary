// src/ui/shell/SiteHeader.tsx
//
// The 56px bar: sidebar toggle, page title, and the three global controls.
//
// The scenario overlay lives HERE rather than inside a what-if screen, and
// that is the substantive change in this file. An overlay re-computes every
// figure on every screen -- the runway in the summary bar, the goals'
// affordability, the long-term projection -- so scoping it to one mode
// misrepresented what it does. Global state belongs in global chrome.
//
// The Sync button pulls the SimpleFIN feed, the only source of truth since
// the cutover. The Monarch "Sync" / "Full re-sync" menu that lived here was
// retired.
import { useState } from "react";
import { ChevronDownIcon, Loader2Icon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

import { syncSimpleFinUI, loadDb } from "../lib/db";
import { SAMPLE_NO_BANK_SHORT, useSampleInstance } from "../lib/useSampleInstance";
import { readBankProblems, type BankProblemsState } from "../lib/useBankProblems";
import { banksNeedYou } from "../../domain/bank-problems";
import BankProblemsDialog from "./BankProblemsDialog";
import type { Scenario } from "../../domain/scenario";
import type { NavItem, NavTab } from "./nav";
import HelpPanel from "../help/HelpPanel";
import PeriodPicker from "./PeriodPicker";
import ComparePicker from "./ComparePicker";
import { periodApplies } from "../lib/period-store";

type SyncButtonState =
  | { phase: "idle" }
  | { phase: "syncing" }
  | { phase: "success"; message: string }
  | { phase: "problems"; found: BankProblemsState }
  | { phase: "error"; message: string };

export interface SyncButtonProps {
  /** Reloads the page so every figure is the feed's latest. Injected by tests. */
  reload?: () => void;
  /** Reads the banks that need the user from the saved state, after the sync. Injected by tests. */
  readProblems?: () => Promise<BankProblemsState>;
}

// The one sync control. It pulls the SimpleFIN feed and reloads, so every
// figure on screen is the feed's latest. Setup's Sync button calls the same
// endpoint; this one is here so a refresh never needs a screen change. A
// failure stays on screen rather than reloading past it.
//
// After the sync, the saved state is read again. If a
// bank needs a sign-in, or has sent nothing new for more than 3 days, the button
// reads in red and a box lists each bank with what to do. The reload waits until
// the user closes the box, so it is never reloaded away before the user reads it. A dead
// access (needsReconnect) stays the hard error it was.
export function SyncButton({ reload = () => window.location.reload(), readProblems = readBankProblems }: SyncButtonProps = {}) {
  const [state, setState] = useState<SyncButtonState>({ phase: "idle" });
  // Sample data has no bank to sync with: the button rests, and says why.
  const sample = useSampleInstance();

  const runSync = async () => {
    setState({ phase: "syncing" });
    try {
      const db = await loadDb();
      const summary = await syncSimpleFinUI(db);
      if (summary.needsReconnect) throw new Error("SimpleFIN needs reconnecting. Open Settings, Bank connection.");
      // The sync itself worked; a failed read of the problems must not hide that, so it reloads as before.
      const found = await readProblems().catch(() => null);
      if (found && found.problems.length > 0) {
        setState({ phase: "problems", found });
        return;
      }
      setState({ phase: "success", message: `${summary.inserted} new, ${summary.updated} updated` });
      reload();
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const syncing = state.phase === "syncing";
  const problems = state.phase === "problems" ? state.found : null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={syncing || sample}
        title={sample ? SAMPLE_NO_BANK_SHORT : undefined}
        onClick={runSync}
        className={problems ? "border-destructive/40 text-destructive" : undefined}
      >
        {syncing ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : problems ? (
          <TriangleAlertIcon className="size-4" />
        ) : (
          <RefreshCwIcon className="size-4" />
        )}
        {/* Icon-only on a phone, like Help: with the period picker in the bar the
            word would push the screen title into "Repo...". Measured at
            360px. The name stays in the DOM for a screen reader. */}
        <span className="sr-only sm:not-sr-only">{syncing ? "Syncing…" : "Sync"}</span>
      </Button>
      {problems && (
        <span data-testid="sync-problems" className="hidden text-xs text-destructive sm:inline">
          Synced, {banksNeedYou(problems.problems.length)}
        </span>
      )}
      {sample && <span className="hidden text-xs text-muted-foreground sm:inline">Sample data, no bank</span>}
      {state.phase === "error" && (
        <span className="text-xs text-destructive">Sync failed: {state.message}</span>
      )}
      {problems && (
        <BankProblemsDialog open problems={problems.problems} today={problems.today} onClose={reload} />
      )}
    </div>
  );
}

export interface SiteHeaderProps {
  item: NavItem;
  tab: NavTab | null;
  /** null while the plan list is still resolving. */
  planName: string | null;
  scenarios: Scenario[];
  scenarioId: string | null;
  onPickScenario: (id: string | null) => void;
}

export default function SiteHeader({
  item,
  tab,
  planName,
  scenarios,
  scenarioId,
  onPickScenario,
}: SiteHeaderProps) {
  const active = scenarios.find((s) => s.id === scenarioId) ?? null;

  return (
    // Tighter on a phone: Reports carries two pickers there, and at 360px the
    // wider spacing cut the screen title to "Rep...".
    <header className="sticky top-0 z-50 flex h-14 w-full items-center gap-1 border-b bg-background px-2 sm:gap-2 sm:px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-auto" />

      {/* A real h1, not a breadcrumb. There is nothing to navigate UP to --
          the section is in the sidebar and the tab is in the strip below --
          so a crumb trail would be decoration. shadcn's BreadcrumbPage also
          renders role="link", which duplicated the sidebar's own current-page
          link for every screen. The app had no h1 at all before this. */}
      <h1 data-testid="page-title" className="truncate text-sm font-medium">
        {item.label}
        {tab && (
          <span className="font-normal text-muted-foreground"> · {tab.label}</span>
        )}
      </h1>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
        {/* Measured with device emulation, on Reports with both pickers
            showing: the last control ends at 382 of 390px and 352 of 360px, the page is
            exactly as wide as the screen, and the title shows in full (52px). */}
        {/* Only where it changes what is on screen: the screens that look back
            at what already happened. Forward-looking screens run off the plan. */}
        {periodApplies(item.id, tab?.id ?? null) && <PeriodPicker />}
        {/* Reports is the one screen that shows comparisons. */}
        {item.id === "reports" && <ComparePicker />}

        {/* Global, not per-mode: an overlay changes every figure everywhere. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="sm" data-testid="overlay-trigger" />}
          >
            {active ? active.name : "Real numbers"}
            <ChevronDownIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onPickScenario(null)}>Real numbers</DropdownMenuItem>
            {scenarios.map((s) => (
              <DropdownMenuItem key={s.id} onClick={() => onPickScenario(s.id)}>
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <SyncButton />

        {/* The plan name is a label, not a control, so it gives way on a phone to
            make room for Help. Measured with device emulation: before
            Help the last control ended at 378 of 390px; with Help added, this
            hidden and Help icon-only, it ends at 378 of 390 and 348 of 360, the
            page is exactly as wide as the screen, and the title keeps its room. */}
        {planName === null ? (
          <Skeleton className="hidden h-5 w-24 sm:block" />
        ) : (
          <Badge variant="outline" className="hidden sm:inline-flex">{planName}</Badge>
        )}

        {/* Help for the screen you are on. Last, so the three
            controls that change numbers keep their places. */}
        <HelpPanel sectionId={item.id} tabId={tab?.id ?? null} />
      </div>
    </header>
  );
}
