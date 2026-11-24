// src/ui/recurring/RecurringMonthList.tsx -- one month's recurring charges, one
// row each: the name (opens its payments), how
// often and on which account, the amount, and when ("In 3 days", "Not charged
// yet, due Oct 3", "Paid Oct 2"). Paid rows are muted and come last.
import { formatCents } from "../../domain/money";
import { CADENCE_LABELS } from "../../domain/recurring-choices";
import { whenText, type RecurringMonth } from "../../domain/recurring-month";
import type { RecurringSeries } from "../../domain/recurring";
import { ledgerHref } from "../lib/ledger-link";

/**
 * A charge's figure is a USUAL amount, not a total, so its name opens the
 * payments behind it: every account it was charged on, that merchant key, every
 * date. The ledger lists exactly the payments the detector counted
 * (tests/domain/recurring-ledger.test.ts) and claims no total.
 */
export function SeriesLink({ s, back, className }: { s: RecurringSeries; back: string; className?: string }) {
  return (
    <a
      data-ledger="1"
      href={ledgerHref({
        label: s.label,
        back,
        accountIds: s.accountIds,
        payeeKey: s.key,
        countedAccountsOnly: false,
        view: "series",
      })}
      className={`underline-offset-4 hover:underline ${className ?? ""}`}
    >
      {s.label}
    </a>
  );
}

export default function RecurringMonthList({
  month,
  accountNames,
  asOf,
  back,
  limit,
}: {
  month: RecurringMonth;
  accountNames: Record<string, string>;
  asOf: string;
  /** Where the payments ledger's Back returns to. */
  back: string;
  limit?: number;
}) {
  const items = limit == null ? month.items : month.items.slice(0, limit);
  return (
    <ul className="flex flex-col divide-y">
      {items.map((item) => {
        const s = item.series;
        const paid = item.status === "paid";
        return (
          <li
            key={`${s.accountId}|${s.key}|${item.date}|${item.status}`}
            data-testid={`recurring-row-${s.label}`}
            className={`flex items-center gap-3 py-2 ${paid ? "text-muted-foreground" : ""}`}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <SeriesLink s={s} back={back} className="truncate text-sm font-medium" />
              <span className="truncate text-xs text-muted-foreground">
                {CADENCE_LABELS[s.cadence]} &middot; {accountNames[s.accountId] ?? "Unknown account"}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end">
              <span className="font-mono text-sm tabular-nums">{formatCents(item.amountCents)}</span>
              <span className={`text-xs ${item.status === "late" ? "text-destructive" : "text-muted-foreground"}`}>
                {whenText(item, asOf)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
