// src/domain/maaser-pot.ts -- the charity pot as a yearly ledger of totals. Names keep the
// old word; nothing a user reads does.
//
// How a pot runs: a share of the pay that lands in the bank (or a set amount) goes into a set-aside
// account (the pot account). A gift is paid by card or checking and the pot pays the user back, or
// the pot pays a charity directly (a Zelle, a check, cash withdrawn). A floor stays in the account.
// With no pot account, the ledger shows what is owed against what was given, with no balance.
//
// The pot's rows are read here by account, never as ordinary spending or income (rule 3):
//   inflow  paired with the user's own account by the matcher -> set aside only; otherwise -> pay
//           (payroll sends a tenth straight into the pot), which is income and set aside
//   outflow classify() reads as a transfer -> a payback to the user; any other -> a gift given from the pot
// The ledger sums those, and the user's cards' Charity rows, over the budget year to date. Pure.
import { classify } from "./dedup";
import { countedIncomeCents, marksById, type MaaserMark } from "./maaser-marks";
import { potCountsOwner, potOwedCents, type CharityPot } from "./charity-pot";
import type { Account, NormalizedTxn } from "./types";

/** The budget line maaser lands on (the What if screen's Charity floor reads it too). */
export const MAASER_CATEGORY = "Charity";

/** The live account flagged as the pot under Settings, Accounts: the one whose balance the panel reads. */
export function maaserPotAccount(accounts: Account[]): Account | null {
  return accounts.find((a) => a.maaserPot === true && !a.archived) ?? null;
}

/**
 * Every flagged row, archived ones included: the pot's history before
 * the SimpleFIN cutover sits on the archived Monarch-era row of the same bank account, and
 * its deposits and reimbursements are the pot's too. Empty when no account is the pot.
 */
export function potAccountIds(accounts: Account[]): Set<string> {
  return new Set(accounts.filter((a) => a.maaserPot === true).map((a) => a.id));
}

export type PotRowKind = "pay" | "set_aside" | "payback" | "gift";

/**
 * Null for a row not on the pot or with no amount. Inflow: set aside when the pair matcher found the
 * other leg in the user's own account (transferPartnerAccountId set), else pay. Outflow: payback when
 * classify() reads it as a transfer, else a gift straight from the pot. The inflow signal is
 * the matcher's partner, not classify(), because the migration 0010 "Maaser" adjustment flags the
 * Monarch-era payroll deposits as transfers too and would hide that income.
 */
export function potRowKind(t: NormalizedTxn, potIds: Set<string>, mapping: Record<string, string>): PotRowKind | null {
  if (!potIds.has(t.accountId) || t.amountCents === 0) return null;
  if (t.amountCents > 0) return t.transferPartnerAccountId ? "set_aside" : "pay";
  return classify(t, mapping).kind === "transfer" ? "payback" : "gift";
}

export type MaaserRole = "gift" | "income";

/** What the row checks need of the pot: its switch and whose accounts count. */
export type PotCounts = Pick<CharityPot, "on" | "counts">;

/** True when the row's account belongs to an owner slot that counts toward the pot (no pot passed: the user's own). */
function counts(t: NormalizedTxn, accounts: Account[], pot: PotCounts | null | undefined): boolean {
  const owner = accounts.find((a) => a.id === t.accountId)?.owner;
  return owner !== undefined && potCountsOwner(pot, owner);
}

/** Which mark a row can take: a pot gift or a Charity expense row on a counted account is a gift; a pot pay deposit or an income row on a counted account is income; everything else null. */
export function maaserRole(t: NormalizedTxn, accounts: Account[], mapping: Record<string, string>, pot?: PotCounts | null): MaaserRole | null {
  const potIds = potAccountIds(accounts);
  if (potIds.has(t.accountId)) {
    // A pot flagged on an account whose owner does not count takes no part.
    if (!counts(t, accounts, pot)) return null;
    const kind = potRowKind(t, potIds, mapping);
    return kind === "gift" ? "gift" : kind === "pay" ? "income" : null;
  }
  if (!counts(t, accounts, pot)) return null;
  const c = classify(t, mapping);
  if (c.kind === "expense" && c.planningCategory === MAASER_CATEGORY) return "gift";
  if (c.kind === "income") return "income";
  return null;
}

export interface MaaserLedgerInput {
  prepared: NormalizedTxn[];
  accounts: Account[];
  mapping: Record<string, string>;
  marks: MaaserMark[];
  /** The pay rate used when no pot is passed. */
  maaserRate: number;
  /** The charity pot: whose accounts count and what is owed. Absent: the rate above, the user's own accounts. */
  pot?: CharityPot | null;
  /** Inclusive, YYYY-MM-DD: the budget year's January 1 to today (or the year's last day on a past plan). */
  from: string;
  to: string;
  /** The live pot row's balance less the floor; null until the feed reports one. */
  availableCents: number | null;
}

