// demo/write-yearly.ts -- the sample household's yearly costs, written through the app's own service: two
// yearly bills (one every three months), a raise tied to US Thanksgiving Day, and the US national holidays
// switched on. Every name and amount is invented. build-sample-db.ts calls it after the budget exists.
import { holidayKey } from "../src/domain/holidays.js";
import { addMonths } from "../src/domain/scenario.js";
import type { NormalizedTxn } from "../src/domain/types.js";
import type { RaiseWhen } from "../src/domain/yearly-costs.js";

export interface DemoBillInput {
  planningCategory: string; label: string; payeeKey: string; accountId: string | null; amountCents: number; months: string[];
}
export interface DemoRaiseInput { planningCategory: string; label: string; amountCents: number; when: RaiseWhen }

/** The bills' payees are the merchants the demo transactions already use, so the sample's payments match them. */
export const DEMO_YEARLY_BILLS: DemoBillInput[] = [
  { planningCategory: "Auto Insurance", label: "Car insurance", payeeKey: "guardian way auto insurance", accountId: null, amountCents: 120_000, months: ["03"] },
  { planningCategory: "Gas & Electric", label: "Water and sewer", payeeKey: "hillside water utility", accountId: null, amountCents: 9_000, months: [] },
];

/** The quarterly bill is due this month and every third month back from it, so a sample built any day has paid the earlier ones. */
const quarterly = (today: string) => [0, 3, 6, 9].map((back) => addMonths(today.slice(0, 7), -back).slice(5)).sort();

export const DEMO_RAISE: DemoRaiseInput = {
  planningCategory: "Shopping", label: "Thanksgiving gifts", amountCents: 30_000,
  when: { kind: "holiday", calendarId: "us-national", holidayKey: holidayKey("Thanksgiving Day"), countIn: "start" },
};

/** Run after LOCALAPPDATA points at the sample folder: the services open the database when called. */
export async function writeYearly(repo: { upsertTransactions(rows: NormalizedTxn[], source: "csv"): unknown }, accountId: string, today: string): Promise<void> {
  // The earlier water bills, as payments in the sample's ledger.
  const water = DEMO_YEARLY_BILLS[1];
  const months = quarterly(today);
  const paid: NormalizedTxn[] = [];
  // Each earlier due month of this year and last, so every due date lines up with its payment.
  const now = today.slice(0, 7);
  for (const year of [Number(now.slice(0, 4)) - 1, Number(now.slice(0, 4))]) {
    for (const mm of months) {
      const ym = `${year}-${mm}`;
      if (ym >= now) continue;
      paid.push({ sourceTransactionId: `demo-water-${ym}`, accountId, date: `${ym}-12`, amountCents: -water.amountCents, sourceCategory: water.planningCategory,
        merchant: "Hillside Water Utility", isTransfer: false, sourceUpdatedAt: null, description: "Hillside Water Utility", memo: "HILLSIDE WATER UTILITY",
        payee: "Hillside Water Utility", mcc: null, pending: false });
    }
  }
  // Renter's insurance, paid a year earlier too, so Suggestions from your history has something to suggest.
  const lastYear = `${Number(now.slice(0, 4)) - 1}-08`;
  paid.push({ sourceTransactionId: `demo-renters-${lastYear}`, accountId, date: `${lastYear}-05`, amountCents: -18_000, sourceCategory: "Renter's Insurance",
    merchant: "Homestead Renters Mutual", isTransfer: false, sourceUpdatedAt: null, description: "Homestead Renters Mutual", memo: "HOMESTEAD RENTERS MUTUAL",
    payee: "Homestead Renters Mutual", mcc: null, pending: false });
  repo.upsertTransactions(paid, "csv");
  const { holidayService } = await import("../server/services/holidayService.js");
  const { yearlyCostsService } = await import("../server/services/yearlyCostsService.js");
  holidayService().setUsNational(true);
  const service = yearlyCostsService();
  for (const bill of DEMO_YEARLY_BILLS) service.addBill({ ...bill, months: bill.months.length ? bill.months : months });
  service.addRaise(DEMO_RAISE);
}
