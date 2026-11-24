// src/ui/HouseholdSettings.tsx -- Settings, Household: the household's names,
// editable, and the "Still to set up" list, each item a link back into the interview at its step.
// The names form is also the interview's first step. The app's own Card, Input, Checkbox and
// Button only.
import { useEffect, useState, type JSX } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { stillToSetUp, type SetupProgress } from "../domain/setup-progress";
import { getHouseholdUI, getIncludePartnerUI, getSetupProgressUI, setHouseholdUI, setIncludePartnerUI } from "./lib/db-setup";
import { SETUP_REGISTRY } from "./setup/steps";

/** Your name and a partner's name (blank for none); with a partner, whether their own accounts count. */
export function HouseholdForm({ saveLabel = "Save", onSaved }: { saveLabel?: string; onSaved?: () => void }): JSX.Element {
  const [you, setYou] = useState("");
  const [partner, setPartner] = useState("");
  const [includePartner, setIncludePartner] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHouseholdUI()
      .then((h) => {
        if (cancelled || !h) return;
        setYou(h.youName);
        setPartner(h.partnerName ?? "");
      })
      .catch(() => {});
    getIncludePartnerUI()
      .then((on) => {
        if (!cancelled) setIncludePartner(on);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (you.trim() === "") {
      setError("Type your name.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const partnerName = partner.trim() === "" ? null : partner.trim();
      await setHouseholdUI({ youName: you.trim(), partnerName });
      // Written every time, so the setting is never left to its default.
      await setIncludePartnerUI(partnerName === null ? true : includePartner);
      setSaved(true);
      setBusy(false);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The names could not be saved.");
      setBusy(false);
    }
  };

  const partnerName = partner.trim();
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Your name
          <Input className="max-w-xs" autoComplete="given-name" value={you} onChange={(e) => setYou(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Your partner's name
          <Input className="max-w-xs" value={partner} onChange={(e) => setPartner(e.target.value)} />
          <span className="text-xs font-normal text-muted-foreground">Leave this blank if it is just you.</span>
        </label>
        {partnerName !== "" && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includePartner} onCheckedChange={(c: boolean) => setIncludePartner(c)} />
            Count {partnerName}'s own accounts in the household's money
          </label>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {saved && !onSaved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
        <div>
          <Button disabled={busy} onClick={() => void save()}>{saveLabel}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HouseholdSettings(): JSX.Element {
  const [progress, setProgress] = useState<SetupProgress | null>(null);

  useEffect(() => {
    getSetupProgressUI().then(setProgress).catch(() => setProgress(null));
  }, []);

  const registered = new Set(SETUP_REGISTRY.map((s) => s.id));
  const left = progress ? stillToSetUp(progress).filter((id) => registered.has(id)) : [];
  return (
    <div className="flex flex-col gap-4">
      <HouseholdForm />
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-base">Still to set up</CardTitle>
          <CardDescription>Steps you skipped or have not reached. Each opens where you left off.</CardDescription>
        </CardHeader>
        <CardContent>
          {progress === null ? null : left.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everything is set up.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {left.map((id) => {
                const step = SETUP_REGISTRY.find((s) => s.id === id)!;
                return (
                  <li key={id} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="flex-1">{step.title}</span>
                    <a className={buttonVariants({ size: "sm", variant: "outline" })} href={`#/setup/${id}`}>
                      Set this up
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
