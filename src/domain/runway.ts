import type { RunwayResult } from "./plan-types";
import type { Account } from "./types";
import type { AccountBalance } from "./plan-types";

// Type strings seen from the old data source:
// accounts report type.name as 'brokerage', 'credit', or
// 'depository' (Monarch's umbrella category covering checking/savings/cash).
// 'checking'/'savings'/'cash'/'investment' are kept as fallback synonyms in
// case another data source ever reports those instead; 'depository' is the
// one that actually matters for Monarch and was previously missing, which
// would have silently excluded every checking/savings account from
// drawableLiquidCents.
const ASSET_TYPES = ["checking", "savings", "cash", "brokerage", "investment", "depository"];
const CREDIT_TYPES = ["credit", "credit_card", "creditcard"];
const RETIREMENT_TYPES = ["retirement", "ira", "401k", "403b", "pension"];

function matchesAny(type: string, candidates: string[]): boolean {
  const t = type.toLowerCase();
  return candidates.some((c) => t.includes(c));
}

/**
 * A first guess at an account's type from its name, for the one-time typing
 * pass. SimpleFIN supplies no type or subtype field at all, so the name is the
 * only signal available -- and a guess is explicitly a draft for the user to
 * confirm, never an answer (see accountsNeedingType).
 */
export function guessAccountType(name: string): string | null {
  const n = (name ?? "").toLowerCase();
  if (!n.trim()) return null;
  // Retirement first: "Roth IRA" would otherwise read as a brokerage.
  if (RETIREMENT_NAME.test(name)) return "retirement";
  if (/\b(credit|card|visa|mastercard|amex|discover|quicksilver|freedom|sapphire)\b/.test(n)) return "credit";
  if (/\b(loan|mortgage|heloc)\b/.test(n)) return "loan";
  if (/\b(checking|savings|chequing|money market|cash)\b/.test(n)) return "depository";
  if (/\b(brokerage|invest|investment|taxable)\b/.test(n)) return "brokerage";
  return null;
}

/**
 * Accounts whose type can't be trusted yet, for the one-time confirmation pass.
 *
 * That means a MISSING type, or one we inferred from the account name because
 * SimpleFIN reports none. A type that came from a feed which genuinely supplies
 * them -- as Monarch did -- is already trustworthy and is deliberately NOT
 * flagged: making the user re-confirm 18 correctly-typed accounts would be
 * busywork that teaches them to click through the list without reading it.
 */
export function accountsNeedingType(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.includeInSpend && a.typeSource !== "user" && (!a.type || a.typeSource === "guess"));
}

// Retirement accounts (IRA / Roth / Traditional IRA / 401k / 403b / pension) are
// penalty-locked — NOT "drawable" runway cash. Monarch types them as 'brokerage'
// (same as a taxable brokerage), so the only signal is the account NAME. Excluded
// from drawable per the user's decision; the reverse-budget scripts
// excluded them too. A TAXABLE brokerage (no retirement marker in the name) still
// counts. `\bira\b` catches "Roth IRA"/"Traditional IRA"/"SEP IRA"; `roth` and the
// 401k/403b/pension forms cover the rest. Word boundaries avoid matching "September"
// etc.; a person's name containing "Ira" would be a false positive but none exist here.
const RETIREMENT_NAME = /\b(ira|roth|401\s*\(?k\)?|401k|403\s*\(?b\)?|403b|pension|retirement)\b/i;

/** True when the account name marks it as a retirement account (excluded from drawable). */
export function isRetirementAccount(acct: Account): boolean {
  return RETIREMENT_NAME.test(acct.name ?? "");
}

/**
 * Sum of balances across accounts flagged `includeInSpend` that are
 * "drawable" liquid assets: checking/savings/cash/brokerage/investment
 * (Monarch: 'depository'/'brokerage') balances add directly; credit-card
 * balances also add. Loans, mortgages,
 * real estate, and any other type are excluded entirely. Type matching
 * is case-insensitive substring matching. RETIREMENT accounts (IRA/Roth/
 * 401k/etc., detected by name via isRetirementAccount) are excluded even
 * though Monarch types them as 'brokerage' — they're penalty-locked, not
 * drawable runway cash.
 */
/**
 * What a never-chosen account starts as, and the fallback for accounts that
 * predate the toggle. Everyday cash, taxable brokerages and credit cards count;
 * retirement, loans and untyped accounts don't.
 *
 * This is only a STARTING POINT. Whether an IRA or a charity set-aside is
 * really spendable is a judgement about the user's own money and obligations,
 * which is why it's a per-account switch rather than a rule the app enforces.
 */
