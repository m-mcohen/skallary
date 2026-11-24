// src/domain/rules.ts
//
// Categorization rules: the layer that replaces Monarch's guessing.
//
// SimpleFIN sends no category, so its rows arrive with sourceCategory=null.
// These rules assign one by matching on the RAW bank memo (plus payee,
// description, MCC, amount and account), after which the existing
// category_mappings and adjustments layers work exactly as they already do.
//
// The point is determinism. The old feed filed one recurring Zelle payment to one person
// under "Office Rent", "Financial & Legal Services" and "Gifts" in different
// months. A rule on `memo contains "smith" and amount = -50000` cannot do that.
import type { NormalizedTxn } from "./types";

export interface CategorizationRule {
  id: number;
  /** Lower runs first. First match wins. */
  priority: number;
  // --- match conditions: every condition present must hold (AND) ---
  /** Case-insensitive substring of the raw bank memo. */
  memoContains?: string | null;
  payeeContains?: string | null;
  descriptionContains?: string | null;
  /** Exact ISO 18245 merchant category code. */
  mcc?: string | null;
  accountId?: string | null;
  /** Exact signed amount in cents. */
  amountCents?: number | null;
  /** Inclusive signed range, for a bill that drifts month to month. */
  amountMinCents?: number | null;
  amountMaxCents?: number | null;
  // --- action ---
  action: "categorize" | "transfer" | "exclude";
  toCategory?: string | null;
  note?: string | null;
}

/**
 * True when `needle` appears in `haystack` as a whole word (or run of words),
 * case-insensitively.
 *
 * A plain substring test is not safe here. A learned key is a MERCHANT NAME,
 * and a short one buried in a longer word matches nonsense: the live rule
 * `payee_contains="ce" -> Electronics` was categorizing "Example Insurance Co"
 * and "Example Workspace" as electronics. Requiring the match to
 * begin and end on a boundary kills that while keeping the legitimate short
 * merchants -- cvs, ups, gap, h&m -- which stand on their own in the payee.
 *
 * Boundary means "start/end of string, or an adjacent non-alphanumeric
 * character", not \b: keys legitimately contain punctuation ("h&m", "sq *"),
 * and \b around those anchors in the wrong place.
 */
function contains(haystack: string | null | undefined, needle: string | null | undefined): boolean {
  if (!needle) return true; // absent condition doesn't constrain
  const hay = (haystack ?? "").toLowerCase();
  const key = needle.toLowerCase();
  if (!key) return true;
  const alnum = /[a-z0-9]/;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(key, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : hay[at - 1];
    const after = at + key.length >= hay.length ? "" : hay[at + key.length];
    // Only guard an edge that is itself alphanumeric -- a key ending in "*"
    // or "&" is already its own boundary.
    const okStart = !alnum.test(key[0]) || !before || !alnum.test(before);
    const okEnd = !alnum.test(key[key.length - 1]) || !after || !alnum.test(after);
    if (okStart && okEnd) return true;
    from = at + 1;
  }
}

/**
 * The statement text a memo rule matches against.
 *
 * Monarch's export carried the raw bank memo on every row, and every rule
 * learned from that history matches on it. SimpleFIN instead sends memo="" and
 * puts the statement text in `description`, so a memo rule can never fire on a
 * post-cutover row -- the first live one fell through
 * every rule for this reason alone. Falling back ONLY when the memo is blank
 * keeps this narrower than "memo OR description": a row carrying a real memo is
 * still matched on that memo alone, so a generic description can't steal it.
 */
function statementText(txn: NormalizedTxn): string | null | undefined {
  return txn.memo?.trim() ? txn.memo : txn.description;
}

function matches(txn: NormalizedTxn, rule: CategorizationRule): boolean {
  if (!contains(statementText(txn), rule.memoContains)) return false;
  if (!contains(txn.payee, rule.payeeContains)) return false;
  if (!contains(txn.description, rule.descriptionContains)) return false;
  if (rule.mcc && txn.mcc !== rule.mcc) return false;
  if (rule.accountId && txn.accountId !== rule.accountId) return false;
  if (rule.amountCents != null && txn.amountCents !== rule.amountCents) return false;
  if (rule.amountMinCents != null && txn.amountCents < rule.amountMinCents) return false;
  if (rule.amountMaxCents != null && txn.amountCents > rule.amountMaxCents) return false;
  // A rule with no conditions at all would match everything -- refuse it.
  const hasCondition =
    !!rule.memoContains || !!rule.payeeContains || !!rule.descriptionContains || !!rule.mcc ||
    !!rule.accountId || rule.amountCents != null || rule.amountMinCents != null || rule.amountMaxCents != null;
  return hasCondition;
}

