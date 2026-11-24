import { expect, test } from "vitest";
import { headsUp } from "../../src/domain/yearly-heads-up";
import type { BillOccurrence, Projection, Raise, YearlyBill } from "../../src/domain/yearly-costs";

const bill = (id: number, label: string): YearlyBill => ({ id, label, planningCategory: "Insurance", payeeKey: label.toLowerCase(), accountId: null, amountCents: 60000, months: ["01"], createdAt: "2025-01-01", archivedAt: null });
const occ = (billId: number, status: BillOccurrence["status"], dueMonth: string, paymentMonth: string, more: Partial<BillOccurrence> = {}): BillOccurrence =>
  ({ billId, obligationYear: Number(dueMonth.slice(0, 4)), dueMonth, paymentMonth, late: paymentMonth > dueMonth, placedMonths: [paymentMonth], status, expectedCents: 60000, paidCents: 0, matchedTxnIds: [], ...more });
const raise: Raise = { id: 9, planningCategory: "Gifts", label: "Holiday gifts", amountCents: 30000, when: { kind: "once", month: "2027-04" }, createdAt: "2025-01-01", archivedAt: null };

test("the heads-up lists what needs attention this month and next, and nothing else", () => {
  const bills = [1, 2, 3, 4, 5, 6, 7].map(id => bill(id, "Bill " + id));
  const p: Projection = {
    yearlyTxnIds: [],
    occurrences: [
      occ(7, "landed", "2027-03", "2027-03"),
      occ(6, "upcoming", "2027-05", "2027-05"),
      occ(5, "upcoming", "2027-04", "2027-04"),
      occ(4, "part-paid", "2027-03", "2027-03", { paidCents: 20000 }),
      occ(2, "late", "2027-02", "2027-03"),
      occ(1, "ask", "2026-11", "2027-02", { askReason: "still-exists" }),
    ],
    notices: [
      { kind: "calendar-runs-out", calendarId: "imported-1", coversThrough: "2027-06-01", raiseIds: [9] },
      { kind: "new-amount", billId: 3, obligationYear: 2027, dueMonth: "2027-01", fromCents: 60000, toCents: 65000 },
    ],
    bigMonths: [
      { id: -1, planId: "p", planningCategory: "Gifts", month: "2027-04", label: "Holiday gifts", amountCents: 30000, createdAt: "", origin: "raise", sourceId: 9 },
      { id: -2, planId: "p", planningCategory: "Gifts", month: "2027-08", label: "Holiday gifts", amountCents: 30000, createdAt: "", origin: "raise", sourceId: 9 },
    ],
  };
  expect(headsUp(p, bills, [raise], "2027-03-10").map((i) => [i.kind, i.month])).toEqual([
    ["ask", "2027-02"], ["late", "2027-03"], ["new-amount", null], ["calendar-runs-out", null],
    ["part-paid", "2027-03"], ["bill-due", "2027-04"], ["raise", "2027-04"],
  ]);
});
