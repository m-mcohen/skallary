// src/ui/setup/BanksStep.tsx -- step 6: link your banks through SimpleFIN. The setup token stays in a text file on this computer, never typed into a page, so
// the step opens the folder and says what to save there; the bank connection screen does the rest.
import { useState, type JSX } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ConnectorSection from "../ConnectorSection";
import { openTokenFolderUI } from "../lib/db-setup";
import { StepActions } from "./StepActions";
import type { SetupStepProps } from "./steps";

export default function BanksStep({ onDone, onSkip }: SetupStepProps): JSX.Element {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setMessage(null);
    setError(null);
    try {
      await openTokenFolderUI();
      setMessage("The folder is open in a new window.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The folder could not be opened.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card size="sm">
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>The app reads your banks through SimpleFIN Bridge, which costs about $15 a year, paid to SimpleFIN.</p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Sign up at SimpleFIN Bridge and link your banks there.</li>
            <li>Make a setup token there and copy it.</li>
            <li>
              Open the app's folder, make a text file named{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">simplefin-token.txt</code>, paste the token in, and save
              it. The token unlocks every linked bank, so it stays on this computer and is never typed into a page.
            </li>
            <li>Press Connect below.</li>
          </ol>
          <div>
            <Button size="sm" variant="outline" onClick={() => void open()}>
              Open the folder
            </Button>
          </div>
          {message && <p role="status" className="text-muted-foreground">{message}</p>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </CardContent>
      </Card>
      <ConnectorSection />
      <StepActions onNext={onDone} onSkip={onSkip} />
    </div>
  );
}
