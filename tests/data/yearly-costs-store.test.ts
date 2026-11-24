import { expect, test } from "vitest";
import { dumpSchema } from "../../scripts/schema-dump";
import { applyMigrations } from "../../src/data/migrate.node";
import { NodeRepository } from "../../src/data/repo.node";
import { yearlyCostsStore } from "../../src/data/yearly-costs.store";

test("yearly costs and holiday migrations create their tables only once", () => {
  const db = new NodeRepository(":memory:").connection();
  try {
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").pluck().all();
    expect(tables).toEqual(expect.arrayContaining(["yearly_bills", "yearly_bill_events", "yearly_bill_terms", "budget_raises", "yearly_bill_shares", "holiday_calendars", "holidays"]));
    expect(db.prepare("SELECT name FROM pragma_table_info('yearly_bill_shares')").pluck().all()).toContain("yearly_cents");
    const before = dumpSchema(db);
    applyMigrations(db);
    expect(dumpSchema(db)).toBe(before);
    // A share is deleted with its plan (checked with foreign keys on, as the scenarios test does).
    db.pragma("foreign_keys = ON");
    db.prepare("INSERT INTO plans (id, name, start_date, end_date, created_at) VALUES ('toy-plan', 'Toy plan', '2027-01-01', '2027-12-31', 'x')").run();
    const bill = yearlyCostsStore(db, () => new Date("2027-02-10T12:00:00Z")).addBill({ planningCategory: "Insurance", label: "Toy", payeeKey: "toy", accountId: null, amountCents: null, months: ["03"] });
    db.prepare("INSERT INTO yearly_bill_shares (bill_id, plan_id, planning_category, cents, created_at) VALUES (?, 'toy-plan', 'Insurance', 100, 'x')").run(bill.id);
    db.prepare("DELETE FROM plans WHERE id='toy-plan'").run();
    expect(db.prepare("SELECT COUNT(*) FROM yearly_bill_shares").pluck().get()).toBe(0);
  } finally { db.close(); }
});

test("yearly records read back with their terms and change history", () => {
  const db = new NodeRepository(":memory:").connection();
  try {
    const clock = { value: new Date("2027-02-10T12:00:00Z") };
    const s = yearlyCostsStore(db, () => clock.value);
    const bill = s.addBill({ planningCategory: "Insurance", label: "Toy policy", payeeKey: "storybook cover", accountId: null, amountCents: null, months: ["03", "09"] });
    s.addEvent({ billId: bill.id, obligationYear: 2027, dueMonth: "2027-03", kind: "ticked", sourceTransactionId: null });
    const when = { kind: "holiday", calendarId: "imported-1", holidayKey: "spring-festival", countIn: "end" } as const;
    s.addRaise({ planningCategory: "Groceries", label: "Spring Festival", amountCents: 25000, when });
    const calendar = { id: "imported-1", source: "imported", name: "Toy festivals", on: false, importedAt: null, coversThrough: null } as const;
    s.saveCalendar(calendar);
    expect(s.getBill(bill.id)).toMatchObject({ amountCents: null, months: ["03", "09"], archivedAt: null });
    expect(s.listTerms(bill.id)).toEqual([{ billId: bill.id, fromYear: 2027, planningCategory: "Insurance", amountCents: null, months: ["03", "09"], createdAt: "2027-02-10T12:00:00.000Z" }]);
    // Replacing terms from a year removes later rows and restamps; updateBill never writes terms.
    s.setTerms({ billId: bill.id, fromYear: 2029, planningCategory: "Insurance", amountCents: 500, months: ["03"] });
    clock.value = new Date("2027-06-01T12:00:00Z");
    s.setTerms({ billId: bill.id, fromYear: 2028, planningCategory: "Insurance", amountCents: 900, months: ["04"] });
    expect(s.listTerms(bill.id).map(r => [r.fromYear, r.amountCents, r.createdAt])).toEqual([
      [2027, null, "2027-02-10T12:00:00.000Z"], [2028, 900, "2027-06-01T12:00:00.000Z"]]);
    s.updateBill(bill.id, { label: "Toy policy 2" });
    expect(s.listTerms(bill.id)).toHaveLength(2);
    expect(s.listEvents()).toMatchObject([{ billId: bill.id, kind: "ticked", dueMonth: "2027-03" }]);
    expect(s.listRaises()[0].when).toEqual(when);
    expect(s.listCalendars()).toEqual([calendar]);
    expect(db.prepare("SELECT DISTINCT entity_type FROM change_log").pluck().all()).toEqual(expect.arrayContaining(["yearly_bill", "raise", "holiday_calendar"]));
  } finally { db.close(); }
});
