import { sideOf } from "../../src/domain/budget-income.js";
import { detectRecurring } from "../../src/domain/recurring.js";
import { merchantOf, renameMap, shownName } from "../../src/domain/merchants.js";
import { localDateIso } from "../../src/domain/period.js";
import { rollupMonthly } from "../../src/domain/rollups.js";
import { addMonths, MAASER_CATEGORY } from "../../src/domain/scenario.js";
import { countedByAccount, isCountedAccount } from "../../src/domain/scope.js";
import { yearlyExclusion } from "../../src/domain/suggest.js";
import {
  firstOpenYear, fitShares, ownedBy, projectYearlyCosts, termsFor, validateBill, validateRaise,
  type Projection, type ShareOnRow, type YearlyBill, type YearlyShare,
} from "../../src/domain/yearly-costs.js";
import { headsUp } from "../../src/domain/yearly-heads-up.js";
import { proposeBills, proposeRaises } from "../../src/domain/yearly-proposals.js";
import type { NormalizedTxn, Account } from "../../src/domain/types.js";
import { openRepo } from "../db/openDb.js";
import { yearlyCostsStore, type BillEvent } from "../../src/data/yearly-costs.store.js";
import { holidayService } from "./holidayService.js";
import { getAccounts, listRecurringChoices } from "./readService.js";
import { preparedInputs } from "./seedBudgetService.js";
import { getZelleMemoNames } from "./settingsService.js";