/**
 * Applies rules in priority order, first match wins. Pure: returns new rows and
 * never mutates the input.
 *
 * A transaction that already has a category keeps it -- rules exist to
 * categorize the blank SimpleFIN rows, not to relabel Monarch history. Anything
 * left uncategorized is what the review queue shows.
 */
export function applyRules(transactions: NormalizedTxn[], rules: CategorizationRule[]): NormalizedTxn[] {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);
  const out: NormalizedTxn[] = [];

  for (const txn of transactions) {
    const rule = ordered.find((r) => matches(txn, r));
    if (!rule) {
      out.push({ ...txn });
      continue;
    }
    if (rule.action === "exclude") continue;
    if (rule.action === "transfer") {
      out.push({ ...txn, isTransfer: true });
      continue;
    }
    out.push({
      ...txn,
      sourceCategory: txn.sourceCategory ?? rule.toCategory ?? null,
    });
  }
  return out;
}

/**
 * Reduces a raw bank memo to the part that recurs, so the same payment in
 * different months groups together.
 *
 * Raw memos are unique per transaction -- "Zelle payment from JANE EXAMPLE
 * Conf# abc123xyz" vs "...Conf# def456uvw" -- so nothing could be learned from
 * them without stripping the varying parts: confirmation codes, dates, card
 * and store numbers. What's left is who was paid, which is exactly the thing
 * Monarch threw away when it reduced the merchant to "Zelle".
 *
 * Returns null when nothing identifying survives.
 */
