import { sideOf } from "./budget-income.js";
import type { Holiday } from "./holidays.js";
import { MAASER_CATEGORY } from "./maaser-pot.js";
import { merchantOf, shownName, type RenameMap } from "./merchants.js";
import { bestCadence, daysBetween, isBillCandidate, median, nearAmount, nextDate, type RecurringSeries } from "./recurring.js";
import type { RecurringChoice } from "./recurring-choices.js";
import type { MonthlyRollup } from "./rollups.js";
import { ruleKeyFor } from "./rules.js";
import { addMonths } from "./scenario.js";
import type { NormalizedTxn } from "./types.js";
import { monthlyShareCents, raiseHistoryMonths, type Raise, type RaiseWhen, type YearlyBill } from "./yearly-costs.js";

export const RAISE_RATIO = 1.5;
export const RAISE_MIN_EXCESS_CENTS = 5_000;

export interface BillProposal { payeeKey: string; accountId: string; label: string; planningCategory: string; amountCents: number; months: string[]; shareCents: number; lastPaid: string }
export interface RaiseProposal { planningCategory: string; label: string; amountCents: number; when: RaiseWhen; basis: { month: string; excessCents: number }[] }

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const spendingLine = (line: string | null): line is string => !!line && line !== MAASER_CATEGORY && sideOf(line) === "spending";

