// src/ui/setup/steps.ts -- the first-run interview's steps. One entry per step, in SETUP_STEPS order. Only the household is required.
// The holidays step sits after charity.
import type { ComponentType } from "react";
import type { SetupStepId } from "../../domain/setup-progress";
import HouseholdStep from "./HouseholdStep";
import PayStep from "./PayStep";
import TaxStep from "./TaxStep";
import CharityStep from "./CharityStep";
import BanksStep from "./BanksStep";
import AccountsStep from "./AccountsStep";
import FilingStep from "./FilingStep";
import HolidaysStep from "../holidays/HolidaysStep";

export interface SetupStepProps {
  onDone(): void;
  onSkip(): void;
}

export interface SetupStep {
  id: SetupStepId;
  title: string;
  required: boolean;
  Component: ComponentType<SetupStepProps>;
}

export const SETUP_REGISTRY: SetupStep[] = [
  { id: "household", title: "Who is in your household", required: true, Component: HouseholdStep },
  { id: "pay", title: "How you are paid", required: false, Component: PayStep },
  { id: "tax", title: "Your tax estimate", required: false, Component: TaxStep },
  { id: "charity", title: "Charity", required: false, Component: CharityStep },
  { id: "holidays", title: "Holidays", required: false, Component: HolidaysStep },
  { id: "banks", title: "Link your banks", required: false, Component: BanksStep },
  { id: "accounts", title: "Your accounts", required: false, Component: AccountsStep },
  { id: "filing", title: "How to start filing", required: false, Component: FilingStep },
];

/** The registered steps' ids, in interview order. */
export const registeredSteps = (): SetupStepId[] => SETUP_REGISTRY.map((s) => s.id);