export interface MaaserLedger {
  from: string;
  to: string;
  countedIncomeCents: number;
  /** Line 1: what the pot owes (potOwedCents; with no pot passed, Math.round(maaserRate * countedIncomeCents)). */
  owedCents: number;
  /** Line 2. */
  setAsideCents: number;
  /** 3a, a signed sum, so a refund lowers it. */
  givenFromCardsCents: number;
  /** 3b. */
  givenFromPotCents: number;
  /** 3a + 3b. */
  givenCents: number;
  /** Line 4. */
  reimbursedCents: number;
  /** 1 - 2; negative = set aside ahead of income. */
  notYetSetAsideCents: number;
  /** 3a - 4; negative = paid back ahead. */
  potOwesYouCents: number;
  /** max(0, potOwesYou - available); null while available is unknown. */
  beyondMaaserCents: number | null;
}

/**
 * The five sums the ledger adds up, and the rows that make each one. A row can sit in two: pay deposited
 * straight into the pot is both income and set aside. Drill-down on the panel lists exactly these rows,
 * so the list and the figure cannot disagree.
 */
export type MaaserFigure = "income" | "setAside" | "givenCards" | "givenPot" | "reimbursed";

/** Which figures a row belongs to. A "does not count" mark takes a gift, or any row of the pot account, out of its figures; an income mark never does (the row shows, counted at the part marked). */
export function maaserFiguresOf(t: NormalizedTxn, accounts: Account[], mapping: Record<string, string>, mark?: MaaserMark, pot?: PotCounts | null): MaaserFigure[] {
  const potIds = potAccountIds(accounts);
  const left = mark?.kind === "not_maaser";
  if (potIds.has(t.accountId)) {
    if (!counts(t, accounts, pot)) return [];
    // A "does not count" mark takes any pot row out of the ledger: a gift, and also money into or out
    // of the account that was not for the pot (a bonus paid in by mistake and moved back).
    if (left) return [];
    const kind = potRowKind(t, potIds, mapping);
    if (kind === "pay") return ["income", "setAside"];
    if (kind === "set_aside") return ["setAside"];
    if (kind === "payback") return ["reimbursed"];
    if (kind === "gift") return ["givenPot"];
    return [];
  }
  if (!counts(t, accounts, pot)) return [];
  const c = classify(t, mapping);
  if (c.kind === "income") return ["income"];
  if (c.kind === "expense" && c.planningCategory === MAASER_CATEGORY && !left) return ["givenCards"];
  return [];
}

export function maaserLedger(input: MaaserLedgerInput): MaaserLedger {
  const marks = marksById(input.marks);
  let income = 0, setAside = 0, fromCards = 0, fromPot = 0, reimbursed = 0;
  for (const t of input.prepared) {
    const day = t.date.slice(0, 10);
    if (day < input.from || day > input.to) continue;
    const mark = marks.get(t.sourceTransactionId);
    for (const fig of maaserFiguresOf(t, input.accounts, input.mapping, mark, input.pot)) {
      if (fig === "income") income += countedIncomeCents(t.amountCents, mark);
      else if (fig === "setAside") setAside += t.amountCents;
      else if (fig === "givenCards") fromCards += -t.amountCents;
      else if (fig === "givenPot") fromPot += -t.amountCents;
      else reimbursed += -t.amountCents;
    }
  }
  const owed = input.pot === undefined
    ? Math.round(input.maaserRate * income)
    : input.pot === null ? 0 : potOwedCents(input.pot, income, input.from.slice(0, 7), input.to.slice(0, 7));
  const potOwesYou = fromCards - reimbursed;
  return {
    from: input.from,
    to: input.to,
    countedIncomeCents: income,
    owedCents: owed,
    setAsideCents: setAside,
    givenFromCardsCents: fromCards,
    givenFromPotCents: fromPot,
    givenCents: fromCards + fromPot,
    reimbursedCents: reimbursed,
    notYetSetAsideCents: owed - setAside,
    potOwesYouCents: potOwesYou,
    beyondMaaserCents: input.availableCents === null ? null : Math.max(0, potOwesYou - input.availableCents),
  };
}

export interface MaaserLedgerView {
  /** The pot account; null when none is picked (the ledger then has no balance). */
  account: { id: string; name: string } | null;
  balanceCents: number | null;
  balanceDate: string | null;
  floorCents: number;
  availableCents: number | null;
  ledger: MaaserLedger;
}

/**
 * The ledger with the pot account's balance. With no pot account: owed against given, and no
 * balance. Null only when the pot is off. Balance from the live flagged row only (an archived
 * row's balance is never read).
 */
export function maaserLedgerView(input: Omit<MaaserLedgerInput, "availableCents"> & { floorCents: number }): MaaserLedgerView | null {
  if (input.pot === null || (input.pot !== undefined && !input.pot.on)) return null;
  const ids = potAccountIds(input.accounts);
  const pot = maaserPotAccount(input.accounts) ?? input.accounts.find((a) => ids.has(a.id)) ?? null;
  if (!pot) {
    return { account: null, balanceCents: null, balanceDate: null, floorCents: input.floorCents, availableCents: null, ledger: maaserLedger({ ...input, availableCents: null }) };
  }
  // An archived row's balance is the superseded record of the live one; never read it.
  const balance = pot.archived ? null : (pot.balanceCents ?? null);
  const available = balance === null ? null : balance - input.floorCents;
  return {
    account: { id: pot.id, name: pot.name },
    balanceCents: balance,
    balanceDate: pot.balanceDate ?? null,
    floorCents: input.floorCents,
    availableCents: available,
    ledger: maaserLedger({ ...input, availableCents: available }),
  };
}
