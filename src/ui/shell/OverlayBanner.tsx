// src/ui/shell/OverlayBanner.tsx
//
// While a what-if is on, every screen says so, just under the top bar, and
// offers the one way back. The top-bar menu is the
// only control that turns a what-if on; this is its "off" switch in view.
//
// Composed from the app's installed Alert with the soft primary treatment of
// @shadcn-studio/alert-21 and the action slot of alert-04.
// Theme tokens only, no motion.
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface OverlayBannerProps {
  /** The what-if that is on, or null for Real numbers (no banner). */
  name: string | null;
  /** The goals could not be read, so this what-if's goal costs are not in the figures. */
  goalCostsMissing?: boolean;
  /** False on a screen whose figures ignore the what-if. */
  usesWhatIf?: boolean;
  onTurnOff: () => void;
}

export default function OverlayBanner({ name, goalCostsMissing = false, usesWhatIf = true, onTurnOff }: OverlayBannerProps) {
  if (!name) return null;
  return (
    <Alert role="status" className="border-none bg-primary/10 text-foreground">
      <AlertTitle className="font-normal">
        What-if on: <span className="font-medium">{name}</span>. {usesWhatIf ? "Numbers include it." : "This screen does not use the what-if."}
        {goalCostsMissing && <span className="block text-muted-foreground">Goals could not be read, so their rows are left out of these figures.</span>}
      </AlertTitle>
      <AlertAction className="top-1/2 -translate-y-1/2">
        <Button variant="link" size="sm" onClick={onTurnOff}>
          Turn off
        </Button>
      </AlertAction>
    </Alert>
  );
}
