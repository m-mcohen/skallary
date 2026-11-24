// src/ui/setup/AccountsStep.tsx -- step 7: whose each account is, and its type (the existing
// Accounts controls from Settings, Accounts). Each change saves as it is made.
import type { JSX } from "react";
import AccountsSection from "../AccountsSection";
import { StepActions } from "./StepActions";
import type { SetupStepProps } from "./steps";

export default function AccountsStep({ onDone, onSkip }: SetupStepProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Say whose each account is and what kind it is. Each change saves as you make it. With no banks linked yet there is
        nothing here; come back from Settings, Accounts once they are.
      </p>
      <AccountsSection />
      <StepActions onNext={onDone} onSkip={onSkip} />
    </div>
  );
}
