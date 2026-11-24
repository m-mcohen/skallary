// src/ui/setup/CharityStep.tsx -- step 4: "Do you set money aside for charity?". The charity settings card from Settings, Salary: off unless switched on, then a name
// the person picks and a percent of pay, a set monthly amount or a set yearly amount.
import type { JSX } from "react";
import CharityPotSettings from "../CharityPotSettings";
import { StepActions } from "./StepActions";
import type { SetupStepProps } from "./steps";

export default function CharityStep({ onDone, onSkip }: SetupStepProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Do you set money aside for charity? If you do, switch it on, name it, say how much, and save. If not, leave it off
        and press Next. You can change this later in Settings, Salary.
      </p>
      <CharityPotSettings />
      <StepActions onNext={onDone} onSkip={onSkip} />
    </div>
  );
}
