// src/ui/CurrentSalaryCard.tsx
//
// Settings > Salary: the user's current salary and an optional additional salary.
//
// The user's salary is a yearly base salary with a start month, turned into take-home the
// way the ladder does it, or the monthly amount that hits the bank, typed as it is
// .
// The additional salary is a W-2 salary (one return when filing jointly, else its own single return), or a monthly amount
// with no tax math. The Forecast screen counts both from their months; Salary needed
// becomes the user's salary given the additional one.
//
// Registries-first: `npx shadcn@latest search @shadcn @shadcn-studio @shadcnblocks`
// for "settings form" and "radio group" offered profile and settings
// page blocks and radio-group variants, none closer than what the app already has.
// So the choice of kind uses the installed ToggleGroup (the Budget's old seed-window
// pattern), and the boxes are the installed Input inside the same Card as the
// assumptions card beside it.
//
// Firm tax figures: with a
// yearly base salary, two more boxes take the user's firm yearly federal income tax and Social
// Security and Medicare. They apply to this salary only; Salary needed and any other
// salary the app tries keep estimating. A blank box is estimated. The installed Input, as the boxes beside them.
//
// Paycheck figures: the yearly
// tax boxes became three boxes typed PER PAYCHECK, as read off the pay stub: Federal income
// tax and Social Security and Medicare (with a yearly base salary only, as before) and the
// Health premium (always; it moved here from Salary assumptions, since all three come off
// the same paycheck). How often the user is paid is chosen once above them; the boxes wait for it.
// Under each box: what it comes to a month and a year (src/domain/paycheck.ts). An older
// premium typed a month, or an older tax figure typed a year, is said plainly under its box
// and stays in force until the paycheck figure is typed. Segmented controls and inputs with helper
// text; the installed ToggleGroup and Input with a line under each box do the same.
//
// Benefits: the Health premium box became a list, one row
// per benefit the user pays for (src/ui/BenefitsEditor.tsx). With no list saved, the figure in
// force (an older monthly premium, or a paycheck premium) shows as one row named Benefits,
// and nothing is saved until the user edits a row: the figures stay exactly as they were. Once
// saved, the list is the premium everywhere.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getSalarySettingsUI, loadDb, setIncomeSettingsUI, type Db } from "./lib/db";
import { DEFAULT_SALARY_ASSUMPTIONS, hasFirmTaxes, type SalaryAssumptions } from "../domain/salary";
import { taxSetUpNeeded } from "../domain/tax";
import { SetUpCard } from "./setup/SetUpCard";
import { incomeProblem, type AdditionalSalary, type CurrentSalary, type IncomeSettings } from "../domain/income";
import { PAY_SCHEDULES, olderFigures, paycheckProblem, paycheckToMonthAndYear, salaryFigures, type PaySchedule, type PaycheckFigures } from "../domain/paycheck";
import { monthIncome } from "../domain/cash-forecast";
import { potIsOn, potLabel } from "../domain/charity-pot";
import { formatCents, parseDollarsToCents, parseLooseDollarsToCents } from "../domain/money";
import { benefitsProblem, type Benefit } from "../domain/benefits";
import BenefitsEditor, { draftTotals, type BenefitDraft } from "./BenefitsEditor";

export interface CurrentSalaryDataLayer {
  loadDb: () => Promise<Db>;
  getSalarySettings: (db: Db) => Promise<SalaryAssumptions>;
  setIncome: (db: Db, income: IncomeSettings) => Promise<void>;
}
const defaults: CurrentSalaryDataLayer = { loadDb, getSalarySettings: getSalarySettingsUI, setIncome: setIncomeSettingsUI };

type HisKind = "none" | "gross" | "take-home";
type OtherKind = "none" | "w2" | "monthly";

/** "120,000" for a yearly salary; "9,000.00" for a monthly amount. */
const yearlyText = (cents: number) => Math.round(cents / 100).toLocaleString("en-US");
const monthlyText = (cents: number) => formatCents(cents).replace("$", "");

const LABEL = "flex flex-col gap-1 text-xs text-muted-foreground";

