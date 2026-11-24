// src/ui/setup/StepActions.tsx -- the buttons at the foot of every interview step: the step's
// own action (Next, or a save that moves on) and, on every step but the household, Skip.
// The app's own Button only.
import type { JSX } from "react";
import { Button } from "@/components/ui/button";

export function StepActions({ onNext, onSkip, nextLabel = "Next", busy = false, error }: {
  onNext: () => void;
  onSkip?: () => void;
  nextLabel?: string;
  busy?: boolean;
  error?: string | null;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={onNext}>{nextLabel}</Button>
        {onSkip && (
          <Button variant="ghost" disabled={busy} onClick={onSkip}>
            Skip for now
          </Button>
        )}
      </div>
    </div>
  );
}

/** Runs a save, then moves on; a failure stays on the step with its message. */
export async function saveThen(
  save: () => Promise<unknown>,
  then: () => void,
  setBusy: (b: boolean) => void,
  setError: (e: string | null) => void,
): Promise<void> {
  setBusy(true);
  setError(null);
  try {
    await save();
    setBusy(false);
    then();
  } catch (e) {
    setError(e instanceof Error ? e.message : "That could not be saved.");
    setBusy(false);
  }
}
