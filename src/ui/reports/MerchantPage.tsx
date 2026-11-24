// src/ui/reports/MerchantPage.tsx
//
// A page per merchant. Its own link, #/reports/merchant?name=...&period...&back=..., reached from
// a merchant's name on Reports (grouped by merchant) and on Transactions.
//
// In reading order: the total spent (with the purchases and refunds behind it),
// the monthly average over COMPLETE months only (a partial month would change the
// average every day), money received when there is any, the bank names behind the
// merchant, a chart of spending by month, and its transactions.
//
// The figures come from the same report entries Reports uses (classify and the
// counted accounts), so this page and the Reports line for the merchant agree.
// The transactions listed are exactly the rows behind the figures; transfers and
// accounts that are not counted are left out and counted in a note.
//
// The chart is drawn by the shared chart base (src/ui/charts); the registry's bar blocks are Pro and
// built on Recharts. The transactions are a plain table, as Reports' tables are.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import ChartBase from "../charts/ChartBase";
import type { ChartMark, ChartSeries } from "../charts/types";

import {
  loadDb,
  getTransactionsUI,
  getAccountsUI,
  getRulesUI,
  getTransactionAdjustmentsUI,
  getCategoryMappingsUI,
  getMerchantRenamesUI,
  getZelleMemoNamesUI,
  type Db,
} from "../lib/db";
import { prepareTransactions } from "../../domain/pipeline";
import { reportEntries, reportRange } from "../../domain/report-view";
import { bankNamesFor, merchantFigures, merchantOf, renameMap, type MerchantRename } from "../../domain/merchants";
import { EMPTY_FILTER, filterRows, toRows } from "../../domain/transactions-view";
import { formatCents } from "../../domain/money";
import {
  formatDateRange,
  formatMonthShort,
  formatShortDate,
  isPartialMonth,
  monthBounds,
  clampToPeriod,
  type Period,
} from "../../domain/period";
import { periodAsOf, usePeriod } from "../lib/period-store";
import { ledgerHref, type LedgerSpec } from "../lib/ledger-link";
import { merchantHref, parseMerchantQuery } from "../lib/merchant-link";
import { Figure, MONEY, PartialMonthNote } from "./shared";
import type { Account, NormalizedTxn } from "../../domain/types";
import type { CategorizationRule } from "../../domain/rules";
import type { TransactionAdjustment } from "../../domain/adjustments";

export interface MerchantPageDataLayer {
  loadDb: () => Promise<Db>;
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getRules: (db: Db) => Promise<CategorizationRule[]>;
  getAdjustments: (db: Db) => Promise<TransactionAdjustment[]>;
  getCategoryMappings: (db: Db) => Promise<Record<string, string>>;
  getMerchantRenames: (db: Db) => Promise<MerchantRename[]>;
  /** Settings, Merchants: old Zelle rows named by the person in the note. */
  getZelleMemoNames: (db: Db) => Promise<boolean>;
}

const defaultDataLayer: MerchantPageDataLayer = {
  loadDb,
  getTransactions: getTransactionsUI,
  getAccounts: getAccountsUI,
  getRules: getRulesUI,
  getAdjustments: getTransactionAdjustmentsUI,
  getCategoryMappings: getCategoryMappingsUI,
  getMerchantRenames: getMerchantRenamesUI,
  getZelleMemoNames: getZelleMemoNamesUI,
};

export interface MerchantPageProps {
  dataLayer?: Partial<MerchantPageDataLayer>;
  /** The merchant's shown name. Read from the link when not given. */
  name?: string;
  /** Overrides the shared period; tests pin it. */
  period?: Period;
  /** Today, YYYY-MM-DD; tests pin it. */
  today?: string;
  /** Where Back goes. Read from the link when not given. */
  back?: string;
}

interface Loaded {
  prepared: NormalizedTxn[];
  accounts: Account[];
  mapping: Record<string, string>;
  renames: MerchantRename[];
  zelleByMemo: boolean;
}

function fromLink(): { name: string; back: string } {
  const hash = window.location.hash;
  const at = hash.indexOf("?");
  return parseMerchantQuery(new URLSearchParams(at < 0 ? "" : hash.slice(at + 1)));
}

const months = (n: number) => `${n} complete ${n === 1 ? "month" : "months"}`;