export function normalizeMemoKey(memo: string | null | undefined): string | null {
  if (!memo) return null;
  let text = memo.toLowerCase();
  text = text.replace(/conf#?/g, " ");                  // confirmation label
  text = text.replace(/\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?/g, " ");                    // 09/01 or 09/01/26
  text = text.replace(/#\d+/g, " ");                  // store numbers: #1234
  // Any token containing a digit is an identifier, not a name.
  const words = text.split(/[^a-z0-9]+/).filter((w) => w && !/[0-9]/.test(w) && w.length > 1);
  const key = words.join(" ").trim();
  return key.length >= 3 ? key : null;
}

/**
 * How dominant one category must be within a memo group before it becomes a
 * rule. Set high deliberately: a wrong rule here silently rewrites spending.
 */
const MEMO_PURITY = 0.9;

/**
 * The same guard, for the merchant/payee path.
 *
 * This was missing, and it is how `payee="zelle" -> Other Income` got learned
 * by plurality across many Zelle payments that are really rent, office rent,
 * gifts and business income. Slightly looser than the memo threshold because a
 * named merchant is stronger evidence than a memo pattern, but one stray
 * miscategorization in a long history still must not block a good rule.
 */
const MERCHANT_PURITY = 0.85;

/**
 * Wording that describes the MECHANISM of a payment rather than who was paid.
 *
 * These are never merchants. Monarch reduces a whole class of unrelated
 * payments to one of these labels, so a rule built on one names no
 * counterparty and will match future payments it has nothing to do with --
 * the single most expensive way this engine can be wrong.
 */
const BANK_MECHANIC_WORDS = new Set([
  // the rail
  "zelle", "ach", "wire", "eft", "xfer", "transfer", "transfers",
  // the act
  "payment", "payments", "pymt", "pmt", "pay", "billpay", "bill",
  "deposit", "withdrawal", "purchase", "adjustment", "credit", "debit",
  // the channel
  "online", "mobile", "web", "external", "internal", "direct", "recurring",
  // the container
  "account", "checking", "savings", "chk", "sav", "funds", "cash", "atm", "check",
  // connective tissue and receipt noise
  "to", "from", "of", "for", "the", "and", "id", "ref", "verification",
  "thank", "you", "recd", "received", "sent",
]);

/**
 * True when a learned key names only the MECHANISM of a payment and nobody in
 * particular.
 *
 * The test is residual, not prefix-based: strip the bank's own vocabulary and
 * see whether anything identifying is left. That distinction is the whole
 * point. "payment", "online transfer to checking" and "purchase adjustment"
 * reduce to nothing and must never become rules -- `memo="payment" ->
 * Credit Card Payment` filed a rent payment as a card payment. But
 * "zelle payment to jane example" reduces to "jane example", which is precisely the
 * counterparty Monarch threw away when it labelled the merchant "Zelle", and
 * is the reason the memo path exists at all.
 *
 * Tokens are checked by membership rather than length so short real merchants
 * survive -- "h&m" splits to "h" and "m", neither of which is bank vocabulary.
 */
function isGenericWording(key: string): boolean {
  const tokens = key.toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  // A token that is purely digits is an identifier, not an identity.
  return tokens.every((t) => BANK_MECHANIC_WORDS.has(t) || /^\d+$/.test(t));
}

export interface DeriveOptions {
  /** How many times a merchant must appear before its category is trusted. */
  minOccurrences?: number;
}

/**
 * Builds rules from already-categorized history.
 *
 * Already-categorized history encodes the user's taxonomy; without this the cutover
 * would start from a cold categorizer and every recurring merchant would land
 * in the review queue again. Takes the most common category per merchant, so a
 * single stray miscategorization doesn't become a rule.
 */
export function deriveRulesFromHistory(
  history: NormalizedTxn[],
  options: DeriveOptions = {}
): CategorizationRule[] {
  const minOccurrences = options.minOccurrences ?? 2;
  const byMerchant = new Map<string, Map<string, number>>();

  for (const txn of history) {
    // Learn only from rows that carry a real category, and never from
    // transfers -- "Transfer" is a flag, not a spending category.
    if (!txn.sourceCategory || txn.isTransfer) continue;
    const merchant = (txn.merchant ?? txn.payee ?? "").trim().toLowerCase();
    if (!merchant) continue;
    const counts = byMerchant.get(merchant) ?? new Map<string, number>();
    counts.set(txn.sourceCategory, (counts.get(txn.sourceCategory) ?? 0) + 1);
    byMerchant.set(merchant, counts);
  }

  // Second pass, keyed on the normalized memo. This is what catches the
  // payments Monarch hid behind a generic merchant like "Zelle".
  const byMemo = new Map<string, Map<string, number>>();
  for (const txn of history) {
    if (!txn.sourceCategory || txn.isTransfer) continue;
    const key = normalizeMemoKey(txn.memo);
    if (!key) continue;
    const counts = byMemo.get(key) ?? new Map<string, number>();
    counts.set(txn.sourceCategory, (counts.get(txn.sourceCategory) ?? 0) + 1);
    byMemo.set(key, counts);
  }

  const rules: CategorizationRule[] = [];
  let id = 1;

  // A memo pattern recurring a handful of times is weaker evidence than a
  // named merchant, so it needs more of it before becoming a rule.
  const memoMin = Math.max(minOccurrences + 1, 3);
  for (const [key, counts] of [...byMemo.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total < memoMin) continue;
    const [category, top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    // A memo group must be nearly PURE, not merely have a plurality. Generic
    // bank wording ("Online Transfer to CHK ...") collapses hundreds of
    // unrelated payments into one key, and a plurality vote across them is
    // noise: against real data it relabelled 221 transfers as charity and 258
    // as income. A group that is genuinely one recurring payment is almost
    // entirely one category; a mixed bag never is.
    if (top / total < MEMO_PURITY) continue;
    // Purity is not enough on its own. A group can be 100% pure and still be
    // worthless: `memo="payment" -> Credit Card Payment` was learned from six
    // genuine card payments, sailed through this guard, and then matched the
    // statement text of "Zelle payment to Jane Example" -- filing a RENT payment
    // as a credit card payment. Purity measures agreement, not whether the key
    // identifies anyone.
    if (isGenericWording(key)) continue;
    rules.push({
      id: id++,
      // Above merchant rules (500): a memo identifies the counterparty far
      // more precisely than a merchant field that just says "Zelle".
      priority: 400,
      memoContains: key,
      action: "categorize",
      toCategory: category,
      note: `Learned from ${total} transactions by bank memo`,
    });
  }

  for (const [merchant, counts] of [...byMerchant.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total < minOccurrences) continue;
    // Not a merchant, just the bank naming the mechanism -- never a rule.
    if (isGenericWording(merchant)) continue;
    const [category, top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    // The guard the memo path has had all along. Without it a merchant that
    // fronts for many unrelated payments takes its plurality category and
    // applies it to all of them.
    if (top / total < MERCHANT_PURITY) continue;
    rules.push({
      id: id++,
      // Derived rules sit BELOW hand-written ones, which start at priority 100.
      priority: 500,
      payeeContains: merchant,
      action: "categorize",
      toCategory: category,
      note: `Learned from ${total} Monarch transactions`,
    });
  }
  return rules;
}

/**
 * The key a hand-written rule matches on, derived from a transaction.
 *
 * The payee is the right key: SimpleFIN sends memo="" on every row, and the
 * description carries per-transaction noise (store numbers, WEB IDs) that would
 * make the rule match exactly one transaction and never recur. Lower-cased
 * because rule matching is case-insensitive and the rules table stores learned
 * keys lower-cased.
 *
 * Returns "" when there is nothing to key on. A blank key would match every
 * transaction, so every caller must refuse to write a rule for it.
 */
export function ruleKeyFor(t: NormalizedTxn): string {
  return (t.payee ?? t.merchant ?? "").trim().toLowerCase();
}
