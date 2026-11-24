// The sums behind the "Where pay goes" Sankey.
// Every band is a total the app already keeps: money in and spending come from the monthly rollups,
// the pot band from the pot ledger, the paycheck part from the Salary figures. Whole cents only;
// the one rounding is the paycheck's scaling from a year to the period. Pure, no UI imports.
import type { Account, NormalizedTxn } from "./types";
import type { CharityPot } from "./charity-pot";
import { MAASER_CATEGORY, potAccountIds, potRowKind, type MaaserLedger } from "./maaser-pot";
import type { SalaryBreakdown } from "./salary";
import { rollupMonthly } from "./rollups";
import { PAYCHECKS_LINE } from "./budget-income";

export type FlowNodeKind = "gross" | "taxes" | "benefits" | "gap" | "bank" | "from-savings" | "pot" | "saving" | "category" | "left-over";
export interface FlowNode { id: string; label: string; kind: FlowNodeKind; modelled: boolean }
export interface FlowLink { from: string; to: string; cents: number; modelled: boolean }
export interface PayFlow { from: string; to: string; nodes: FlowNode[]; links: FlowLink[]; showsPaycheck: boolean }
export interface PayFlowInput {
  prepared: NormalizedTxn[]; accounts: Account[]; mapping: Record<string, string>;
  from: string; to: string;                         // "YYYY-MM", a month or a year
  pot: CharityPot | null; potLedger: MaaserLedger | null;
  paycheck: SalaryBreakdown | null;
  showPaycheck: boolean;
}

/** The gap band's label: the pay that arrived differs from the Salary figures, either way. */
export const GAP_LABEL = "Differs from your Salary figures";

/** Months from `from` to `to` inclusive ("YYYY-MM"); 0 when `to` is before `from`. */
function monthsIn(from: string, to: string): number {
  const m = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
  return Math.max(0, m(to) - m(from) + 1);
}

