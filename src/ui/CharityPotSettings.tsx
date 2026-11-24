// src/ui/CharityPotSettings.tsx -- Settings, Salary: the optional charity pot. Its switch, its
// name, what it is (a share of pay into the bank, or a set amount a month or a year), whose
// accounts count toward it, the floor kept in its account, and a link to pick that account.
// Off, every pot line, panel, column and help entry is absent across the app.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { formatCents, parseDollarsToCents, percentInputValue } from "../domain/money";
import { localDateIso } from "../domain/period";
import type { CharityPotSetting, PotKind, StoredCharityPot } from "../domain/charity-pot";
import type { Household, OwnerSlot } from "../domain/household";
import { getMaaserFloorUI, loadDb, setMaaserFloorUI, type Db } from "./lib/db";
import { getCharityPotUI, getHouseholdUI, setCharityPotUI } from "./lib/db-setup";

export interface CharityPotDataLayer {
  loadDb: () => Promise<Db>;
  getPot: () => Promise<CharityPotSetting | null>;
  /** A `rateBps` saves the rate too; left out, the saved rate stays. */
  setPot: (pot: StoredCharityPot & { rateBps?: number | null }) => Promise<void>;
  getFloor: (db: Db) => Promise<number>;
  setFloor: (db: Db, floorCents: number) => Promise<void>;
  getHousehold: () => Promise<Household | null>;
}

const defaults: CharityPotDataLayer = {
  loadDb,
  getPot: getCharityPotUI,
  setPot: setCharityPotUI,
  getFloor: getMaaserFloorUI,
  setFloor: setMaaserFloorUI,
  getHousehold: getHouseholdUI,
};

const KINDS: { value: PotKind; label: string }[] = [
  { value: "percent", label: "A share of the pay that lands in the bank" },
  { value: "monthly", label: "A set amount each month" },
  { value: "yearly", label: "A set amount each year" },
];

const thisMonth = () => localDateIso().slice(0, 7);
const centsText = (c: number | null) => (c === null ? "" : formatCents(c).replace("$", ""));

