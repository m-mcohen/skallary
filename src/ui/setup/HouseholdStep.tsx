// src/ui/setup/HouseholdStep.tsx -- step 1, the one required step: who is in
// the household. The same form is the top of Settings, Household.
import type { JSX } from "react";
import { HouseholdForm } from "../HouseholdSettings";
import type { SetupStepProps } from "./steps";

export default function HouseholdStep({ onDone }: SetupStepProps): JSX.Element {
  return <HouseholdForm saveLabel="Next" onSaved={onDone} />;
}
