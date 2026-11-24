import type Database from "better-sqlite3";
import type { Holiday, HolidayCalendar } from "../domain/holidays.js";
import type { Raise, RaiseWhen, YearlyBill, YearlyBillTerms, YearlyShare } from "../domain/yearly-costs.js";

export type BillEventKind = "picked" | "ticked" | "still-exists" | "gone" | "told-new-amount";
export interface BillEvent {
  id: number; billId: number; obligationYear: number; dueMonth: string; kind: BillEventKind;
  sourceTransactionId: string | null; createdAt: string;
}

type NewBill = Omit<YearlyBill, "id" | "createdAt" | "archivedAt">;
type NewRaise = Omit<Raise, "id" | "createdAt" | "archivedAt">;
type BillRow = Omit<YearlyBill, "months"> & { months: string };
type RaiseRow = Omit<Raise, "when"> & {
  whenKind: RaiseWhen["kind"]; month: string; monthOfYear: string;
  calendarId: string; holidayKey: string; countIn: "start" | "end";
};

function billFrom(row: BillRow): YearlyBill {
  return { ...row, months: JSON.parse(row.months) };
}

function raiseFrom(row: RaiseRow): Raise {
  const { whenKind, month, monthOfYear, calendarId, holidayKey, countIn, ...raise } = row;
  let when: RaiseWhen;
  if (whenKind === "once") when = { kind: "once", month };
  else if (whenKind === "every-year") when = { kind: "every-year", monthOfYear };
  else when = { kind: "holiday", calendarId, holidayKey, countIn };
  return { ...raise, when };
}

function whenColumns(when: RaiseWhen) {
  return {
    whenKind: when.kind, month: when.kind === "once" ? when.month : null,
    monthOfYear: when.kind === "every-year" ? when.monthOfYear : null,
    calendarId: when.kind === "holiday" ? when.calendarId : null,
    holidayKey: when.kind === "holiday" ? when.holidayKey : null,
    countIn: when.kind === "holiday" ? when.countIn : "start",
  };
}

const shareColumns = "SELECT bill_id AS billId, plan_id AS planId, planning_category AS planningCategory, cents, yearly_cents AS yearlyCents FROM yearly_bill_shares";

export function readYearlyShares(db: Database.Database, planId: string): YearlyShare[] {
  return db.prepare<[string], YearlyShare>(shareColumns + " WHERE plan_id=? ORDER BY bill_id").all(planId);
}

export function yearlyShareFor(db: Database.Database, planId: string, line: string): number {
  return db.prepare<[string, string], number>(`SELECT COALESCE(SUM(cents), 0) FROM yearly_bill_shares
    WHERE plan_id=? AND planning_category=?`).pluck().get(planId, line) as number;
}