export function yearlyCostsService(now = () => new Date()) {
  const repo = openRepo();
  const store = yearlyCostsStore(repo.connection(), now);
  const today = () => localDateIso(now());
  const month = () => today().slice(0, 7);
  const renames = () => renameMap(repo.listMerchantRenames(), { zelleByMemo: getZelleMemoNames() });
  const empty = (): Projection => ({ occurrences: [], bigMonths: [], notices: [], yearlyTxnIds: [] });

  function model(prepared?: NormalizedTxn[], accounts?: Account[]): Projection {
    const bills = store.listBills(true);
    const raises = store.listRaises(true);
    if (!bills.length && !raises.length) return empty();
    const plans = repo.listPlans();
    const starts = plans.map(p => p.startDate.slice(0, 7)).sort();
    const ends = plans.map(p => p.endDate.slice(0, 7)).sort();
    const from = starts[0] ?? month();
    const to = addMonths(ends[ends.length - 1] ?? month(), 36);
    const holidays = raises.some(r => r.when.kind === "holiday") ? holidayService().forProjection(Number(from.slice(0, 4)), Number(to.slice(0, 4))) : [];
    return projectYearlyCosts({
      from, to, today: today(),
      bills, terms: store.listTerms(), events: store.listEvents(), raises, holidays,
      calendars: raises.some(r => r.when.kind === "holiday") ? holidayService().calendars() : [],
      txns: bills.length ? prepared ?? preparedInputs().prepared : [], accounts: accounts ?? getAccounts(), renames: renames(),
    });
  }

  const openPlans = () => repo.listPlans().filter(p => p.endDate.slice(0, 7) >= month());
  const yearlyOf = (b: Pick<YearlyBill, "amountCents" | "months">) => (b.amountCents ?? 0) * b.months.length;
  // One bill's share joins a line in one budget: every row of the line (each read before any share comes out)
  // must have room for all its bills by the yearly amounts their shares were reserved for (fitShares). Every
  // share on the line is then worked out afresh from that amount, at most one cent from its own rounding.
  // The yearly amount a share was reserved for. A share saved before 0202 has none stored: its amount is the bill's
  // yearly amount when added (its creation record), which is what the share was worked out from, edits or not. If
  // that record is missing or does not round to the share, the share counts as exactly 12 x cents and never moves.
  function basisOf(s: YearlyShare): number {
    if (s.yearlyCents != null) return s.yearlyCents;
    const signup = store.signupYearlyCents(s.billId);
    return signup !== null && Math.round(signup / 12) === s.cents ? signup : 12 * s.cents;
  }
  function placeShare(planId: string, line: string, joining: ShareOnRow) {
    const onLine = store.listShares(planId).filter(s => s.planningCategory === line && s.billId !== joining.billId);
    const taken = onLine.reduce((sum, s) => sum + s.cents, 0);
    const rows = [
      ...repo.getBudgetLines(planId).filter(row => row.planningCategory === line).map(row => row.amountCents + taken),
      ...repo.listBudgetChanges(planId).filter(row => row.planningCategory === line && row.reason === "changed").map(row => row.amountCents),
    ];
    const others = onLine.map(s => ({ billId: s.billId, yearlyCents: basisOf(s) }));
    const fitted = fitShares(rows, [...others, joining]);
    if (!fitted) {
      throw new Error("That line's budget is less than this bill's share each month. Add the bill without taking it out of the line, or change the line first.");
    }
    for (const { billId, yearlyCents } of [...others, joining]) {
      const cents = fitted.get(billId) ?? 0;
      const mine = store.listShares().filter(s => s.billId === billId);
      store.setShares(billId, [...mine.filter(s => s.planId !== planId), { billId, planId, planningCategory: line, cents, yearlyCents }]);
    }
  }
  // The lines the Budget screen shows: every budget line row and every budget change, so a line added mid-year
  // only through a change from a month counts too.
  const knownLines = () => new Set(repo.listPlans().flatMap(plan =>
    [...repo.getBudgetLines(plan.id), ...repo.listBudgetChanges(plan.id)].map(row => row.planningCategory)));

  function active(id: number) {
    const bill = store.getBill(id);
    if (!bill || bill.archivedAt) throw new Error("That yearly bill no longer exists.");
    return bill;
  }

  function checked(input: unknown) {
    const clean = validateBill(input);
    if (typeof clean === "string") throw new Error(clean);
    // sideOf calls any name it does not know spending, so a made-up or misspelled line is checked against the
    // lines the household's budgets have (the bill dialog offers the same budget lines).
    if (!knownLines().has(clean.planningCategory)) throw new Error("That budget line is not in your budget. Pick one of your budget lines for this bill.");
    if (sideOf(clean.planningCategory) !== "spending" || clean.planningCategory === MAASER_CATEGORY) throw new Error("A yearly bill goes on a spending line other than Charity.");
    return clean;
  }

  function checkedRaise(input: unknown) {
    const clean = validateRaise(input);
    if (typeof clean === "string") throw new Error(clean);
    if (sideOf(clean.planningCategory) !== "spending" || clean.planningCategory === MAASER_CATEGORY) throw new Error("A raise goes on a spending line other than Charity.");
    if (clean.when.kind === "once" && clean.when.month < month()) throw new Error("That month has already passed, so a raise there would never show. Choose this month or a later one.");
    if (clean.when.kind === "holiday") {
      const { calendarId } = clean.when;
      if (!holidayService().calendars().some(c => c.id === calendarId)) throw new Error("That holiday calendar could not be found.");
    }
    return clean;
  }

  function activeRaise(id: number) {
    const raise = store.listRaises().find(r => r.id === id);
    if (!raise) throw new Error("That raise no longer exists.");
    return raise;
  }

  function chargesFor(id: number) {
    const bill = active(id);
    const accounts = countedByAccount(getAccounts());
    const names = renames();
    const from = addMonths(month(), -23) + "-01";
    const payee = shownName(bill.payeeKey, names).toLowerCase();
    return preparedInputs().prepared.filter(t => t.date >= from && t.date <= today() && t.amountCents < 0
      && isCountedAccount(t.accountId, accounts) && !t.isWash && !t.savingBucket && !t.isTransfer && (!bill.accountId || bill.accountId === t.accountId)
      && merchantOf(t, names).trim().toLowerCase() === payee)
      .map(t => ({ id: t.sourceTransactionId, date: t.date, amountCents: -t.amountCents, label: merchantOf(t, names) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  return {
    listBills: () => store.listBills(),
    addBill(input: unknown) {
      const clean = checked(input);
      return store.transaction(() => {
        const takeOut = typeof input === "object" && input !== null && "takeOutOfLine" in input && input.takeOutOfLine === true;
        // A refusal below throws, and the transaction takes the new bill back out.
        const bill = store.addBill(clean);
        // A known amount whose share rounds to 0 is still tracked, so the room check counts it.
        if (takeOut && yearlyOf(clean) > 0) {
          for (const plan of openPlans()) placeShare(plan.id, clean.planningCategory, { billId: bill.id, yearlyCents: yearlyOf(clean) });
        }
        return bill;
      });
    },
    updateBill(id: number, input: unknown) {
      const clean = checked(input);
      store.transaction(() => {
        const bill = active(id);
        const projection = model();
        const fromYear = firstOpenYear(bill, projection.occurrences, repo.listPlans(), today());
        const terms = termsFor(bill, store.listTerms(id), fromYear);
        const changed = clean.amountCents !== bill.amountCents || clean.planningCategory !== bill.planningCategory
          || clean.months.join(",") !== bill.months.join(",");
        const { label, payeeKey, accountId } = clean;
        store.updateBill(id, { label, payeeKey, accountId });
        if (!changed) return;
        if (clean.planningCategory !== bill.planningCategory) {
          const open = new Set(openPlans().map(plan => plan.id));
          const shares = store.listShares().filter(share => share.billId === id);
          const moved = shares.filter(s => open.has(s.planId) && s.planningCategory !== clean.planningCategory);
          for (const s of moved) placeShare(s.planId, clean.planningCategory, { billId: id, yearlyCents: basisOf(s) });
        }
        const row = (year: number, amountCents: number | null) =>
          store.setTerms({ billId: id, fromYear: year, planningCategory: clean.planningCategory, months: clean.months, amountCents });
        if (clean.amountCents !== bill.amountCents || terms.amountCents === null) {
          row(fromYear, clean.amountCents);
          return;
        }
        // Revision 6 (R6-2): the amount was not edited, so each year keeps the amount expected for it now,
        // a learned one included. A new terms row is stamped now and would otherwise hide a payment learned
        // before it (D6), so each later year whose expected amount differs gets its own row.
        const mine = projection.occurrences.filter(o => o.billId === id && o.obligationYear >= fromYear);
        const lastLearned = Math.max(fromYear, ...mine.filter(o => o.status === "landed" && o.matchedTxnIds.length).map(o => o.obligationYear + 1));
        let written: number | null | undefined;
        for (let year = fromYear; year <= lastLearned; year++) {
          const cents = mine.find(o => o.obligationYear === year)?.expectedCents ?? written ?? terms.amountCents;
          if (cents !== written) row(year, cents);
          written = cents;
        }
      });
    },
    removeBill(id: number) {
      store.transaction(() => {
        const bill = active(id);
        const fromYear = firstOpenYear(bill, model().occurrences, repo.listPlans(), today());
        const { amountCents, planningCategory } = termsFor(bill, store.listTerms(id), fromYear);
        store.setTerms({ billId: id, fromYear, amountCents, planningCategory, months: [] });
        const open = new Set(openPlans().map(plan => plan.id));
        store.setShares(id, store.listShares().filter(share => share.billId === id && !open.has(share.planId)));
        store.archiveBill(id);
      });
    },
    recordEvent(billId: number, event: Omit<BillEvent, "id" | "createdAt" | "billId" | "sourceTransactionId"> & { sourceTransactionId?: string }) {
      store.transaction(() => {
        const bill = active(billId);
        const projection = model();
        const occurrence = projection.occurrences.find(o => o.billId === billId && o.obligationYear === event.obligationYear && o.dueMonth === event.dueMonth);
        if (!occurrence) throw new Error("That payment is no longer on the yearly list.");
        if (event.kind === "picked" && !chargesFor(billId).some(charge => charge.id === event.sourceTransactionId)) {
          throw new Error("Choose a payment for this bill.");
        }
        if (event.kind === "told-new-amount") {
          if (!occurrence.matchedTxnIds.length) throw new Error("Choose a payment before updating this amount.");
          const fromYear = firstOpenYear(bill, projection.occurrences, repo.listPlans(), today());
          const { months, planningCategory } = termsFor(bill, store.listTerms(billId), fromYear);
          store.setTerms({ billId, fromYear, months, planningCategory, amountCents: occurrence.paidCents });
        }
        store.addEvent({ ...event, billId, sourceTransactionId: event.sourceTransactionId ?? null });
        if (event.kind === "gone") store.archiveBill(billId);
      });
    },
    listRaises: () => store.listRaises(),
    addRaise(input: unknown) {
      const clean = checkedRaise(input);
      return store.transaction(() => store.addRaise(clean));
    },
    // Raises have no terms, so an edit replaces the raise: the old one keeps every month before this month,
    // closed months included, and the new one places from this month on (D9, Revision 5, R5-7).
    updateRaise(id: number, input: unknown) {
      const clean = checkedRaise(input);
      return store.transaction(() => {
        const old = activeRaise(id);
        if (old.when.kind === "once" && old.when.month < month()) throw new Error("That raise's month has passed, so it stays as it was.");
        store.archiveRaise(id);
        return store.addRaise(clean);
      });
    },
    removeRaise(id: number) {
      store.transaction(() => {
        activeRaise(id);
        store.archiveRaise(id);
      });
    },
    // Suggestions only: nothing here writes, so nothing joins the user's data until the user accepts one.
    proposals() {
      const { prepared, mapping } = preparedInputs();
      const accounts = getAccounts();
      const names = renames();
      const ids = new Set(model(prepared, accounts).yearlyTxnIds);
      const on = new Set(holidayService().calendars().filter(c => c.on).map(c => c.id));
      const year = Number(today().slice(0, 4));
      const billProposals = proposeBills({ series: detectRecurring(prepared, mapping, today(), listRecurringChoices()), prepared, mapping,
        choices: listRecurringChoices(), bills: store.listBills(true), renames: names, today: today() });
      // A payment a bill suggestion claims is never also offered as a raise: it would be counted twice.
      const claimed = (t: NormalizedTxn) => billProposals.some(p => p.accountId === t.accountId && p.payeeKey === merchantOf(t, names).trim().toLowerCase());
      return {
        bills: billProposals,
        raises: proposeRaises({
          rollups: rollupMonthly(prepared.filter(t => !ids.has(t.sourceTransactionId) && !claimed(t)), accounts, mapping),
          holidays: holidayService().forProjection(year - 3, year).filter(h => on.has(h.calendarId)),
          raises: store.listRaises(), today: today(),
        }),
      };
    },
    chargesFor,
    headsUp: () => headsUp(model(), store.listBills(), store.listRaises(), today()),
    householdProjection: () => model(),
    projectionFor(planId: string) {
      const projection = model();
      return { ...projection, bigMonths: ownedBy(projection.bigMonths, repo.listPlans(), planId) };
    },
    occurrences(from: string, to: string) {
      const projection = model();
      return { ...projection,
        occurrences: projection.occurrences.filter(o => o.paymentMonth >= from && o.paymentMonth <= to),
        bigMonths: projection.bigMonths.filter(row => row.month >= from && row.month <= to),
      };
    },
    yearlyExclusionFor(prepared: NormalizedTxn[], accounts: Account[], mapping: Record<string, string>) {
      return yearlyExclusion(prepared, accounts, mapping, new Set(model(prepared, accounts).yearlyTxnIds));
    },
    rollupsWithoutYearly() {
      const { prepared, rollups, mapping } = preparedInputs();
      const accounts = getAccounts();
      const ids = new Set(model(prepared, accounts).yearlyTxnIds);
      return ids.size ? rollupMonthly(prepared.filter(t => !ids.has(t.sourceTransactionId)), accounts, mapping) : rollups;
    },
  };
}