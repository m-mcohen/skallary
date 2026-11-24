import { expect, test } from "vitest";
import { renameMap } from "../../src/domain/merchants";
import type { Holiday } from "../../src/domain/holidays";
import type { RecurringSeries } from "../../src/domain/recurring";
import type { MonthlyRollup } from "../../src/domain/rollups";
import type { NormalizedTxn } from "../../src/domain/types";
import { proposeBills, proposeRaises } from "../../src/domain/yearly-proposals";
import type { Raise, YearlyBill } from "../../src/domain/yearly-costs";

const TODAY = "2027-01-15";
function series(label: string, cadence: RecurringSeries["cadence"], cents: number, lastSeen: string, nextExpected: string): RecurringSeries {
  return { key: label.toLowerCase(), label, accountId: "acc-1", accountIds: ["acc-1"], cadence, typicalAmountCents: -cents, amountBandCents: 0,
    lastSeen, nextExpected, occurrenceCount: 3, lastFewAmounts: [-cents], planningCategory: "Insurance",
    charges: [{ id: label + "-last", date: lastSeen, amountCents: -cents }], source: "found", markAmountCents: null };
}
function txn(id: string, date: string, cents: number, payee: string, category = "Memberships"): NormalizedTxn {
  return { sourceTransactionId: id, accountId: "acc-1", date, amountCents: -cents, payee, merchant: payee, sourceCategory: category, isTransfer: false, sourceUpdatedAt: null };
}
function bill(over: Partial<YearlyBill>): YearlyBill {
  return { id: 1, planningCategory: "Insurance", label: "City Permit", payeeKey: "city permit", accountId: null, amountCents: 20_000, months: ["05"],
    createdAt: "2026-01-01", archivedAt: null, ...over };
}
const billInput = (over: object = {}) => ({
  series: [series("Acme Insurance", "annual", 60_000, "2026-03-14", "2027-03-14"), series("City Water", "quarterly", 9_000, "2026-12-10", "2027-03-10"),
    series("Streamco", "monthly", 1_500, "2027-01-03", "2027-02-03"), series("City Permit", "annual", 20_000, "2026-05-02", "2027-05-02")],
  prepared: [txn("d1", "2025-08-02", 15_000, "Club Dues"), txn("d2", "2026-07-30", 15_500, "Club Dues")],
  mapping: {}, choices: [], bills: [bill({})], renames: renameMap([]), today: TODAY, ...over });

test("bills proposed: yearly and quarterly charges from history, and a yearly charge seen twice; not monthly ones or ones on the list", () => {
  expect(proposeBills(billInput()).map((p) => [p.label, p.months, p.shareCents])).toEqual([
    ["Acme Insurance", ["03"], 5_000], ["City Water", ["03", "06", "09", "12"], 3_000], ["Club Dues", ["07"], 1_292],
  ]);
});
test("a yearly charge seen twice takes the later amount, is not proposed once marked not recurring, and not when it is over 400 days old", () => {
  const [club] = proposeBills(billInput({ series: [] }));
  expect(club).toMatchObject({ label: "Club Dues", amountCents: 15_500, lastPaid: "2026-07-30", planningCategory: "Memberships" });
  const hidden = [{ payeeKey: "club dues", accountId: "acc-1", choice: "not_recurring" as const, cadence: null, label: "Club Dues", createdAt: "x" }];
  expect(proposeBills(billInput({ series: [], choices: hidden }))).toEqual([]);
  expect(proposeBills(billInput({ series: [], today: "2027-09-05" }))).toEqual([]);
});

const FEST = (calendarId = "imported-1"): Holiday[] => [
  { calendarId, key: "spring-festival", name: "Spring Festival", start: "2025-04-12", end: "2025-04-13" },
  { calendarId, key: "spring-festival", name: "Spring Festival", start: "2026-04-01", end: "2026-04-02" },
  { calendarId, key: "harvest-moon", name: "Harvest Moon", start: "2025-04-20", end: "2025-04-20" },
  { calendarId, key: "harvest-moon", name: "Harvest Moon", start: "2026-04-15", end: "2026-04-15" },
];
const monthAt = (i: number) => (i < 12 ? "2025-" : "2026-") + String(i % 12 + 1).padStart(2, "0");
function history(): MonthlyRollup[] {
  const rows: MonthlyRollup[] = [];
  const line = (name: string, base: number, over: Record<string, number>) => {
    for (let i = 0; i < 24; i++) rows.push({ period: monthAt(i), planningCategory: name, kind: "expense", amountCents: over[monthAt(i)] ?? base });
  };
  line("Groceries", 50_000, { "2025-04": 80_000, "2026-04": 76_000 });
  line("Clothing", 10_000, { "2025-08": 40_000, "2026-08": 40_000 });
  line("Dining", 20_000, { "2026-04": 60_000 });
  line("Household", 20_000, { "2025-06": 25_000, "2026-06": 24_000 });
  line("Charity", 10_000, { "2025-04": 90_000, "2026-04": 90_000 });
  return rows;
}
const raiseInput = (over: object = {}) => ({ rollups: history(), holidays: FEST(), raises: [] as Raise[], today: TODAY, ...over });

test("raises proposed where a line runs well over its usual month in the same holiday or month two years running", () => {
  expect(proposeRaises(raiseInput()).map((p) => [p.planningCategory, p.when, p.amountCents])).toEqual([
    ["Groceries", { kind: "holiday", calendarId: "imported-1", holidayKey: "spring-festival", countIn: "start" }, 28_000],
    ["Clothing", { kind: "every-year", monthOfYear: "08" }, 30_000],
  ]);
});
test("a raise already made for that line answers the same increase, so it is not proposed again", () => {
  const made: Raise = { id: 1, planningCategory: "Groceries", label: "Spring", amountCents: 1, createdAt: "2027-01-10T00:00:00Z", archivedAt: null,
    when: { kind: "every-year", monthOfYear: "04" } };
  expect(proposeRaises(raiseInput({ raises: [made] })).map((p) => p.planningCategory)).toEqual(["Clothing"]);
  expect(proposeRaises(raiseInput({ raises: [{ ...made, archivedAt: "2027-01-12T00:00:00Z" }] })).map((p) => p.planningCategory)).toEqual(["Groceries", "Clothing"]);
});
test("a line's base is its median, so big months in a row do not hide each other", () => {
  const big = ["2025-08", "2026-08", "2025-09", "2026-09", "2025-10", "2026-10"];
  const rows: MonthlyRollup[] = Array.from({ length: 24 }, (_, i) =>
    ({ period: monthAt(i), planningCategory: "Travel", kind: "expense" as const, amountCents: big.includes(monthAt(i)) ? 16_000 : 10_000 }));
  expect(proposeRaises(raiseInput({ rollups: rows, holidays: [] })).map((p) => p.when)).toEqual([
    { kind: "every-year", monthOfYear: "08" }, { kind: "every-year", monthOfYear: "09" }, { kind: "every-year", monthOfYear: "10" }]);
});