export function yearlyCostsStore(db: Database.Database, now: () => Date = () => new Date()) {
  const bills = `SELECT id, planning_category AS planningCategory, label, payee_key AS payeeKey,
    account_id AS accountId, amount_cents AS amountCents, months, created_at AS createdAt, archived_at AS archivedAt FROM yearly_bills`;
  const raises = `SELECT id, planning_category AS planningCategory, label, amount_cents AS amountCents, when_kind AS whenKind,
    month, month_of_year AS monthOfYear, calendar_id AS calendarId, holiday_key AS holidayKey, count_in AS countIn,
    created_at AS createdAt, archived_at AS archivedAt FROM budget_raises`;
  const timestamp = () => now().toISOString();

  function transaction<T>(body: () => T): T {
    return db.transaction(body).immediate();
  }
  function log(type: "yearly_bill" | "raise" | "holiday_calendar", id: number | string, field: string, before: unknown, after: unknown) {
    db.prepare(`INSERT INTO change_log (entity_type, entity_id, field, old_value, new_value, timestamp, actor)
      VALUES (?, ?, ?, ?, ?, ?, 'app')`).run(type, String(id), field,
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), timestamp());
  }
  function getBill(id: number): YearlyBill | null {
    const row = db.prepare<[number], BillRow>(bills + " WHERE id=?").get(id);
    return row ? billFrom(row) : null;
  }
  function listTerms(billId?: number): YearlyBillTerms[] {
    const query = `SELECT bill_id AS billId, from_year AS fromYear, planning_category AS planningCategory, amount_cents AS amountCents, months, created_at AS createdAt FROM yearly_bill_terms`;
    const args = billId === undefined ? [] : [billId];
    return db.prepare<number[], Omit<YearlyBillTerms, "months"> & { months: string }>(
      query + (args.length ? " WHERE bill_id=?" : "") + " ORDER BY bill_id, from_year"
    ).all(...args).map(row => ({ ...row, months: JSON.parse(row.months) }));
  }
  // The only writer of terms. Replaces the terms from t.fromYear on: later rows it supersedes are deleted.
  function setTerms(t: Omit<YearlyBillTerms, "createdAt">): void {
    transaction(() => {
      const old = listTerms(t.billId).find(row => row.fromYear === t.fromYear);
      db.prepare(`INSERT INTO yearly_bill_terms (bill_id, from_year, planning_category, amount_cents, months, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(bill_id, from_year) DO UPDATE SET planning_category=excluded.planning_category,
        amount_cents=excluded.amount_cents, months=excluded.months, created_at=excluded.created_at`)
        .run(t.billId, t.fromYear, t.planningCategory, t.amountCents, JSON.stringify(t.months), timestamp());
      db.prepare("DELETE FROM yearly_bill_terms WHERE bill_id=? AND from_year>?").run(t.billId, t.fromYear);
      db.prepare(`UPDATE yearly_bills SET (planning_category, amount_cents, months) =
        (SELECT planning_category, amount_cents, months FROM yearly_bill_terms WHERE bill_id=? ORDER BY from_year DESC LIMIT 1) WHERE id=?`)
        .run(t.billId, t.billId);
      log("yearly_bill", t.billId, "terms", old, t);
    });
  }
  function updateBill(id: number, patch: Partial<Omit<NewBill, "planningCategory" | "amountCents" | "months"> & { archivedAt: string | null }>) {
    transaction(() => {
      const before = getBill(id);
      if (!before) throw new Error("That yearly bill does not exist.");
      const updated = { ...before, ...patch };
      db.prepare(`UPDATE yearly_bills SET label=@label, payee_key=@payeeKey,
        account_id=@accountId, archived_at=@archivedAt WHERE id=@id`).run(updated);
      log("yearly_bill", id, "bill", before, getBill(id));
    });
  }
  function listShares(planId?: string): YearlyShare[] {
    if (planId !== undefined) return readYearlyShares(db, planId);
    return db.prepare<[], YearlyShare>(shareColumns + " ORDER BY plan_id, bill_id").all();
  }
  function setShares(billId: number, shares: Omit<YearlyShare, "billId">[]): void {
    transaction(() => {
      const before = db.prepare<[number], YearlyShare>(shareColumns + " WHERE bill_id=? ORDER BY plan_id").all(billId);
      const old = new Map(before.map(share => [share.planId, share]));
      const wanted = new Set(shares.map(share => share.planId));
      if (wanted.size !== shares.length) throw new Error("A bill can have only one share in each budget.");
      const removed = before.filter(share => !wanted.has(share.planId));
      const changed = shares.filter(share => {
        const previous = old.get(share.planId);
        return !previous || previous.planningCategory !== share.planningCategory || previous.cents !== share.cents
          || previous.yearlyCents !== (share.yearlyCents ?? null);
      });
      if (!removed.length && !changed.length) return;
      const drop = db.prepare("DELETE FROM yearly_bill_shares WHERE bill_id=? AND plan_id=?");
      for (const share of removed) drop.run(billId, share.planId);
      const save = db.prepare(`INSERT INTO yearly_bill_shares (bill_id, plan_id, planning_category, cents, yearly_cents, created_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(bill_id, plan_id) DO UPDATE SET
        planning_category=excluded.planning_category, cents=excluded.cents, yearly_cents=excluded.yearly_cents`);
      for (const share of changed) save.run(billId, share.planId, share.planningCategory, share.cents, share.yearlyCents ?? null, timestamp());
      log("yearly_bill", billId, "shares", before, shares.map(share => ({ billId, ...share })));
    });
  }
  function getRaise(id: number): Raise {
    const row = db.prepare<[number], RaiseRow>(raises + " WHERE id=?").get(id);
    if (!row) throw new Error("That raise does not exist.");
    return raiseFrom(row);
  }
  function updateRaise(id: number, patch: Partial<NewRaise & { archivedAt: string | null }>) {
    transaction(() => {
      const before = getRaise(id);
      const updated = { ...before, ...patch };
      db.prepare(`UPDATE budget_raises SET planning_category=@planningCategory, label=@label, amount_cents=@amountCents,
        when_kind=@whenKind, month=@month, month_of_year=@monthOfYear, calendar_id=@calendarId, holiday_key=@holidayKey,
        count_in=@countIn, archived_at=@archivedAt WHERE id=@id`).run({ ...updated, ...whenColumns(updated.when) });
      log("raise", id, "raise", before, updated);
    });
  }
  function listCalendars(): HolidayCalendar[] {
    return db.prepare<[], Omit<HolidayCalendar, "source" | "on"> & { enabled: number }>(`SELECT id, name, "on" AS enabled,
      imported_at AS importedAt, covers_through AS coversThrough FROM holiday_calendars ORDER BY id`)
      .all().map(({ enabled, ...c }) => ({ ...c, source: "imported", on: !!enabled }));
  }
  function calendarById(id: string) {
    const calendar = listCalendars().find(c => c.id === id);
    if (!calendar) throw new Error("That calendar does not exist.");
    return calendar;
  }
  return {
    transaction, getBill, listTerms, setTerms, updateBill, updateRaise, listCalendars, listShares, setShares,
    deleteShares(billId: number) { setShares(billId, []); },
    /** The bill's yearly amount when it was added, from its creation record in the change log; null when none. */
    signupYearlyCents(billId: number): number | null {
      const saved = db.prepare<[string], string>(`SELECT new_value FROM change_log WHERE entity_type='yearly_bill' AND entity_id=?
        AND field='bill' AND old_value IS NULL ORDER BY id LIMIT 1`).pluck().get(String(billId));
      if (!saved) return null;
      const bill = JSON.parse(saved) as Partial<YearlyBill>;
      return typeof bill.amountCents === "number" && Array.isArray(bill.months) ? bill.amountCents * bill.months.length : null;
    },
    listBills(includeArchived = false) {
      return db.prepare<[], BillRow>(bills + (includeArchived ? "" : " WHERE archived_at IS NULL") + " ORDER BY id").all().map(billFrom);
    },
    addBill(b: NewBill): YearlyBill {
      return transaction(() => {
        const date = now();
        const inserted = db.prepare(`INSERT INTO yearly_bills (planning_category, label, payee_key, account_id, amount_cents, months, created_at)
          VALUES (@planningCategory, @label, @payeeKey, @accountId, @amountCents, @months, @createdAt)`)
          .run({ ...b, months: JSON.stringify(b.months), createdAt: date.toISOString() });
        const id = Number(inserted.lastInsertRowid);
        setTerms({ billId: id, fromYear: date.getFullYear(), planningCategory: b.planningCategory, amountCents: b.amountCents, months: b.months });
        const saved = getBill(id)!;
        log("yearly_bill", id, "bill", null, saved);
        return saved;
      });
    },
    archiveBill(id: number) { updateBill(id, { archivedAt: timestamp() }); },
    listEvents(): BillEvent[] {
      return db.prepare<[], BillEvent>(`SELECT id, bill_id AS billId, obligation_year AS obligationYear, due_month AS dueMonth,
        kind, source_transaction_id AS sourceTransactionId, created_at AS createdAt FROM yearly_bill_events ORDER BY id`).all();
    },
    addEvent(e: Omit<BillEvent, "id" | "createdAt">): BillEvent {
      return transaction(() => {
        const createdAt = timestamp();
        const result = db.prepare(`INSERT INTO yearly_bill_events (bill_id, obligation_year, due_month, kind, source_transaction_id, created_at)
          VALUES (@billId, @obligationYear, @dueMonth, @kind, @sourceTransactionId, @createdAt)`).run({ ...e, createdAt });
        const saved = { ...e, id: Number(result.lastInsertRowid), createdAt };
        log("yearly_bill", e.billId, "event", null, saved);
        return saved;
      });
    },
    listRaises(includeArchived = false) {
      return db.prepare<[], RaiseRow>(raises + (includeArchived ? "" : " WHERE archived_at IS NULL") + " ORDER BY id").all().map(raiseFrom);
    },
    addRaise(r: NewRaise): Raise {
      return transaction(() => {
        const result = db.prepare(`INSERT INTO budget_raises (planning_category,label,amount_cents,when_kind,month,month_of_year,
          calendar_id,holiday_key,count_in,created_at) VALUES (@planningCategory,@label,@amountCents,@whenKind,@month,@monthOfYear,
          @calendarId,@holidayKey,@countIn,@createdAt)`).run({ ...r, ...whenColumns(r.when), createdAt: timestamp() });
        const saved = getRaise(Number(result.lastInsertRowid));
        log("raise", saved.id, "raise", null, saved);
        return saved;
      });
    },
    archiveRaise(id: number) { updateRaise(id, { archivedAt: timestamp() }); },
    saveCalendar(c: HolidayCalendar) {
      transaction(() => {
        const before = listCalendars().find(v => v.id === c.id);
        db.prepare(`INSERT INTO holiday_calendars (id, name, "on", imported_at, covers_through)
          VALUES (@id, @name, @enabled, @importedAt, @coversThrough) ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, "on"=excluded."on", imported_at=excluded.imported_at, covers_through=excluded.covers_through`)
          .run({ ...c, enabled: Number(c.on) });
        log("holiday_calendar", c.id, "calendar", before, c);
      });
    },
    setCalendarOn(id: string, on: boolean) {
      transaction(() => {
        const before = calendarById(id);
        if (before.on === on) return;
        db.prepare('UPDATE holiday_calendars SET "on"=? WHERE id=?').run(Number(on), id);
        log("holiday_calendar", id, "on", before.on, on);
      });
    },
    deleteCalendar(id: string) {
      transaction(() => {
        const before = calendarById(id);
        db.prepare("DELETE FROM holiday_calendars WHERE id=?").run(id);
        log("holiday_calendar", id, "calendar", before, null);
      });
    },
    replaceHolidaysFrom(calendarId: string, fromDate: string, holidays: Holiday[]) {
      transaction(() => {
        const removed = db.prepare("DELETE FROM holidays WHERE calendar_id=? AND start_date>=?").run(calendarId, fromDate);
        const insert = db.prepare(`INSERT INTO holidays (calendar_id, key, name, start_date, end_date) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(calendar_id, key, start_date) DO UPDATE SET name=excluded.name, end_date=excluded.end_date`);
        for (const h of holidays) insert.run(calendarId, h.key, h.name, h.start, h.end);
        log("holiday_calendar", calendarId, "holidays", removed.changes, holidays.length);
      });
    },
    listHolidays(calendarIds?: string[]): Holiday[] {
      if (calendarIds?.length === 0) return [];
      const where = calendarIds ? " WHERE calendar_id IN (" + calendarIds.map(() => "?").join(",") + ")" : "";
      return db.prepare<string[], Holiday>(`SELECT calendar_id AS calendarId, key, name, start_date AS start, end_date AS end
        FROM holidays` + where + " ORDER BY start_date, calendar_id, key").all(...(calendarIds ?? []));
    },
  };
}

export type YearlyCostsStore = ReturnType<typeof yearlyCostsStore>;