export default function CurrentSalaryCard({ dataLayer, onChanged }: { dataLayer?: Partial<CurrentSalaryDataLayer>; onChanged?: () => void }) {
  const deps = { ...defaults, ...dataLayer };
  const [assumptions, setAssumptions] = useState<SalaryAssumptions>(DEFAULT_SALARY_ASSUMPTIONS);
  const [hisKind, setHisKind] = useState<HisKind>("none");
  const [hisAmount, setHisAmount] = useState("");
  const [hisFrom, setHisFrom] = useState("");
  const [otherKind, setOtherKind] = useState<OtherKind>("none");
  const [otherAmount, setOtherAmount] = useState("");
  const [otherFrom, setOtherFrom] = useState("");
  const [schedule, setSchedule] = useState<PaySchedule | null>(null);
  const [payFederal, setPayFederal] = useState("");
  const [payPayroll, setPayPayroll] = useState("");
  const [payOther, setPayOther] = useState("");
  const [benefitRows, setBenefitRows] = useState<BenefitDraft[]>([]);
  // A list is sent with Save salary once one is saved or the user edits a row.
  const [hasList, setHasList] = useState(false);
  const [benefitsTouched, setBenefitsTouched] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const a = await deps.getSalarySettings(await deps.loadDb());
        if (cancelled) return;
        setAssumptions(a);
        const c = a.currentSalary ?? null;
        if (c) {
          setHisKind(c.kind);
          setHisAmount(c.kind === "gross" ? yearlyText(c.grossAnnualCents) : monthlyText(c.monthlyCents));
          setHisFrom(c.fromPeriod);
        }
        // The paycheck figures as typed; an older monthly or yearly figure is said under its box instead.
        setSchedule(a.paySchedule ?? null);
        const p = a.paySchedule ? a.paycheck ?? null : null;
        if (p?.federalCents != null) setPayFederal(monthlyText(p.federalCents));
        if (p?.payrollCents != null) setPayPayroll(monthlyText(p.payrollCents));
        if (p?.otherTaxesCents != null) setPayOther(monthlyText(p.otherTaxesCents));
        // The user's benefits as listed; else the figure in force, as one row, unsaved until edited.
        if (a.benefits) {
          setHasList(true);
          setBenefitRows(a.benefits.map((b, i) => ({ key: i + 1, name: b.name, amount: monthlyText(b.amountCents), every: b.every, beforeTax: b.beforeTax })));
        } else if (p?.premiumCents != null) {
          setBenefitRows([{ key: 1, name: "Benefits", amount: monthlyText(p.premiumCents), every: "paycheck", beforeTax: true }]);
        } else if (a.premiumFromSettings !== false) {
          setBenefitRows([{ key: 1, name: "Benefits", amount: monthlyText(a.premiumMonthlyCents), every: "month", beforeTax: true }]);
        }
        const o = a.additionalSalary ?? null;
        if (o) {
          setOtherKind(o.kind);
          setOtherAmount(o.kind === "w2" ? yearlyText(o.grossAnnualCents) : monthlyText(o.monthlyCents));
          setOtherFrom(o.fromPeriod);
        }
      } catch {
        /* nothing saved yet, or not connected: the boxes stay empty */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** What the boxes say, as the two salaries; amounts read loosely while typing. */
  const draft = (strict: boolean): IncomeSettings | string => {
    const read = (text: string): number => {
      if (!strict) return parseLooseDollarsToCents(text);
      try {
        return parseDollarsToCents(text);
      } catch {
        return Number.NaN;
      }
    };
    let currentSalary: CurrentSalary | null = null;
    if (hisKind === "gross") currentSalary = { kind: "gross", grossAnnualCents: read(hisAmount), fromPeriod: hisFrom };
    if (hisKind === "take-home") currentSalary = { kind: "take-home", monthlyCents: read(hisAmount), fromPeriod: hisFrom };
    let additionalSalary: AdditionalSalary | null = null;
    if (otherKind === "w2") additionalSalary = { kind: "w2", grossAnnualCents: read(otherAmount), fromPeriod: otherFrom };
    if (otherKind === "monthly") additionalSalary = { kind: "monthly", monthlyCents: read(otherAmount), fromPeriod: otherFrom };
    // A blank box is estimated (null); the tax figures belong to a yearly base salary only, so
    // with any other kind they save blank, and so do older yearly ones.
    const typed = (text: string) => (text.trim() === "" ? null : read(text));
    const gross = hisKind === "gross";
    // The paycheck premium box is gone: a premium typed there earlier is kept as saved.
    const otherTaxes = gross ? typed(payOther) : null;
    const paycheck: PaycheckFigures = {
      federalCents: gross ? typed(payFederal) : null,
      payrollCents: gross ? typed(payPayroll) : null,
      premiumCents: assumptions.paycheck?.premiumCents ?? null,
      ...(otherTaxes !== null ? { otherTaxesCents: otherTaxes } : {}),
    };
    // A row left wholly blank is no row.
    const benefits: Benefit[] | undefined =
      hasList || benefitsTouched
        ? benefitRows
            .filter((r) => r.name.trim() !== "" || r.amount.trim() !== "")
            .map((r) => ({ name: r.name, amountCents: read(r.amount), every: r.every, beforeTax: r.beforeTax }))
        : undefined;
    const problem = strict ? incomeProblem(currentSalary, additionalSalary) ?? paycheckProblem(schedule, paycheck) ?? (benefits ? benefitsProblem(benefits, schedule) : null) : null;
    if (problem) return problem;
    const withBenefits = benefits ? { benefits } : {};
    return gross
      ? { currentSalary, additionalSalary, paySchedule: schedule, paycheck, ...withBenefits }
      : { currentSalary, additionalSalary, firmTaxes: { federalAnnualCents: null, payrollAnnualCents: null }, paySchedule: schedule, paycheck, ...withBenefits };
  };

  async function save() {
    const d = draft(true);
    if (typeof d === "string") {
      setStatus(d);
      return;
    }
    try {
      const db = await deps.loadDb();
      await deps.setIncome(db, d);
      setStatus("Saved.");
      if (d.benefits) {
        setHasList(true);
        setBenefitsTouched(false);
      }
      onChanged?.();
      // Read the settings again, as on mount, so the bank
      // line and the lines under the boxes work from what this save put in force (a typed
      // paycheck premium replaces the older monthly one, for one). The boxes keep what was typed.
      try {
        setAssumptions(await deps.getSalarySettings(db));
      } catch {
        /* the save stands; the next visit reads it */
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  // What a yearly salary leaves in the bank each month, worked the way the ladder and the
  // Forecast work it: with the additional W-2 salary taxed with it when there is one.
  // The figures a save would put in force: the paycheck boxes, else the older figures, else the estimate.
  const preview = draft(false);
  const older = olderFigures(assumptions);
  const figures = salaryFigures({
    paySchedule: schedule,
    paycheck: typeof preview !== "string" ? preview.paycheck ?? null : null,
    olderPremiumMonthlyCents: older.premium ? assumptions.premiumMonthlyCents : null,
    olderFirmTaxes:
      hisKind === "gross"
        ? { federalAnnualCents: older.federal ? assumptions.firmTaxes?.federalAnnualCents ?? null : null, payrollAnnualCents: older.payroll ? assumptions.firmTaxes?.payrollAnnualCents ?? null : null }
        : null,
  });
  const previewFirm = figures.firmTaxes;
  const firmTyped = hasFirmTaxes(previewFirm);
  // Federal income tax, or Social Security and Medicare, still estimated: the estimate waits for the
  // tax step (filing status and children). Typed pay-stub figures need no estimate and still show.
  const estimating = previewFirm?.federalAnnualCents == null || previewFirm?.payrollAnnualCents == null || (typeof preview !== "string" && preview.additionalSalary?.kind === "w2");
  const waitsForTax = estimating && taxSetUpNeeded(assumptions);
  // The benefits as typed, once there is a list (or the user is editing one); else the figure in force.
  const listed = hasList || benefitsTouched ? draftTotals(benefitRows, schedule) : null;
  const previewPremium = listed ? listed.monthlyCents : figures.premiumMonthlyCents ?? DEFAULT_SALARY_ASSUMPTIONS.premiumMonthlyCents;
  const previewAfterTax = listed ? listed.monthlyCents - listed.beforeTaxMonthlyCents : 0;
  const bank =
    typeof preview !== "string" && (preview.currentSalary?.kind === "gross" || preview.additionalSalary?.kind === "w2")
      ? monthIncome(
          "9999-12",
          { main: preview.currentSalary, other: preview.additionalSalary, mainIsReal: true },
          { ...assumptions, premiumMonthlyCents: previewPremium, afterTaxBenefitsMonthlyCents: previewAfterTax, firmTaxes: previewFirm }
        )
      : null;

  /** The line under a paycheck box: what it comes to, an older figure still in force, or the estimate. */
  const hint = (text: string, olderCents: number | null, olderEvery: "month" | "year", blank = "Left blank: estimated."): string => {
    if (text.trim() === "") {
      if (olderCents === null) return blank;
      return `Now ${formatCents(olderCents)} a ${olderEvery}, typed earlier as a ${olderEvery === "month" ? "monthly" : "yearly"} amount. Type the paycheck figure to replace it.`;
    }
    if (!schedule) return "Pick how often you are paid first.";
    let cents: number;
    try {
      cents = parseDollarsToCents(text);
    } catch {
      return "Type dollars, such as 812.34.";
    }
    if (cents < 0) return "A paycheck figure cannot be below zero.";
    const { monthlyCents, yearlyCents } = paycheckToMonthAndYear(cents, schedule);
    return `Comes to ${formatCents(monthlyCents)} a month, ${formatCents(yearlyCents)} a year.`;
  };
  // The grey text in a blank box names what is in force: an older figure in the unit it
  // was typed in, else "Estimated". Just the figure and its unit: three boxes side by side from 640 px
  // hold about 16 characters each, and the line under the box already says it was typed earlier.
  const placeholder = (olderCents: number | null, olderEvery: "month" | "year") =>
    olderCents === null ? "Estimated" : `${monthlyText(olderCents)} a ${olderEvery}`;
  const paycheckBox = (id: "federal" | "payroll" | "other", label: string, value: string, set: (v: string) => void, olderCents: number | null, olderEvery: "month" | "year", blank?: string) => (
    <label className={LABEL}>
      {label}
      <Input aria-label={label} inputMode="decimal" className="font-mono" placeholder={blank ? "None" : placeholder(olderCents, olderEvery)} disabled={!schedule} value={value} onChange={(e) => set(e.target.value)} />
      <span data-testid={`paycheck-hint-${id}`}>{hint(value, olderCents, olderEvery, blank)}</span>
    </label>
  );

  const pick = <T extends string>(set: (v: T) => void) => (v: unknown[]) => {
    // Pressing the chosen button again would leave nothing chosen; keep the choice.
    if (v.length > 0) set(v[0] as T);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current salary</CardTitle>
        <CardDescription>
          What you earn now. The Forecast screen counts it from the month it starts. With an additional salary, Salary needed is your salary given that one.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <ToggleGroup value={[hisKind]} onValueChange={pick<HisKind>(setHisKind)} aria-label="How to enter your salary">
            <ToggleGroupItem value="none">None</ToggleGroupItem>
            <ToggleGroupItem value="gross">Yearly base salary</ToggleGroupItem>
            <ToggleGroupItem value="take-home">Monthly pay into the bank</ToggleGroupItem>
          </ToggleGroup>
          {hisKind !== "none" && (
            <div className="grid gap-4 sm:grid-cols-3">
              {hisKind === "gross" ? (
                <label className={LABEL}>
                  Yearly base salary, before tax
                  <Input aria-label="Yearly base salary, before tax" inputMode="decimal" className="font-mono" placeholder="150,000" value={hisAmount} onChange={(e) => setHisAmount(e.target.value)} />
                </label>
              ) : (
                <label className={LABEL}>
                  Monthly pay, the amount that hits the bank
                  <Input aria-label="Monthly pay, the amount that hits the bank" inputMode="decimal" className="font-mono" placeholder="9,000.00" value={hisAmount} onChange={(e) => setHisAmount(e.target.value)} />
                </label>
              )}
              <label className={LABEL}>
                Salary starts
                <Input aria-label="Salary starts" type="month" className="w-44" value={hisFrom} onChange={(e) => setHisFrom(e.target.value)} />
              </label>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t pt-4">
          <p className="text-sm font-medium">Additional salary (optional)</p>
          <ToggleGroup value={[otherKind]} onValueChange={pick<OtherKind>(setOtherKind)} aria-label="Additional salary">
            <ToggleGroupItem value="none">None</ToggleGroupItem>
            <ToggleGroupItem value="w2">W-2 salary, taxed with yours</ToggleGroupItem>
            <ToggleGroupItem value="monthly">Monthly amount</ToggleGroupItem>
          </ToggleGroup>
          {otherKind !== "none" && (
            <div className="grid gap-4 sm:grid-cols-3">
              {otherKind === "w2" ? (
                <label className={LABEL}>
                  Additional yearly salary, before tax
                  <Input aria-label="Additional yearly salary, before tax" inputMode="decimal" className="font-mono" placeholder="60,000" value={otherAmount} onChange={(e) => setOtherAmount(e.target.value)} />
                </label>
              ) : (
                <label className={LABEL}>
                  Additional monthly amount
                  <Input aria-label="Additional monthly amount" inputMode="decimal" className="font-mono" placeholder="2,000.00" value={otherAmount} onChange={(e) => setOtherAmount(e.target.value)} />
                </label>
              )}
              <label className={LABEL}>
                Additional salary starts
                <Input aria-label="Additional salary starts" type="month" className="w-44" value={otherFrom} onChange={(e) => setOtherFrom(e.target.value)} />
              </label>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            A W-2 salary is taxed with yours: married filing jointly, on one return (federal tax on the combined wages); otherwise on its own single return. Either way, Social Security and Medicare for each of you, your benefits once, and any charity share of pay on the combined pay into the bank. A monthly amount is counted as it is, with no tax worked on it and no charity share.
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t pt-4">
          <p className="text-sm font-medium">From your pay stub, a paycheck</p>
          <p className="text-xs text-muted-foreground">
            Type what comes out of one paycheck, as the pay stub shows it, and the app works out the month and the year. Typed figures replace
            the estimate for those lines; anything still estimated is labelled as an estimate. The tax figures apply to this salary only: Salary
            needed and any other salary the app tries keep estimated taxes. State and local taxes are not estimated; type them from a pay stub.
            Benefits are typed below. Leave a box blank to keep a figure typed earlier, or to estimate when there is none.
          </p>
          <ToggleGroup value={schedule ? [schedule] : []} onValueChange={pick<PaySchedule>(setSchedule)} aria-label="How often you are paid">
            {PAY_SCHEDULES.map((s) => (
              <ToggleGroupItem key={s.value} value={s.value}>
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {!schedule && <p className="text-xs text-muted-foreground">Pick how often you are paid first; the boxes open once you do.</p>}
          <div className="grid gap-4 sm:grid-cols-3">
            {hisKind === "gross" && (
              <>
                {paycheckBox("federal", "Federal income tax, a paycheck", payFederal, setPayFederal, older.federal ? assumptions.firmTaxes?.federalAnnualCents ?? null : null, "year")}
                {paycheckBox("payroll", "Social Security and Medicare, a paycheck", payPayroll, setPayPayroll, older.payroll ? assumptions.firmTaxes?.payrollAnnualCents ?? null : null, "year")}
                {paycheckBox("other", "State and local taxes, a paycheck", payOther, setPayOther, null, "year", "Left blank: none. State and local taxes are not estimated.")}
              </>
            )}
          </div>
          {hisKind !== "gross" && (
            <p className="text-xs text-muted-foreground">Tax figures from the pay stub go with a yearly base salary. Pick Yearly base salary above to type them.</p>
          )}
        </div>

        <BenefitsEditor
          rows={benefitRows}
          onChange={(rows) => {
            setBenefitRows(rows);
            setBenefitsTouched(true);
          }}
          schedule={schedule}
          estimateMonthlyCents={DEFAULT_SALARY_ASSUMPTIONS.premiumMonthlyCents}
        />

        {bank && waitsForTax && (
          <SetUpCard step="tax" what="What reaches the bank uses an estimated federal tax, which needs your filing status and children. Or type both tax figures from your pay stub." />
        )}

        {bank && !waitsForTax && (
          <p data-testid="current-salary-bank" className="text-sm text-muted-foreground">
            After tax and benefits, about <span className="font-mono tabular-nums">{formatCents(bank.bankCents)} a month</span> reaches the bank once
            everything has started.{" "}
            {(assumptions.pot === undefined || potIsOn(assumptions.pot)) && (
              <>
                {potLabel(assumptions.pot)} on it: <span className="font-mono tabular-nums">{formatCents(bank.maaserCents)} a month</span>.{" "}
              </>
            )}
            {firmTyped ? "Taxes: your firm figures, with any box left blank estimated." : "Taxes: estimated."}{" "}
            {(previewFirm?.otherAnnualCents ?? 0) > 0 ? "State and local taxes: from your pay stub." : "State and local taxes: not estimated."}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={() => void save()}>Save salary</Button>
          <span role="status" className="text-xs text-muted-foreground">
            {status}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