export default function CharityPotSettings({ dataLayer, onChanged }: { dataLayer?: Partial<CharityPotDataLayer>; onChanged?: () => void }) {
  const deps = { ...defaults, ...dataLayer };
  const [stored, setStored] = useState<CharityPotSetting | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [on, setOn] = useState(false);
  const [name, setName] = useState("Charity");
  const [kind, setKind] = useState<PotKind>("percent");
  const [percent, setPercent] = useState("");
  const [amount, setAmount] = useState("");
  const [counts, setCounts] = useState<Record<OwnerSlot, boolean>>({ me: true, partner: true, joint: true });
  const [floor, setFloor] = useState("0.00");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await deps.loadDb();
        const [pot, floorCents, h] = await Promise.all([deps.getPot(), deps.getFloor(db).catch(() => 0), deps.getHousehold().catch(() => null)]);
        if (cancelled) return;
        setStored(pot);
        setHousehold(h);
        setFloor(centsText(floorCents));
        if (pot) {
          setOn(pot.on);
          setName(pot.name);
          setKind(pot.kind);
          setPercent(pot.rateBps === null ? "" : percentInputValue(pot.rateBps / 10000));
          setAmount(centsText(pot.fixedCents));
          setCounts(pot.counts);
        }
      } catch {
        // The card starts empty; Save still works.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasPartner = !!household?.partnerName;
  const whose: { slot: OwnerSlot; label: string }[] = [
    { slot: "me", label: "Your own accounts" },
    ...(hasPartner ? [{ slot: "partner" as const, label: `${household!.partnerName}'s own accounts` }] : []),
    { slot: "joint", label: "Shared accounts" },
  ];

  async function save() {
    setStatus("");
    const trimmed = name.trim();
    if (trimmed === "") return setStatus("Give the pot a name.");
    let rateBps: number | null = null;
    if (kind === "percent" && percent.trim() !== "") {
      const p = percent.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(p) || Number(p) > 100) return setStatus("Type the share as a percent from 0 to 100, like 5 or 2.5.");
      rateBps = Math.round(Number(p) * 100);
    }
    let fixedCents: number | null = null;
    if (kind !== "percent") {
      try {
        fixedCents = parseDollarsToCents(amount);
      } catch {
        return setStatus("Type the set amount in dollars and cents, like 100 or 100.00.");
      }
      if (fixedCents < 0) return setStatus("The set amount is zero or more.");
    }
    let floorCents: number;
    try {
      floorCents = floor.trim() === "" ? 0 : parseDollarsToCents(floor);
    } catch {
      return setStatus("Type the floor in dollars and cents, like 500 or 500.00.");
    }
    if (floorCents < 0) return setStatus("The floor is zero or more.");
    // A set amount counts from the month it is first switched on (or changed to), never before.
    const keepFrom = stored && stored.kind === kind && stored.on && stored.fixedFrom !== null;
    const pot: StoredCharityPot & { rateBps?: number | null } = {
      on,
      name: trimmed,
      kind,
      fixedCents,
      fixedFrom: kind === "percent" ? null : keepFrom ? stored!.fixedFrom : thisMonth(),
      counts: hasPartner ? counts : { ...counts, partner: false },
      // Sent only for a percent pot; a set amount leaves any saved rate as it is.
      ...(kind === "percent" ? { rateBps } : {}),
    };
    try {
      const db = await deps.loadDb();
      await deps.setPot(pot);
      await deps.setFloor(db, floorCents);
      setStored({ ...pot, rateBps: pot.rateBps !== undefined ? pot.rateBps : stored?.rateBps ?? null });
      setStatus("Saved.");
      onChanged?.();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Charity</CardTitle>
        <CardDescription>
          Money you set aside for charity. While it is on, the Charity budget line is raised to it, the top bar shows what to put away, and the Charity line's panel keeps its ledger.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={on} onCheckedChange={(c: boolean) => setOn(c)} aria-label="Keep a charity pot" />
          <span aria-hidden="true">Keep a charity pot</span>
        </label>
        {on && (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              The pot's name, as the app shows it
              <Input aria-label="The pot's name" className="w-64" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">What the pot is</legend>
              <RadioGroup value={kind} onValueChange={(v) => setKind(v as PotKind)}>
                {KINDS.map((k) => (
                  <label key={k.value} className="flex items-start gap-2 text-sm">
                    <RadioGroupItem value={k.value} aria-label={k.label} />
                    <span aria-hidden="true">{k.label}</span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
            {kind === "percent" ? (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Percent of pay into the bank (after tax and benefits)
                <Input aria-label="Percent of pay into the bank" inputMode="decimal" className="w-32 font-mono" value={percent} onChange={(e) => setPercent(e.target.value)} />
                {percent.trim() === "" && <span>Type the percent to see the pot's figures.</span>}
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {kind === "monthly" ? "Amount each month" : "Amount each year"}
                <Input aria-label={kind === "monthly" ? "Amount each month" : "Amount each year"} inputMode="decimal" className="w-40 font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Whose accounts count toward the pot</legend>
              {whose.map((w) => (
                <label key={w.slot} className="flex items-center gap-2 text-sm">
                  <Checkbox aria-label={w.label} checked={counts[w.slot]} onCheckedChange={(c: boolean) => setCounts((prev) => ({ ...prev, [w.slot]: c }))} />
                  <span aria-hidden="true">{w.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Floor kept in the pot's account
              <Input aria-label="Floor kept in the pot's account" inputMode="decimal" className="w-40 font-mono" value={floor} onChange={(e) => setFloor(e.target.value)} />
            </label>
            <p className="text-xs text-muted-foreground">
              Pick the account you set the pot aside in under{" "}
              <a className="underline underline-offset-4" href="#/settings/accounts">
                Settings, Accounts
              </a>
              . Without one, the ledger shows what the pot owes against what you gave.
            </p>
          </>
        )}
        <div className="flex items-center gap-3">
          <Button onClick={save}>Save</Button>
          <span role="status" className="text-xs text-muted-foreground">
            {status}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
