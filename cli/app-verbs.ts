// cli/app-verbs.ts -- the verbs that talk to the RUNNING app. Each one makes the same call a screen makes, against
// http://127.0.0.1:4321 (or --port), so nothing touches the database directly and nothing needs a
// build or a restart. The older verbs in finance.ts write the database file itself and stay as
// they were. Every verb says in plain words what it changed; a refusal prints the server's own
// words and exits 1; --dry-run prints the call without sending it.
import { parseDollarsToCents, formatCents } from "../src/domain/money.js";
import { displayAccountName } from "../src/domain/account-display.js";
import { ruleKeyFor } from "../src/domain/rules.js";
import { CADENCE_LABELS } from "../src/domain/recurring-choices.js";
import { planForMonth } from "../src/domain/plan-choice.js";
import { HAND_PRIORITY } from "../src/domain/categorizations.js";
import type { Account, NormalizedTxn } from "../src/domain/types.js";
import type { Plan } from "../src/domain/plan-types.js";
import type { Cadence } from "../src/domain/recurring.js";

export const APP_USAGE = `Against the running app (no build, no restart; --port <n> for another port, --dry-run to see the call):
  finance accounts
  finance recurring list
  finance recurring mark "<merchant>" <dollars|all> <monthly|weekly|biweekly|quarterly|annual> [--account "<name part>"] [--label "<text>"]
  finance recurring unmark "<merchant>" [<dollars>] [--account "<name part>"]
  finance recurring hide "<merchant>" [<dollars>] [--account "<name part>"]
  finance budget change "<line>" <dollars> [--from YYYY-MM]
  finance pot floor <dollars>
  finance pot account "<account name part>"
  finance file "<merchant>" "<category>" [--all]      (newest charge from that merchant; --all makes a rule)
  finance sync`;

const CADENCES = Object.keys(CADENCE_LABELS) as Cadence[];

class Refused extends Error {}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** The positional words, with every --flag and its value taken out. */
function positional(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      if (!["--dry-run", "--json", "--all"].includes(argv[i])) i++;
      continue;
    }
    out.push(argv[i]);
  }
  return out;
}

export interface AppContext {
  base: string;
  dryRun: boolean;
  out: (line: string) => void;
}

/** What a verb says once its write is done; in a dry run, what it would have said. */
function done(ctx: AppContext, text: string): void {
  ctx.out(ctx.dryRun ? `Nothing sent (dry run). It would say: ${text}` : text);
}

