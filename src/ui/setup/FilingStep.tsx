// src/ui/setup/FilingStep.tsx -- step 8: how to start filing: (a) the
// standard categories with the starter rules, (b) the categories only, (c) the categories with
// the starter rules as a checklist. Skipping is (b), so the categories are always added.
import { useState, type JSX } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { StarterFiling } from "../../domain/setup-progress";
import { applyStarterFilingUI } from "../lib/db-setup";
import { StarterRulesChecklist } from "./StarterRulesChecklist";
import { saveThen, StepActions } from "./StepActions";
import type { SetupStepProps } from "./steps";

const CHOICES: { value: StarterFiling; label: string; detail: string }[] = [
  {
    value: "standard-rules",
    label: "Standard categories, with purchases at well-known stores filed for you",
    detail: "For example, a purchase at a national grocery chain goes under Groceries.",
  },
  { value: "categories-only", label: "Standard categories only", detail: "You file each purchase yourself." },
  { value: "checklist", label: "Standard categories, and I pick the stores", detail: "Tick the stores you use from a list." },
];

export default function FilingStep({ onDone, onSkip }: SetupStepProps): JSX.Element {
  const [choice, setChoice] = useState<StarterFiling>("standard-rules");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A skip is choice b: the categories only.
  const skip = () => void saveThen(() => applyStarterFilingUI("categories-only"), onSkip, setBusy, setError);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        How should the app start sorting your spending? Every choice adds the standard categories. You can rename, add or
        remove categories and rules later in Settings, Mappings.
      </p>
      <Card size="sm">
        <CardContent>
          <RadioGroup value={choice} onValueChange={(v) => setChoice(v as StarterFiling)}>
            {CHOICES.map((c) => (
              <label key={c.value} className="flex items-start gap-2 text-sm">
                <RadioGroupItem value={c.value} aria-label={c.label} className="mt-0.5" />
                <span aria-hidden="true" className="flex flex-col">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-muted-foreground">{c.detail}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>
      {choice === "checklist" && <StarterRulesChecklist onApplied={onDone} />}
      <StepActions
        nextLabel={choice === "checklist" ? "Next" : "Start filing this way"}
        // With the checklist, its own button saves; Next without it is a skip.
        onNext={choice === "checklist" ? skip : () => void saveThen(() => applyStarterFilingUI(choice), onDone, setBusy, setError)}
        onSkip={choice === "checklist" ? undefined : skip}
        busy={busy}
        error={error}
      />
    </div>
  );
}