export function buildPayFlow(input: PayFlowInput): PayFlow {
  const { from, to } = input;
  const nodes = new Map<string, FlowNode>();
  const links: FlowLink[] = [];
  const node = (id: string, label: string, kind: FlowNodeKind, modelled = false) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, kind, modelled });
  };
  const link = (src: string, dst: string, cents: number, modelled = false) => {
    if (cents > 0) links.push({ from: src, to: dst, cents, modelled });
  };

  // Totals over the period, per category, from the rollups as they are (signed: spend positive).
  // Investment income is spendable money landing in a spending account, so it is money in too.
  const income = new Map<string, number>();
  const expense = new Map<string, number>();
  let saving = 0;
  for (const r of rollupMonthly(input.prepared, input.accounts, input.mapping)) {
    if (r.period < from || r.period > to) continue;
    if (r.kind === "saving") saving += r.amountCents;
    else if (r.kind === "expense") expense.set(r.planningCategory, (expense.get(r.planningCategory) ?? 0) + r.amountCents);
    else income.set(r.planningCategory, (income.get(r.planningCategory) ?? 0) + r.amountCents);
  }

  // The pot account's own rows: pay deposited straight into it, and gifts paid from it.
  const potIds = potAccountIds(input.accounts);
  let potPay = 0;
  let potGifts = 0;
  for (const t of input.prepared) {
    const period = t.date.slice(0, 7);
    if (!potIds.has(t.accountId) || period < from || period > to) continue;
    const kind = potRowKind(t, potIds, input.mapping);
    if (kind === "pay") potPay += t.amountCents;
    else if (kind === "gift") potGifts += -t.amountCents;
  }
  const potActive = !!input.pot?.on && potIds.size > 0 && input.potLedger !== null;
  // The pot band is what was set aside less what the pot paid back: a payback returns money for a
  // gift the cards already paid, so drawing both would take that money out of the bank twice. When
  // paybacks beat the set-aside, the excess is pot money coming in, drawn on the left.
  // The ledger must cover the same months as `from`..`to` (the caller builds it for this period).
  const potNet = potActive ? input.potLedger!.setAsideCents - input.potLedger!.reimbursedCents : 0;
  const potName = input.pot?.name || "your charity pot";
  // The pot band carries the money the pot gave, so the Charity band shows only what cards gave.
  if (potActive && expense.has(MAASER_CATEGORY)) expense.set(MAASER_CATEGORY, expense.get(MAASER_CATEGORY)! - potGifts);

  // A negative income total is money out: drawn as its own band so the sums still reconcile.
  for (const [name, cents] of [...income]) {
    if (cents < 0) {
      expense.set(name, (expense.get(name) ?? 0) - cents);
      income.delete(name);
    }
  }
  // A category whose refunds beat its spend is not drawn; its surplus is money in, pooled.
  let refunds = 0;
  for (const [name, cents] of [...expense]) {
    if (cents <= 0) {
      refunds += -cents;
      expense.delete(name);
    }
  }

  // The paycheck view: the household's annual W-2 figures scaled to the period, rounded once per figure.
  const months = monthsIn(from, to);
  const scale = (annual: number) => Math.round((annual * months) / 12);
  let paycheck: { gross: number; taxes: number; benefits: number; takeHome: number } | null = null;
  if (input.showPaycheck && input.paycheck !== null && months > 0) {
    const b = input.paycheck;
    const gross = scale(b.grossAnnualCents + b.otherGrossAnnualCents);
    const taxes = scale(b.ficaAnnualCents + b.federalAnnualCents + (b.otherTaxesAnnualCents ?? 0));
    const benefits = scale(b.premiumAnnualCents);
    const takeHome = gross - taxes - benefits;
    // Taxes and benefits beyond the gross cannot be drawn as a balanced band: keep the bank view.
    if (takeHome >= 0) paycheck = { gross, taxes, benefits, takeHome };
  }

  if (paycheck) {
    const { taxes, benefits, takeHome } = paycheck;
    const paid = (income.get(PAYCHECKS_LINE) ?? 0) + potPay; // the pay that arrived
    node("gross", "Gross pay", "gross", true);
    node("taxes", "Taxes", "taxes", true);
    node("benefits", "Benefits", "benefits", true);
    node("gap", GAP_LABEL, "gap", true);
    link("gross", "taxes", taxes, true);
    link("gross", "benefits", benefits, true);
    link("gross", "bank", Math.min(paid, takeHome), true);
    link("gross", "gap", takeHome - paid, true);
    link("gap", "bank", paid - takeHome, true);
    income.delete(PAYCHECKS_LINE);
  } else {
    node("in:pot-pay", "Pay into the pot", "bank");
    link("in:pot-pay", "bank", potPay);
  }
  for (const [name, cents] of income) {
    node(`in:${name}`, name, "bank");
    link(`in:${name}`, "bank", cents);
  }
  node("in:refunds", "Refunds", "bank");
  link("in:refunds", "bank", refunds);
  node("from-pot", `From ${potName}`, "pot");
  link("from-pot", "bank", -potNet);

  for (const [name, cents] of expense) {
    node(`cat:${name}`, name, "category");
    link("bank", `cat:${name}`, cents);
  }
  node("pot", potName, "pot");
  link("bank", "pot", potNet);
  node("saving", "Saving", "saving");
  link("bank", "saving", saving);

  // What is left, or what came from savings: a net withdrawal plus any shortfall, one node.
  const intoBank = links.filter((l) => l.to === "bank").reduce((s, l) => s + l.cents, 0);
  const outOfBank = links.filter((l) => l.from === "bank").reduce((s, l) => s + l.cents, 0);
  const withdrawal = saving < 0 ? -saving : 0;
  const rest = intoBank + withdrawal - outOfBank;
  node("from-savings", "From savings", "from-savings");
  link("from-savings", "bank", withdrawal + Math.max(0, -rest));
  node("left-over", "Left over", "left-over");
  link("bank", "left-over", rest);
  node("bank", "Money in", "bank");

  // Only nodes with a band are drawn (zero-cent links were never emitted).
  const used = new Set(links.flatMap((l) => [l.from, l.to]));
  const flow: PayFlow = { from, to, nodes: [...nodes.values()].filter((n) => used.has(n.id)), links, showsPaycheck: paycheck !== null };
  const order = flowOrder(flow);
  flow.nodes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return flow;
}

/** Node ids in drawing order: inflows, the bank hub, spending largest first, pot, saving, left over. */
export function flowOrder(flow: PayFlow): string[] {
  const size = (id: string) => flow.links.filter((l) => l.from === id || l.to === id).reduce((s, l) => s + l.cents, 0);
  const ids = flow.nodes.map((n) => n.id);
  const has = (id: string) => ids.includes(id);
  const largestFirst = (keep: (id: string) => boolean) => ids.filter(keep).sort((a, b) => size(b) - size(a) || a.localeCompare(b));
  const gapIsSource = flow.links.some((l) => l.from === "gap");
  return [
    ...["gross"].filter(has),
    ...(gapIsSource ? ["gap"] : []),
    ...largestFirst((id) => id.startsWith("in:") && id !== "in:pot-pay" && id !== "in:refunds"),
    ...["in:pot-pay", "in:refunds", "from-pot", "from-savings", "bank", "taxes", "benefits"].filter(has),
    ...(has("gap") && !gapIsSource ? ["gap"] : []),
    ...largestFirst((id) => id.startsWith("cat:")),
    ...["pot", "saving", "left-over"].filter(has),
  ];
}
