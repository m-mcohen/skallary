// src/ui/shell/BankProblemsBanner.tsx
//
// Red, under the top bar, on every screen, whenever a bank needs the user:
// each bank in a few words, the
// SimpleFIN Bridge one click away, and Settings, Bank connection for the detail.
// It stays until a sync comes back clean. The x hides it until the next sync:
// the dismissal is remembered against the last sync's time for this browser
// session, so a new sync that still has problems shows it again.
//
// Composed from the app's installed Alert (destructive) with the dismissible
// strip pattern of @shadcnblocks/banner7. Theme
// tokens only, no motion.
import { useState } from "react";
import { XIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { BRIDGE_URL, bankProblemShort, banksNeedYou, type BankProblem } from "../../domain/bank-problems";

const DISMISSED_KEY = "bank-problems-dismissed-for-sync";

function syncKey(lastSyncedAt: string | null): string {
  return lastSyncedAt ?? "never";
}

/** Storage can be refused (private window, blocked site data): then the x only lasts until the page reloads. */
function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(value: string): void {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, value);
  } catch {
    // Kept in memory for this page instead.
  }
}

export interface BankProblemsBannerProps {
  problems: BankProblem[];
  lastSyncedAt: string | null;
  today: string;
  /**
   * A sync is running: the problems were worked out from data it is
   * about to replace, so a quiet line says so instead of a red count.
   */
  syncing?: boolean;
  /** The sync finished after the user had used the page: offer a refresh instead of reloading under the user. */
  refreshReady?: boolean;
  onRefresh?: () => void;
}

export default function BankProblemsBanner({
  problems,
  lastSyncedAt,
  today,
  syncing = false,
  refreshReady = false,
  onRefresh = () => window.location.reload(),
}: BankProblemsBannerProps) {
  const [hiddenFor, setHiddenFor] = useState<string | null>(() => readDismissed());
  if (refreshReady) {
    return (
      <p data-testid="bank-sync-done" role="status" className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
        Your banks are synced. Refresh to see the new figures; save anything you are working on first.
        <Button variant="outline" size="sm" onClick={onRefresh}>Refresh</Button>
      </p>
    );
  }
  if (syncing) {
    return (
      <p data-testid="bank-sync-running" role="status" className="text-sm text-muted-foreground">
        Syncing with your banks. This page refreshes when it is done, unless you have started working on it.
      </p>
    );
  }
  if (problems.length === 0 || hiddenFor === syncKey(lastSyncedAt)) return null;

  const hide = () => {
    const key = syncKey(lastSyncedAt);
    writeDismissed(key);
    setHiddenFor(key);
  };

  return (
    <Alert
      variant="destructive"
      data-testid="bank-problems-banner"
      className="border-destructive/40 bg-destructive/5 text-destructive"
    >
      <AlertTitle>{banksNeedYou(problems.length)}</AlertTitle>
      <AlertDescription className="text-destructive">
        <ul className="flex flex-col gap-0.5">
          {problems.map((p) => (
            <li key={`${p.kind}:${p.bank}`}>{bankProblemShort(p, today)}.</li>
          ))}
        </ul>
        <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          <a href={BRIDGE_URL} target="_blank" rel="noreferrer">Open SimpleFIN Bridge</a>
          <a href="#/settings/connection">Settings, Bank connection</a>
        </p>
      </AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon-sm" aria-label="Hide until the next sync" onClick={hide}>
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  );
}
