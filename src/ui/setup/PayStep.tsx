// src/ui/setup/PayStep.tsx -- step 2: how you are paid. The existing pay schedule and paycheck
// figures editor (Settings, Salary), saved by its own button; Next moves on.
import type { JSX } from "react";
import CurrentSalaryCard from "../CurrentSalaryCard";
import { StepActions } from "./StepActions";
import type { SetupStepProps } from "./steps";

export default function PayStep({ onDone, onSkip }: SetupStepProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Type your salary and how often you are paid, then save. The figures from a pay stub make take-home pay exact.
        You can change all of this later in Settings, Salary.
      </p>
      <CurrentSalaryCard />
      <StepActions onNext={onDone} onSkip={onSkip} />
    </div>
  );
}
