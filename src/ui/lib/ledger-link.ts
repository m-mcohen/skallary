// src/ui/lib/ledger-link.ts
//
// A click-through link: a summed figure on any screen opens Transactions as a
// ledger of the rows behind it. The whole filter rides in the hash query, so a
// ledger can be bookmarked, reloaded, and returned to with the back button.
//
// Everything read back from the query is validated. The address bar is user
// input, and a filter that silently differs from the figure that was clicked is
// the one failure this feature must not have.
import { validDate } from "../../domain/period";
import type { TxnFilter } from "../../domain/transactions-view";
import type { MaaserFigure } from "../../domain/maaser-pot";

const MAASER_FIGURES: MaaserFigure[] = ["income", "setAside", "givenCards", "givenPot", "reimbursed"];

export interface LedgerSpec {
  /** What was clicked, in the reader's words: "Groceries", "Net, August 2026". */
  label: string;
  /** Hash to return to, for example "#/reports?tab=spending". */
  back: string;
  categories?: string[];
  kind?: "expense" | "income" | "saving" | "investment_income" | null;
  /** YYYY-MM-DD, inclusive. */
  from?: string | null;
  to?: string | null;
  accountId?: string | null;
  /** Several accounts: a recurring charge that moved to a newer account record. Wins over accountId. */
  accountIds?: string[];
  /** One direction only: a category's purchases ("out") or the refunds and credits ("in"). */
  flow?: "out" | "in" | null;
  /** Defaults to true: a figure counts only accounts that are counted. */
  countedAccountsOnly?: boolean;
  /** Defaults to "exclude". An account's own activity wants "include". */
  transfers?: TxnFilter["transfers"];
  /**
   * The figure that was clicked is an AVERAGE: this ledger's total divided by
   * this many months. The ledger shows both, so the two still tie out.
   */
  divideBy?: number;
  /** A recurring series: the payments out of `accountId` to this payee key (rules.ts ruleKeyFor). */
  payeeKey?: string | null;
  /** Merchants by their shown name: a merchant's figure on Reports, or its page. */
  merchants?: string[];
  /** Every merchant except these: Reports' Other line when grouped by merchant. */
  exceptMerchants?: string[];
  /** The rows behind these maaser ledger figures (the Charity panel's drill-down). */
  maaser?: MaaserFigure[];
  /**
   * Set when the ledger is NOT a category total, so its header must not read as
   * one: an account's own activity, or the payments in a recurring series.
   */
  view?: LedgerViewKind;
}

export type LedgerViewKind = "account" | "series" | "maaser";

export interface LedgerView {
  label: string;
  back: string;
  /** Set when the clicked figure was an average over this many months. */
  divideBy?: number;
  /** Set when this is an account's activity or a recurring series, not a category total. */
  view?: LedgerViewKind;
}

export interface ParsedLedger {
  initialFilter: Partial<TxnFilter>;
  ledger: LedgerView | null;
}

const DEFAULT_BACK = "#/reports";
const DEFAULT_LABEL = "Transactions";

export function ledgerHref(spec: LedgerSpec): string {
  const q = new URLSearchParams();
  q.set("ledger", "1");
  q.set("label", spec.label);
  for (const category of spec.categories ?? []) q.append("cat", category);
  if (spec.kind) q.set("kind", spec.kind);
  if (spec.from) q.set("from", spec.from);
  if (spec.to) q.set("to", spec.to);
  for (const id of spec.accountIds ?? (spec.accountId ? [spec.accountId] : [])) q.append("account", id);
  if (spec.countedAccountsOnly ?? true) q.set("counted", "1");
  if (spec.transfers && spec.transfers !== "exclude") q.set("transfers", spec.transfers);
  if (spec.divideBy && spec.divideBy > 1) q.set("div", String(spec.divideBy));
  if (spec.payeeKey) q.set("payee", spec.payeeKey);
  if (spec.flow) q.set("flow", spec.flow);
  for (const m of spec.merchants ?? []) q.append("merchant", m);
  for (const m of spec.exceptMerchants ?? []) q.append("xmerchant", m);
  for (const m of spec.maaser ?? []) q.append("maaser", m);
  if (spec.view) q.set("view", spec.view);
  q.set("back", spec.back);
  return `#/transactions?${q.toString()}`;
}

export function parseLedgerQuery(q: URLSearchParams): ParsedLedger {
  if (q.get("ledger") !== "1") {
    // The link Reports used before ledgers existed. Kept so an old bookmark
    // still opens the category rather than the unfiltered list.
    const category = q.get("category");
    return { initialFilter: category ? { categories: [category] } : {}, ledger: null };
  }

  const initialFilter: Partial<TxnFilter> = {};
  const categories = q.getAll("cat");
  if (categories.length > 0) initialFilter.categories = categories;

  const kind = q.get("kind");
  if (kind === "expense" || kind === "income" || kind === "saving" || kind === "investment_income") {
    initialFilter.kind = kind;
  }

  const from = validDate(q.get("from"));
  const to = validDate(q.get("to"));
  if (from) initialFilter.from = from;
  if (to) initialFilter.to = to;

  const accounts = q.getAll("account").filter(Boolean);
  if (accounts.length > 0) initialFilter.accountIds = accounts;

  if (q.get("counted") === "1") initialFilter.countedAccountsOnly = true;

  const payee = q.get("payee");
  if (payee) initialFilter.payeeKey = payee;

  const flow = q.get("flow");
  if (flow === "out" || flow === "in") initialFilter.flow = flow;

  const merchants = q.getAll("merchant").filter(Boolean);
  if (merchants.length > 0) initialFilter.merchants = merchants;
  const exceptMerchants = q.getAll("xmerchant").filter(Boolean);
  if (exceptMerchants.length > 0) initialFilter.exceptMerchants = exceptMerchants;

  const maaser = q.getAll("maaser").filter((m): m is MaaserFigure => (MAASER_FIGURES as string[]).includes(m));
  if (maaser.length > 0) initialFilter.maaser = maaser;

  const transfers = q.get("transfers");
  if (transfers === "include" || transfers === "only") initialFilter.transfers = transfers;

  // A whole number of months, 2 to 60. Anything else is ignored, so a typed
  // link cannot shrink a total to nothing.
  const rawDiv = q.get("div") ?? "";
  const div = /^\d{1,2}$/.test(rawDiv) ? Number(rawDiv) : 0;

  const view = q.get("view");

  // Back stays inside the app: a hash route and nothing else.
  const back = q.get("back") ?? "";
  return {
    initialFilter,
    ledger: {
      label: q.get("label")?.trim() || DEFAULT_LABEL,
      back: back.startsWith("#/") ? back : DEFAULT_BACK,
      ...(div >= 2 && div <= 60 ? { divideBy: div } : {}),
      ...(view === "account" || view === "series" || view === "maaser" ? { view } : {}),
    },
  };
}
