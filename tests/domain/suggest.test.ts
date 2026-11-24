import { expect, test } from "vitest";
import { averageMonth, billMonthly, suggestLine } from "../../src/domain/suggest";
import type { MonthlyRollup } from "../../src/domain/rollups";
import type { RecurringSeries } from "../../src/domain/recurring";

const r = (period: string, planningCategory: string, amountCents: number, kind: MonthlyRollup["kind"] = "expense"): MonthlyRollup =>
  ({ period, planningCategory, kind, amountCents });
const s = (planningCategory: string, cadence: RecurringSeries["cadence"], typicalAmountCents: number, source: "found" | "marked" = "found"): RecurringSeries => ({
  key: planningCategory + cadence, label: planningCategory, accountId: "a", accountIds: ["a"], cadence, typicalAmountCents,
  amountBandCents: 0, lastSeen: "2026-09-01", nextExpected: "2026-10-01", occurrenceCount: 3, lastFewAmounts: [],
  planningCategory, charges: [], source,
});

test("empty months count as zero, from the first month with spending, never the month in progress", () => {
  const rollups = [r("2026-03", "Clothing", 1200), r("2026-09", "Clothing", 600), r("2026-10", "Clothing", 99999)];
  // Include each month from the first spending month through the last completed month.
  expect(averageMonth(rollups, "Clothing", "expense", "2026-10", 12)).toEqual({ cents: Math.round(1800 / 7), months: 7, emptyMonths: 5 });
  expect(averageMonth(rollups, "Clothing", "expense", "2026-10", 3)).toEqual({ cents: 200, months: 3, emptyMonths: 2 });
});

test("a line that never spent has no average", () => {
  expect(averageMonth([], "Clothing", "expense", "2026-10", 12)).toBeNull();
});

test("bills: usual amount x payments a year / 12, summed over the line's series", () => {
  const got = billMonthly([s("Insurance", "monthly", -10000), s("Insurance", "annual", -60000), s("Rent", "monthly", -200000)], "Insurance");
  expect(got?.cents).toBe(10000 + 5000);
  expect(got?.bills.map((b) => b.cadence)).toEqual(["monthly", "annual"]);
  expect(billMonthly([s("Gym", "weekly", -1000)], "Gym")?.cents).toBe(Math.round((1000 * 52) / 12));
  expect(billMonthly([s("Gym", "biweekly", -1000)], "Gym")?.cents).toBe(Math.round((1000 * 26) / 12));
  expect(billMonthly([s("Gym", "quarterly", -3000)], "Gym")?.cents).toBe(1000);
});

test("the This repeats mark counts as a bill", () => {
  expect(billMonthly([s("Internet & Cable", "monthly", -8000, "marked")], "Internet & Cable")?.cents).toBe(8000);
});

test("a fixed line uses its bill; with no bill it falls back to the average; a variable line always averages", () => {
  const rollups = [r("2026-08", "Rent", 200000), r("2026-09", "Rent", 200000)];
  expect(suggestLine("Rent", true, rollups, [s("Rent", "monthly", -210000)], "2026-10")).toMatchObject({ amountCents: 210000, basis: { kind: "bill" } });
  expect(suggestLine("Rent", true, rollups, [], "2026-10")).toMatchObject({ amountCents: 200000, basis: { kind: "average", months: 2 } });
  expect(suggestLine("Rent", false, rollups, [s("Rent", "monthly", -210000)], "2026-10").basis.kind).toBe("average");
});

test("a line with no history suggests zero", () => {
  expect(suggestLine("Clothing", false, [], [], "2026-10")).toEqual({ planningCategory: "Clothing", amountCents: 0, basis: { kind: "average", months: 0, emptyMonths: 0 } });
});

test("with a yearly bill excluded, the suggestion drops its series and its charges", () => {
  const monthly = s("Insurance", "monthly", -10000);
  const annual = { ...s("Insurance", "annual", -60000), charges: [{ id: "toy-yearly", date: "2026-03-05", amountCents: -60000 }] };
  const rollups = [r("2026-02", "Insurance", 10000), r("2026-03", "Insurance", 70000)];
  const exclude = { txnIds: new Set(["toy-yearly"]), cents: new Map([["Insurance", new Map([["2026-03", 60000]])]]) };
  expect(suggestLine("Insurance", true, rollups, [monthly, annual], "2026-04", exclude).amountCents).toBe(10000);
  expect(suggestLine("Insurance", false, rollups, [], "2026-04", exclude).amountCents).toBe(10000);
});