async function call<T>(ctx: AppContext, method: string, path: string, body?: unknown): Promise<T> {
  if (ctx.dryRun && method !== "GET") {
    ctx.out(`Would send ${method} ${path}${body === undefined ? "" : " " + JSON.stringify(body)}`);
    return undefined as T;
  }
  let res: Response;
  try {
    res = await fetch(ctx.base + "/api" + path, {
      method,
      // No Origin header: the server's guard then checks Host, which is loopback here, while an
      // Origin naming another port is refused. Connection: close, so the process ends at once.
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Refused(`The app is not running at ${ctx.base}. Start it with run.bat, then try again.`);
  }
  if (!res.ok) {
    let words = `${method} ${path} failed (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) words = j.error;
    } catch {
      // Not JSON: keep the status line.
    }
    throw new Refused(words);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const dollars = (word: string): number => {
  try {
    const cents = parseDollarsToCents(word);
    if (cents <= 0) throw new Error("not positive");
    return cents;
  } catch {
    throw new Refused(`"${word}" is not an amount in dollars, such as 30.`);
  }
};

/** The charges from a merchant as the app shows it, newest first, and the accounts they sit on. */
async function merchantRows(ctx: AppContext, merchant: string): Promise<{ key: string; rows: NormalizedTxn[] }> {
  const txns = await call<NormalizedTxn[]>(ctx, "GET", "/transactions");
  const wanted = merchant.trim().toLowerCase();
  let rows = txns.filter((t) => ruleKeyFor(t) === wanted);
  if (rows.length === 0) rows = txns.filter((t) => ((t.payee ?? t.merchant ?? "") as string).toLowerCase().includes(wanted));
  if (rows.length === 0) throw new Refused(`No charge from "${merchant}" in the app. Use the merchant's name as Transactions shows it.`);
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return { key: ruleKeyFor(rows[0]), rows };
}

async function accountsByName(ctx: AppContext, part: string | undefined, among: Set<string> | null): Promise<Account> {
  const accounts = await call<Account[]>(ctx, "GET", "/accounts/manage");
  let pool = accounts.filter((a) => !a.archived && (!among || among.has(a.id)));
  if (part) {
    const p = part.toLowerCase();
    pool = pool.filter((a) => a.name.toLowerCase().includes(p) || displayAccountName(a.name).toLowerCase().includes(p));
  }
  if (pool.length === 1) return pool[0];
  if (pool.length === 0) throw new Refused(part ? `No account named like "${part}".` : "No account found.");
  throw new Refused(`Several accounts fit${part ? ` "${part}"` : ""}: ${pool.map((a) => displayAccountName(a.name)).join(", ")}. Add --account "<name part>" to pick one.`);
}

function cadenceOf(word: string | undefined): Cadence {
  const w = (word ?? "").toLowerCase().replace(/^every\s+/, "");
  const byWord: Record<string, Cadence> = { week: "weekly", weekly: "weekly", "2weeks": "biweekly", biweekly: "biweekly", month: "monthly", monthly: "monthly", quarter: "quarterly", quarterly: "quarterly", year: "annual", annual: "annual", yearly: "annual" };
  const c = byWord[w.replace(/\s/g, "")];
  if (!c) throw new Refused(`How often? One of: ${CADENCES.join(", ")}.`);
  return c;
}

async function currentPlan(ctx: AppContext, today: string): Promise<Plan> {
  const plans = await call<Plan[]>(ctx, "GET", "/plans");
  const plan = planForMonth(plans, today.slice(0, 7));
  if (!plan) throw new Refused("No budget year in the app yet. Set one up on the Budget screen first.");
  return plan;
}

/**
 * Runs one app verb. Returns false when the words are not an app verb (finance.ts then tries
 * its own). Throws Refused with plain words for anything the app or the input refuses.
 */
export async function runAppVerb(argv: string[], ctx: AppContext, today = new Date().toISOString().slice(0, 10)): Promise<boolean> {
  const words = positional(argv);
  const [cmd, sub, ...rest] = words;

  if (cmd === "accounts" && !sub) {
    const [accounts, balances] = await Promise.all([call<Account[]>(ctx, "GET", "/accounts/manage"), call<{ accountId: string; balanceCents: number }[]>(ctx, "GET", "/account-balances")]);
    const bal = new Map(balances.map((b) => [b.accountId, b.balanceCents]));
    for (const a of accounts.filter((x) => !x.archived)) {
      const tags = [a.includeInSpend ? "counted" : "not counted", a.drawable === false ? "not drawable" : "", a.maaserPot ? "charity pot account" : "", a.savingsDestination ? `money put away: ${a.savingsDestination}` : ""].filter(Boolean);
      ctx.out(`${displayAccountName(a.name).padEnd(34)} ${formatCents(bal.get(a.id) ?? a.balanceCents ?? 0).padStart(14)}  ${tags.join(", ")}`);
    }
    return true;
  }

  if (cmd === "recurring" && sub === "list") {
    const choices = await call<{ label: string; amountCents?: number | null; cadence: Cadence | null; choice: string; accountId: string }[]>(ctx, "GET", "/recurring-choices");
    const accounts = await call<Account[]>(ctx, "GET", "/accounts/manage");
    const name = (id: string) => displayAccountName(accounts.find((a) => a.id === id)?.name ?? id);
    if (choices.length === 0) ctx.out("No marks yet. The Recurring screen lists what the app finds on its own.");
    for (const c of choices) {
      const amount = c.amountCents ? `charges of about ${formatCents(c.amountCents)}` : "every charge";
      ctx.out(c.choice === "recurring" ? `${c.label}: recurring, ${CADENCE_LABELS[c.cadence!].toLowerCase()}, ${amount}, on ${name(c.accountId)}` : `${c.label}: not recurring (hidden), ${amount}, on ${name(c.accountId)}`);
    }
    return true;
  }

  if (cmd === "recurring" && (sub === "mark" || sub === "unmark" || sub === "hide")) {
    const [merchant, amountWord, cadenceWord] = rest;
    if (!merchant) throw new Refused(APP_USAGE);
    const { key, rows } = await merchantRows(ctx, merchant);
    const account = await accountsByName(ctx, flag(argv, "--account"), new Set(rows.map((r) => r.accountId)));
    const label = flag(argv, "--label") ?? ((rows[0].payee ?? rows[0].merchant ?? key) as string);
    const amountCents = amountWord && amountWord.toLowerCase() !== "all" ? dollars(amountWord) : null;
    const where = `${label} on ${displayAccountName(account.name)}${amountCents ? `, charges of about ${formatCents(amountCents)}` : ""}`;
    if (sub === "unmark") {
      const q = new URLSearchParams({ payeeKey: key, accountId: account.id });
      if (amountCents) q.set("amountCents", String(amountCents));
      await call(ctx, "DELETE", `/recurring-choices?${q}`);
      done(ctx, `Removed the mark on ${where}. The Recurring screen shows what the app finds on its own.`);
      return true;
    }
    if (sub === "hide") {
      await call(ctx, "PUT", "/recurring-choices", { payeeKey: key, accountId: account.id, choice: "not_recurring", cadence: null, label, ...(amountCents ? { amountCents } : {}) });
      done(ctx, `Marked ${where} as not recurring. Show again: finance recurring unmark.`);
      return true;
    }
    if (!amountWord) throw new Refused("Say the amount in dollars, or all for every charge, then how often.");
    const cadence = cadenceOf(cadenceWord);
    await call(ctx, "PUT", "/recurring-choices", { payeeKey: key, accountId: account.id, choice: "recurring", cadence, label, ...(amountCents ? { amountCents } : {}) });
    done(ctx, `Marked ${where} as recurring, ${CADENCE_LABELS[cadence].toLowerCase()}.`);
    return true;
  }

  if (cmd === "budget" && sub === "change") {
    const [line, amountWord] = rest;
    if (!line || !amountWord) throw new Refused(APP_USAGE);
    const amountCents = dollars(amountWord);
    const from = flag(argv, "--from") ?? null;
    if (from && !/^\d{4}-\d{2}$/.test(from)) throw new Refused("--from takes a month as YYYY-MM, such as 2026-11.");
    const plan = await currentPlan(ctx, from ? `${from}-01` : today);
    await call(ctx, "POST", `/plans/${encodeURIComponent(plan.id)}/lines/${encodeURIComponent(line)}/change`, { fromMonth: from, amountCents });
    done(ctx, `${line}: ${formatCents(amountCents)} a month ${from ? `from ${from} on` : "every month of " + plan.name}.`);
    return true;
  }

  if (cmd === "pot" && sub === "floor") {
    const floorCents = dollars(rest[0] ?? "");
    await call(ctx, "POST", "/settings/maaser-floor", { floorCents });
    done(ctx, `The charity pot's account keeps at least ${formatCents(floorCents)}.`);
    return true;
  }
  if (cmd === "pot" && sub === "account") {
    const account = await accountsByName(ctx, rest[0], null);
    await call(ctx, "POST", `/accounts/${encodeURIComponent(account.id)}/maaser-pot`, { on: true });
    done(ctx, `${displayAccountName(account.name)} is the charity pot's account.`);
    return true;
  }

  if (cmd === "file") {
    const [merchant, category] = [sub, rest[0]];
    if (!merchant || !category) throw new Refused(APP_USAGE);
    const { key, rows } = await merchantRows(ctx, merchant);
    const txn = rows[0];
    const isTransfer = category.trim().toLowerCase() === "transfer";
    const all = argv.includes("--all");
    const note = "Set from the command line";
    const rule = all && key ? (isTransfer ? { priority: HAND_PRIORITY, payeeContains: key, action: "transfer", note } : { priority: HAND_PRIORITY, payeeContains: key, action: "categorize", toCategory: category, note }) : null;
    const adjustment = all ? null : { matchKind: "id", sourceTransactionId: txn.sourceTransactionId, action: isTransfer ? "transfer" : "recategorize", toCategory: isTransfer ? null : category, note };
    await call(ctx, "POST", "/categorizations", {
      sourceTransactionId: txn.sourceTransactionId,
      label: (txn.payee ?? txn.merchant ?? key) as string,
      fromCategory: txn.sourceCategory ?? "",
      toCategory: isTransfer ? "Transfer (not spending)" : category,
      rule,
      adjustment,
    });
    done(ctx, all ? `${txn.payee ?? txn.merchant}: every charge files as ${category} from now on (a rule).` : `${txn.payee ?? txn.merchant} on ${txn.date}, ${formatCents(txn.amountCents)}: filed as ${category}. Undo on the Transactions screen.`);
    return true;
  }

  if (cmd === "sync") {
    const r = await call<{ summary: { inserted: number; updated: number; accounts: number; errors: { message?: string }[]; signInNeeded: string[]; needsReconnect: boolean } }>(ctx, "POST", "/simplefin/sync");
    if (!r) return true;
    const s = r.summary;
    ctx.out(`Bank sync: ${s.inserted} new, ${s.updated} updated, ${s.accounts} accounts.`);
    for (const bank of s.signInNeeded ?? []) ctx.out(`Needs a sign-in on the Bridge: ${bank}`);
    if (s.needsReconnect) ctx.out("The bank connection needs a fresh setup token (Settings, Bank connection).");
    return true;
  }

  return false;
}

export function isRefusal(e: unknown): e is Refused {
  return e instanceof Refused;
}