export function defaultDrawableFor(acct: Account): boolean {
  const type = acct.type ?? "";
  if (!type) return false;
  if (isRetirementAccount(acct)) return false;
  if (matchesAny(type, CREDIT_TYPES)) return true;
  if (matchesAny(type, RETIREMENT_TYPES)) return false;
  return matchesAny(type, ASSET_TYPES);
}

/** A credit-card account, whose balance is debt rather than cash. */
export function isCardAccount(acct: Account): boolean {
  return matchesAny(acct.type ?? "", CREDIT_TYPES);
}

/**
 * The one gate on whether an account's balance is part of drawable. The
 * total, the Now statement and the Accounts screen all ask this function,
 * so they cannot drift apart.
 *
 * Cards always count: a card is never money you can
 * spend, so "drawable" is not a question it can answer, and the switch that
 * let one be turned off only made the picture rosier by hiding its debt.
 */
export function countsTowardDrawable(acct: Account): boolean {
  // "Don't count this account at all" wins over "count its balance".
  if (!acct.includeInSpend) return false;
  // An archived row is the superseded record of a live account, kept only
  // for the transactions it owns. Any balance a feed puts on it is the same
  // money the live row already reports, so counting it counts that money
  // twice.
  if (acct.archived) return false;
  // An untyped account is skipped rather than guessed at. Silently counting
  // one is exactly how a credit card ends up inflating drawable; better to
  // under-report and flag it via accountsNeedingType.
  if (!acct.type) return false;
  if (isCardAccount(acct)) return true;
  // The per-account switch decides WHETHER a balance counts. Unset falls back
  // to the default rule, so accounts predating the toggle behave exactly as
  // they did before it existed.
  return acct.drawable ?? defaultDrawableFor(acct);
}

export function drawableLiquidCents(accounts: Account[], balances: AccountBalance[]): number {
  const balanceById = new Map(balances.map((b) => [b.accountId, b.balanceCents]));
  let total = 0;
  for (const acct of accounts) {
    if (!countsTowardDrawable(acct)) continue;
    const cents = balanceById.get(acct.id) ?? 0;
    // Past the gate the only remaining question is the sign. Card debt
    // reduces drawable NO MATTER which sign the feed reports it in: Monarch
    // sent it negative, SimpleFIN reports liabilities from the bank's side,
    // where positive means you owe. A card's contribution is always <= 0.
    total += isCardAccount(acct) ? -Math.abs(cents) : cents;
  }
  return total;
}

/**
 * Projects liquid cash forward month by month from a starting balance,
 * applying each future month's net cash flow in order. Reports the first
 * period the running balance crosses to zero or below (if any) and the
 * 1-based month count to reach it (runway). `runwayMonths` is null when
 * cash-flow stays positive through the whole horizon (no limit found).
 */
export function computeRunway(startingLiquidCents: number, futureMonthlyNet: { period: string; netCents: number }[]): RunwayResult {
  let running = startingLiquidCents;
  const liquidByMonth: { period: string; cents: number }[] = [];
  let crossZeroPeriod: string | null = null;
  let runwayMonths: number | null = null;

  futureMonthlyNet.forEach((m, idx) => {
    running += m.netCents;
    liquidByMonth.push({ period: m.period, cents: running });
    if (crossZeroPeriod === null && running <= 0) {
      crossZeroPeriod = m.period;
      runwayMonths = idx + 1;
    }
  });

  return { startingLiquidCents, liquidByMonth, crossZeroPeriod, runwayMonths };
}

const LOAN_TYPES = ["loan", "mortgage", "heloc", "liability"];

/** A loan or mortgage, whose balance is debt. Read from the type, never the name. */
export function isLoanAccount(acct: Account): boolean {
  return matchesAny(acct.type ?? "", LOAN_TYPES);
}

/**
 * Retirement money deliberately kept out of drawable: the ONE rule behind the
 * Dashboard's "Held back" tile and the Position card's "Held back" rows.
 *
 * The tile and the runway must agree: the tile must not match names loosely (any
 * name containing "ira") and still counted an IRA the user had switched ON as
 * drawable, so the same money could sit in Drawable and in Held back at once.
 * The rows used the strict name match but missed an account typed
 * "retirement" with no retirement word in its name. Now: not archived, NOT
 * counted toward drawable, and retirement by type or by the whole-word name
 * match.
 */
export function isHeldBackAccount(acct: Account): boolean {
  if (acct.archived) return false;
  if (countsTowardDrawable(acct)) return false;
  return isRetirementByNameOrType(acct);
}

/** Retirement by the whole-word name match or by type: the rule Held back uses, without the drawable gate. */
export function isRetirementByNameOrType(acct: Account): boolean {
  return isRetirementAccount(acct) || matchesAny(acct.type ?? "", RETIREMENT_TYPES);
}