export function proposeBills(input: {
  series: RecurringSeries[]; prepared: NormalizedTxn[]; mapping: Record<string, string>; choices: RecurringChoice[];
  bills: YearlyBill[]; renames: RenameMap; today: string;
}): BillProposal[] {
  const { series, prepared, mapping, choices, bills, renames, today } = input;
  const byId = new Map(prepared.map(t => [t.sourceTransactionId, t]));
  const found: BillProposal[] = [];
  const make = (label: string, accountId: string, line: string, cents: number, lastPaid: string, months: string[]) => {
    if (!spendingLine(line)) return;
    const proposal = { payeeKey: label.toLowerCase(), accountId, label, planningCategory: line, amountCents: cents, months, lastPaid };
    found.push({ ...proposal, shareCents: monthlyShareCents(proposal) });
  };

  for (const s of series) {
    if ((s.cadence !== "annual" && s.cadence !== "quarterly") || !s.planningCategory) continue;
    const last = byId.get(s.charges[s.charges.length - 1]?.id);
    const label = last ? merchantOf(last, renames) : shownName(s.label, renames);
    const months = s.cadence === "annual" ? [s.nextExpected.slice(5, 7)]
      : [1, 2, 3, 4].map(i => nextDate(s.lastSeen, "quarterly", i).slice(5, 7)).sort();
    make(label, s.accountId, s.planningCategory, Math.abs(s.typicalAmountCents), s.lastSeen, months);
  }

  // A charge seen twice a year apart is a yearly bill the series test (three charges) has not seen yet.
  const groups = new Map<string, NormalizedTxn[]>();
  for (const t of prepared) {
    if (t.date > today || !isBillCandidate(t, mapping)) continue;
    const key = merchantOf(t, renames).toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const shown = new Set(found.map(p => p.label.toLowerCase()));
  for (const [key, rows] of groups) {
    if (shown.has(key) || rows.length < 2) continue;
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.sourceTransactionId.localeCompare(b.sourceTransactionId));
    const [before, later] = rows.slice(-2);
    const cents = Math.abs(later.amountCents);
    if (!nearAmount(cents, Math.abs(before.amountCents)) || bestCadence(daysBetween(before.date, later.date)) !== "annual"
      || daysBetween(later.date, today) > 400) continue;
    const ruleKey = ruleKeyFor(later);
    if (choices.some(c => c.choice === "not_recurring" && c.payeeKey === ruleKey && c.accountId === later.accountId
      && (c.amountCents == null || nearAmount(cents, c.amountCents)))) continue;
    const line = later.sourceCategory ? (mapping[later.sourceCategory] ?? later.sourceCategory) : null;
    if (line) make(merchantOf(later, renames), later.accountId, line, cents, later.date, [nextDate(later.date, "annual").slice(5, 7)]);
  }

  const listed = bills.map(b => ({ name: shownName(b.payeeKey, renames).toLowerCase(), amountCents: b.amountCents }));
  return found.filter(p => !listed.some(b => b.name === p.label.toLowerCase() && nearAmount(p.amountCents, b.amountCents)))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function proposeRaises(input: { rollups: MonthlyRollup[]; holidays: Holiday[]; raises: Raise[]; today: string }): RaiseProposal[] {
  const { rollups, holidays, today } = input;
  const raises = input.raises.filter(r => !r.archivedAt);
  const nowMonth = today.slice(0, 7);
  const first = addMonths(nowMonth, -24);
  const last = addMonths(nowMonth, -1);
  const spent = new Map<string, number>();
  for (const r of rollups) {
    if (r.kind === "expense" && spendingLine(r.planningCategory) && r.period >= first && r.period <= last) {
      const key = r.planningCategory + "|" + r.period;
      spent.set(key, (spent.get(key) ?? 0) + r.amountCents);
    }
  }
  const lines = [...new Set([...spent.keys()].map(k => k.split("|")[0]))].sort();

  // Each holiday key's two most recent years inside the window, ordered by the later one's start date, then key.
  const keys = new Map<string, Holiday[]>();
  for (const h of holidays) {
    if (h.start.slice(0, 7) < first || h.start.slice(0, 7) > last) continue;
    keys.set(h.calendarId + "|" + h.key, [...(keys.get(h.calendarId + "|" + h.key) ?? []), h]);
  }
  const holidayPairs = [...keys.values()].flatMap(list => {
    const perYear = new Map<string, Holiday>();
    for (const h of [...list].sort((a, b) => a.start.localeCompare(b.start))) perYear.set(h.start.slice(0, 4), h);
    const pair = [...perYear.values()].slice(-2);
    return pair.length === 2 ? [pair] : [];
  }).sort((a, b) => a[1].start.localeCompare(b[1].start) || a[1].key.localeCompare(b[1].key));

  const holidayResults: RaiseProposal[] = [];
  const monthResults: RaiseProposal[] = [];
  for (const line of lines) {
    const base = median(Array.from({ length: 24 }, (_, i) => spent.get(line + "|" + addMonths(first, i)) ?? 0));
    const excess = (month: string) => {
      const cents = spent.get(line + "|" + month) ?? 0;
      return cents >= RAISE_RATIO * base && cents >= base + RAISE_MIN_EXCESS_CENTS ? cents - base : null;
    };
    const claimed = new Set<string>();
    for (const r of raises) {
      if (r.planningCategory === line) for (const m of raiseHistoryMonths(r, holidays, first, last)) claimed.add(m);
    }
    const propose = (label: string, when: RaiseWhen, months: string[], into: RaiseProposal[]) => {
      if (months.some(m => claimed.has(m))) return;
      const over = months.map(m => excess(m));
      if (over.some(x => x === null)) return;
      const basis = months.map((month, i) => ({ month, excessCents: over[i] as number }));
      const mean = basis.reduce((sum, b) => sum + b.excessCents, 0) / basis.length;
      months.forEach(m => claimed.add(m));
      into.push({ planningCategory: line, label, amountCents: Math.floor(mean / 100) * 100, when, basis });
    };
    for (const [older, newer] of holidayPairs) {
      propose(newer.name, { kind: "holiday", calendarId: newer.calendarId, holidayKey: newer.key, countIn: "start" },
        [older.start.slice(0, 7), newer.start.slice(0, 7)], holidayResults);
    }
    for (let i = 0; i < 12; i++) {
      const mm = addMonths(first, i).slice(5);
      propose(MONTH_NAMES[Number(mm) - 1], { kind: "every-year", monthOfYear: mm }, [addMonths(first, i), addMonths(first, i + 12)], monthResults);
    }
  }
  return [...holidayResults, ...monthResults];
}
