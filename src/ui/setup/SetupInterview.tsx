// src/ui/setup/SetupInterview.tsx -- the first-run interview.
// One step at a time down the left-hand list; only the household is required, every other step
// has Skip. Each answer is saved as it is given, so a reload picks up where it stopped. The end
// makes this year's budget and opens Set up budget on it.
//
// @shadcn has
// none; @shadcn-studio stepper-09 (a vertical list of numbered steps beside the step's panel) is
// the pattern used here. It needs a new package (@stepperize/react) and makes every step a
// freely clickable tab, so the list is drawn with the app's own tokens and Button instead.
import { useEffect, useState, type JSX } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { resumeStep, type SetupProgress, type SetupStepId } from "../../domain/setup-progress";
import { finishSetupUI, getSetupProgressUI, setSetupStepUI } from "../lib/db-setup";
import { navigate } from "../shell/router";
import { registeredSteps, SETUP_REGISTRY } from "./steps";

type Where = SetupStepId | "finish";

export default function SetupInterview({ startAt, onFinished }: { startAt?: SetupStepId; onFinished?: () => void }): JSX.Element {
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [where, setWhere] = useState<Where | null>(null);
  // Opened from a "Set this up" link after the interview ended: one step, then back to the app.
  const [revisit, setRevisit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSetupProgressUI()
      .catch(() => ({}) as SetupProgress)
      .then((p) => {
        if (cancelled) return;
        setProgress(p);
        setRevisit(Boolean(p.finishedAt) && startAt !== undefined);
        setWhere(startAt ?? resumeStep(p, registeredSteps()) ?? "finish");
      });
    return () => {
      cancelled = true;
    };
  }, [startAt]);

  const backToApp = () => {
    navigate({ section: "settings", tab: "household" });
    onFinished?.();
  };

  const answer = async (id: SetupStepId, state: "done" | "skipped") => {
    setError(null);
    try {
      setProgress(await setSetupStepUI(id, state));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That step could not be saved.");
      return;
    }
    if (revisit) return backToApp();
    const ids = registeredSteps();
    setWhere(ids[ids.indexOf(id) + 1] ?? "finish");
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await finishSetupUI();
      // Budget, Set up budget, on the budget just made.
      window.location.hash = "#/budget/month?setup=1";
      onFinished?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The budget could not be made.");
      setBusy(false);
    }
  };

  if (!progress || !where) return <div className="min-h-svh bg-background" />;
  const householdDone = progress.household === "done";
  const step = where === "finish" ? null : SETUP_REGISTRY.find((s) => s.id === where) ?? null;
  const skipped = SETUP_REGISTRY.filter((s) => progress[s.id] === "skipped");

  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 md:flex-row md:gap-section md:px-section">
        <aside className="flex flex-col gap-4 md:w-60 md:shrink-0">
          <div>
            <h1 className="text-xl font-semibold">Set up your household</h1>
            <p className="text-sm text-muted-foreground">Only your name is needed now. You can come back to any step later.</p>
          </div>
          <ol aria-label="Set-up steps" className="flex flex-col gap-1">
            {SETUP_REGISTRY.map((s, i) => {
              const state = progress[s.id];
              const current = s.id === where;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={current ? "step" : undefined}
                    disabled={!householdDone || revisit}
                    onClick={() => setWhere(s.id)}
                    className={
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-default " +
                      (current ? "bg-muted font-medium text-foreground" : "text-muted-foreground enabled:hover:text-foreground")
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={
                        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs " +
                        (state === "done" ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary" : "border-border")
                      }
                    >
                      {state === "done" ? <CheckIcon className="size-3.5" /> : i + 1}
                    </span>
                    <span className="flex-1">{s.title}</span>
                    {state === "skipped" && <span className="text-xs text-muted-foreground">Skipped</span>}
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                aria-current={where === "finish" ? "step" : undefined}
                disabled={!householdDone || revisit}
                onClick={() => setWhere("finish")}
                className={
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-default " +
                  (where === "finish" ? "bg-muted font-medium text-foreground" : "text-muted-foreground enabled:hover:text-foreground")
                }
              >
                <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs">
                  {SETUP_REGISTRY.length + 1}
                </span>
                <span className="flex-1">Your first budget</span>
              </button>
            </li>
          </ol>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-4">
          {step ? (
            <>
              <h2 className="text-lg font-semibold">{step.title}</h2>
              <step.Component
                key={step.id}
                onDone={() => void answer(step.id, "done")}
                onSkip={() => (step.required ? undefined : void answer(step.id, "skipped"))}
              />
              {revisit && (
                <div>
                  <Button variant="ghost" onClick={backToApp}>Back to the app</Button>
                </div>
              )}
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Your first budget</h2>
              <Card size="sm">
                <CardContent className="flex flex-col gap-3 text-sm">
                  <p>
                    Next the app makes this year's budget and opens Set up budget, where you type an amount for each
                    category. Any history your banks sent is used to suggest amounts.
                  </p>
                  {skipped.length > 0 && (
                    <p className="text-muted-foreground">
                      You skipped: {skipped.map((s) => s.title.toLowerCase()).join(", ")}. Settings, Household lists them, and
                      any screen that needs one says so.
                    </p>
                  )}
                </CardContent>
              </Card>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <div>
                <Button disabled={busy} onClick={() => void finish()}>Make this year's budget</Button>
              </div>
            </>
          )}
          {step && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </main>
      </div>
    </div>
  );
}