/** What was spent at the merchant each month, one bar a month; a click opens that month's transactions. */
function MerchantChart({ name, months, byMonth, rangeTo, onOpen }: {
  name: string;
  months: string[];
  byMonth: Record<string, number>;
  rangeTo: string;
  onOpen: (month: string) => void;
}) {
  const series = useMemo<ChartSeries[]>(
    () => [{ id: "spent", label: "Spent", role: "actual", mark: "bar", barMaxWidth: 64, points: months.map((m) => ({ x: m, cents: byMonth[m] ?? 0 })) }],
    [months, byMonth],
  );
  // A zero line only when a month nets below zero (refunds beat purchases).
  const marks = useMemo<ChartMark[]>(() => (months.some((m) => (byMonth[m] ?? 0) < 0) ? [{ kind: "hline", cents: 0, role: "actual" }] : []), [months, byMonth]);
  const formatX = useCallback((m: string) => formatMonthShort(m) + (isPartialMonth(m, rangeTo) ? "*" : ""), [rangeTo]);
  const total = months.reduce((n, m) => n + (byMonth[m] ?? 0), 0);
  return (
    <ChartBase
      title={`Spent at ${name} by month`}
      description={`${formatCents(total)} spent at ${name} across ${months.length} ${months.length === 1 ? "month" : "months"}.`}
      axis="category"
      series={series}
      marks={marks}
      formatX={formatX}
      legend={false}
      onMarkClick={(m) => onOpen(m.x)}
      height={256}
    />
  );
}

