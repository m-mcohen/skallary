// src/ui/holidays/HolidaysStep.tsx -- the first-run interview's holidays step, and (as HolidayCalendars) the
// Holiday calendars section of Budget, Yearly costs. Holidays place raises that depend on one: the built-in
// US national holidays can be switched on, and a calendar file (.ics) from any calendar app can be imported
// for the rest. A calendar that is switched off is never used. Changes are saved as they are made.
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatPeriodLabel } from "../../domain/period";
import type { HolidayCalendar } from "../../domain/holidays";
import { useConfirm } from "../ConfirmDialog";
import { getHolidayCalendarsUI, importCalendarUI, removeCalendarUI, setCalendarOnUI } from "../lib/db-yearly";
import { StepActions } from "../setup/StepActions";
import type { SetupStepProps } from "../setup/steps";

export function HolidayCalendars({ onChanged }: { onChanged?: () => void }): JSX.Element {
  const [calendars, setCalendars] = useState<HolidayCalendar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const confirm = useConfirm();
  const updateRef = useRef<HTMLInputElement>(null);
  const [updating, setUpdating] = useState<HolidayCalendar | null>(null);

  const load = useCallback(async () => {
    try {
      setCalendars(await getHolidayCalendarsUI());
    } catch (e) {
      setError(e instanceof Error ? e.message : "The holiday calendars could not be read.");
      setCalendars([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const done = await work();
      if (done) setMessage(done);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be done. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const summary = (r: { calendar: HolidayCalendar; imported: number; problems: string[] }) =>
    `${r.calendar.name}: ${r.imported} holiday dates read.${r.problems.length ? ` ${r.problems.length} entries were skipped: ${r.problems.slice(0, 2).join(" ")}` : ""}`;

  const importNew = () => run(async () => {
    if (!file) throw new Error("Choose a calendar file to import.");
    const result = await importCalendarUI(name, await file.text());
    setName("");
    setFile(null);
    setFileKey((k) => k + 1);
    return summary(result);
  });

  const replaceFrom = (calendar: HolidayCalendar, chosen: File) => run(async () => summary(await importCalendarUI(calendar.name, await chosen.text(), calendar.id)));

  return (
    <div className="flex flex-col gap-3">
      {calendars === null && <p className="text-sm text-muted-foreground">Loading the calendars.</p>}
      {calendars && (
        <ul aria-label="Holiday calendars" className="flex flex-col divide-y rounded-lg border">
          {calendars.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">
                  {c.source === "us-national"
                    ? "Built in: the 11 federal holidays, every year"
                    : c.coversThrough ? `Dates run through ${formatPeriodLabel(c.coversThrough.slice(0, 7))}` : "No dates"}
                </span>
              </div>
              {c.on ? <Badge variant="secondary">On</Badge> : <Badge variant="outline">Off</Badge>}
              <Switch aria-label={`Use ${c.name}`} checked={c.on} disabled={busy} onCheckedChange={(on) => void run(() => setCalendarOnUI(c.id, on === true))} />
              {c.source === "imported" && (
                <>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => { setUpdating(c); updateRef.current?.click(); }}>Replace from a new file</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => confirm.ask({
                      title: `Remove ${c.name}?`,
                      description: "Its holiday dates are deleted. A raise that uses it must be removed first. You can import the file again later.",
                      confirmLabel: "Remove calendar",
                      onConfirm: () => void run(() => removeCalendarUI(c.id)),
                    })}
                  >
                    Remove
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <input
        ref={updateRef}
        type="file"
        accept=".ics,text/calendar"
        className="sr-only"
        tabIndex={-1}
        aria-label="New calendar file"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          e.target.value = "";
          if (chosen && updating) void replaceFrom(updating, chosen);
        }}
      />
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <p className="text-sm font-medium">Import a calendar file</p>
        <p className="text-xs text-muted-foreground">
          Export a calendar of holidays from your calendar app as an .ics file, name it, and import it. Only all-day events are read.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span>Name</span>
            <Input aria-label="Calendar name" value={name} onChange={(e) => setName(e.target.value)} placeholder="School holidays" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>File</span>
            <Input key={fileKey} aria-label="Calendar file" type="file" accept=".ics,text/calendar" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Button disabled={busy || !name.trim() || !file} onClick={() => void importNew()}>Import</Button>
        </div>
      </div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {confirm.dialog}
    </div>
  );
}

export default function HolidaysStep({ onDone, onSkip }: SetupStepProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Some yearly costs follow a holiday, like gifts or a trip. If you want to plan for those, switch on the US national
        holidays, or import a calendar file for the holidays you keep. If not, leave them off and press Next. You can change
        this later in Budget, Yearly costs.
      </p>
      <HolidayCalendars />
      <StepActions onNext={onDone} onSkip={onSkip} />
    </div>
  );
}
