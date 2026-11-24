// src/ui/setup/TaxStep.tsx -- step 3: what the federal tax estimate needs,
// filing status and number of children. Skippable: with no answer, every estimated tax figure
// shows a "set this up" card instead of a guess.
import { useEffect, useState, type JSX } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { FilingStatus } from "../../domain/tax";
import { getTaxProfileUI, setTaxProfileUI } from "../lib/db-setup";
import { saveThen, StepActions } from "./StepActions";
import type { SetupStepProps } from "./steps";

const STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "mfj", label: "Married filing jointly" },
  { value: "hoh", label: "Head of household" },
];

export default function TaxStep({ onDone, onSkip }: SetupStepProps): JSX.Element {
  const [status, setStatus] = useState<FilingStatus | null>(null);
  const [children, setChildren] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTaxProfileUI()
      .then((p) => {
        if (p.filingStatus) setStatus(p.filingStatus);
        if (p.children !== null) setChildren(String(p.children));
      })
      .catch(() => {});
  }, []);

  const save = () => {
    const n = Number(children.trim());
    if (!status) return setError("Choose how you file, or skip this step.");
    if (children.trim() === "" || !Number.isInteger(n) || n < 0 || n > 10) return setError("Type the number of children, from 0 to 10.");
    void saveThen(() => setTaxProfileUI({ filingStatus: status, children: n }), onDone, setBusy, setError);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        The app estimates federal income tax, Social Security and Medicare from these. It does not estimate state tax;
        type it from a pay stub in Settings, Salary to make take-home pay exact.
      </p>
      <Card size="sm">
        <CardContent className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">How do you file your taxes?</legend>
            <RadioGroup value={status ?? ""} onValueChange={(v) => setStatus(v as FilingStatus)}>
              {STATUSES.map((s) => (
                <label key={s.value} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={s.value} aria-label={s.label} />
                  <span aria-hidden="true">{s.label}</span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Number of children
            <Input inputMode="numeric" className="w-24" value={children} onChange={(e) => setChildren(e.target.value)} />
          </label>
        </CardContent>
      </Card>
      <StepActions onNext={save} onSkip={onSkip} busy={busy} error={error} />
    </div>
  );
}