export default function MerchantPage({ dataLayer, name: pinnedName, period: pinned, today: pinnedToday, back: pinnedBack }: MerchantPageProps) {
  const shared = usePeriod();
  const period = pinned ?? shared;
  const today = pinnedToday ?? periodAsOf();
  const [link, setLink] = useState(fromLink);
  useEffect(() => {
    const read = () => setLink(fromLink());
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const name = pinnedName ?? link.name;
  const back = pinnedBack ?? link.back;

  const deps = useMemo<MerchantPageDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);
  const dbRef = useRef<Db | null>(null);
  const [phase, setPhase] = useState<"loading" | "unavailable" | "ready">("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const reload = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    const [txns, accounts, rules, adjustments, mapping, renames, zelleByMemo] = await Promise.all([
      deps.getTransactions(db),
      deps.getAccounts(db),
      deps.getRules(db),
      deps.getAdjustments(db),
      deps.getCategoryMappings(db),
      // An extra: with no list, every merchant shows the bank's name.
      deps.getMerchantRenames(db).catch(() => [] as MerchantRename[]),
      deps.getZelleMemoNames(db).catch(() => false),
    ]);
    // Rules and corrections read the bank's name, exactly as everywhere else.
    const prepared = prepareTransactions(txns, { rules, adjustments, accounts, mapping });
    setLoaded({ prepared, accounts, mapping, renames, zelleByMemo });
  }, [deps]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await deps.loadDb();
        if (cancelled) return;
        dbRef.current = db;
        await reload();
        if (!cancelled) setPhase("ready");
      } catch {
        if (!cancelled) setPhase("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps, reload]);

  const view = useMemo(() => {
    if (!loaded) return null;
    const renames = renameMap(loaded.renames, { zelleByMemo: loaded.zelleByMemo });
    const nameOf = (t: NormalizedTxn) => merchantOf(t, renames);
    let earliest: string | null = null;
    let latest: string | null = null;
    for (const t of loaded.prepared) {
      const day = t.date.slice(0, 10);
      if (earliest == null || day < earliest) earliest = day;
      if (latest == null || day > latest) latest = day;
    }
    const end = latest && latest > today ? latest : today;
    const range = reportRange(period, earliest, end);
    if (!range) return null;
    const mine = (side: "expense" | "income") =>
      reportEntries(loaded.prepared, loaded.accounts, loaded.mapping, side, nameOf).filter((e) => e.merchant === name);
    const figures = merchantFigures(mine("expense"), mine("income"), range, today);
    const rows = toRows(loaded.prepared, loaded.accounts, loaded.mapping, renames);
    const dated = { ...EMPTY_FILTER, merchants: [name], from: range.from, to: range.to };
    const listed = filterRows(rows, { ...dated, countedAccountsOnly: true }).filter((r) => r.kind === "expense" || r.kind === "income");
    const everything = filterRows(rows, { ...dated, transfers: "include" });
    return {
      range,
      figures,
      listed,
      leftOut: everything.length - listed.length,
      bankNames: bankNamesFor(loaded.prepared, renames, name),
    };
  }, [loaded, period, today, name]);

  if (phase === "loading") return <Skeleton className="h-96 w-full" />;
  if (phase === "unavailable") {
    return <p className="text-sm text-muted-foreground">The local server is not reachable. Restart the app.</p>;
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-heading text-lg font-semibold">{name || "Merchant"}</h2>
      <div className="flex gap-3 text-sm">
        <a href={back} className="underline-offset-4 hover:underline">
          Back
        </a>
        <a href="#/settings/merchants" className="underline-offset-4 hover:underline">
          Rename or merge merchants
        </a>
      </div>
    </div>
  );

  if (!view || (view.listed.length === 0 && view.figures.spentCents === 0 && view.figures.receivedCents === 0)) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-sm text-muted-foreground">
          No transactions named {name || "this"} over {view ? formatDateRange(view.range.from, view.range.to) : "these dates"}. Pick a
          longer period in the top bar.
        </p>
      </div>
    );
  }

  const { range, figures } = view;
  const rangeTo = period.to ?? today;
  const self = merchantHref(name, back, period);
  const periodDates = { from: period.from, to: period.to };
  const spec = (dates: { from: string | null; to: string | null }, kind: "expense" | "income" = "expense"): LedgerSpec => ({
    label: name,
    back: self,
    kind,
    merchants: [name],
    ...dates,
  });
  const open = (month: string) => {
    window.location.hash = ledgerHref(spec(clampToPeriod(monthBounds(month), period)));
  };
  const complete = figures.completeMonths;

  return (
    <div className="flex flex-col gap-4">
      {header}
      <Card>
        <CardHeader>
          <CardDescription>Merchant, {formatDateRange(range.from, range.to)}</CardDescription>
          <p className="font-heading text-xl font-semibold">
            Spent{" "}
            <span data-testid="merchant-spent" className={MONEY}>
              {formatCents(figures.spentCents)}
            </span>
          </p>
          {figures.refundsCents > 0 && (
            <p className="text-sm text-muted-foreground">
              <span data-testid="merchant-purchases" className={MONEY}>
                {formatCents(figures.purchasesCents)}
              </span>{" "}
              of purchases, less{" "}
              <span data-testid="merchant-refunds" className={MONEY}>
                {formatCents(figures.refundsCents)}
              </span>{" "}
              that came back as refunds and credits.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {figures.averageCents != null && (
              <>
                <span data-testid="merchant-average" className={`${MONEY} text-foreground`}>
                  {formatCents(figures.averageCents)}
                </span>{" "}
                a month on average,{" "}
              </>
            )}
            <span data-testid="merchant-average-note">
              {figures.averageCents != null
                ? `over the ${months(complete.length)}, ${
                    complete.length === 1
                      ? formatMonthShort(complete[0])
                      : `${formatMonthShort(complete[0])} to ${formatMonthShort(complete[complete.length - 1])}`
                  }. A month the period cuts short, or one not over yet, is left out of the average.`
                : "No complete month in this period yet, so there is no monthly average."}
            </span>
          </p>
          {figures.receivedCents !== 0 && (
            <p className="text-sm text-muted-foreground">
              Also received{" "}
              <span data-testid="merchant-received" className={MONEY}>
                {formatCents(figures.receivedCents)}
              </span>{" "}
              from {name}.
            </p>
          )}
          <p data-testid="merchant-bank-names" className="text-xs text-muted-foreground">
            {view.bankNames.length === 1 ? "Bank name" : "Bank names"}: {view.bankNames.join(", ")}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">Click a month to see its transactions.</p>
            <MerchantChart name={name} months={figures.months} byMonth={figures.byMonth} rangeTo={rangeTo} onOpen={open} />
            <PartialMonthNote periods={figures.months} rangeTo={rangeTo} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Its transactions, newest first</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="overflow-x-auto">
            <table data-testid="merchant-transactions" className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Account</th>
                  <th className="pb-2 pr-4">Bank name</th>
                  <th className="pb-2 pr-4">Category</th>
                  <th className="pb-2 pl-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {view.listed.map((r) => (
                  <tr key={r.txn.sourceTransactionId} data-testid={`merchant-row-${r.txn.sourceTransactionId}`} className="border-b last:border-0">
                    <td className={`py-1.5 pr-4 whitespace-nowrap ${MONEY}`}>{formatShortDate(r.txn.date, today)}</td>
                    <td className="py-1.5 pr-4">{r.accountName}</td>
                    <td className="py-1.5 pr-4 text-muted-foreground">{r.txn.payee ?? r.txn.merchant ?? r.txn.description ?? ""}</td>
                    <td className="py-1.5 pr-4">{r.planningCategory}</td>
                    <td className={`py-1.5 pl-4 text-right whitespace-nowrap ${MONEY}`}>{formatCents(r.txn.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td colSpan={4} className="py-1.5">
                    Spent
                  </td>
                  <td className={`py-1.5 pl-4 text-right whitespace-nowrap ${MONEY}`}>
                    <Figure cents={figures.spentCents} spec={spec(periodDates)} />
                  </td>
                </tr>
                {figures.receivedCents !== 0 && (
                  <tr className="font-medium">
                    <td colSpan={4} className="py-1.5">
                      Received
                    </td>
                    <td className={`py-1.5 pl-4 text-right whitespace-nowrap ${MONEY}`}>
                      <Figure cents={figures.receivedCents} spec={spec(periodDates, "income")} />
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
          {view.leftOut > 0 && (
            <p data-testid="merchant-left-out" className="pt-3 text-xs text-muted-foreground">
              {view.leftOut === 1
                ? "1 more transaction with this name is a transfer between your own accounts, or on an account that is not counted, and is left out. "
                : `${view.leftOut} more transactions with this name are transfers between your own accounts, or on accounts that are not counted, and are left out. `}
              <a
                href={ledgerHref({ label: name, back: self, merchants: [name], ...periodDates, countedAccountsOnly: false, transfers: "include" })}
                className="underline-offset-4 hover:underline"
              >
                See every transaction named {name}
              </a>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
