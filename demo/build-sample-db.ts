// demo/build-sample-db.ts
//
// Builds the sample database from the migrations and the demo household, through the app's
// own repository and settings methods.
//
//   npx tsx demo/build-sample-db.ts                    -> %LOCALAPPDATA%\finance-sample\finance\finance.db
//   npx tsx demo/build-sample-db.ts --test-dir <path>  -> <path>\finance\finance.db, <path> inside the temp folder
//   either one with --end-month YYYY-MM                -> the twelve months ending there (default: this
//                                                         month, up to today, so a sample built today looks current)
//
// Any other destination is refused, and so is anything that is, or sits inside, the real
// app's folder (%LOCALAPPDATA%\finance) in any spelling. The first thing written is the
// setting sample_data = "true"; a database already at the destination is replaced only when
// it carries that stamp. Refusals exit with code 2 and change nothing.
import Database from "better-sqlite3";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ACCOUNT_IDS, buildDemo, householdOf } from "./household.js";
import { SAMPLE_STAMP_KEY } from "../src/domain/sample-data.js";
import { localDateIso } from "../src/domain/period.js";
import { writeYearly } from "./write-yearly.js";

const USAGE = "Usage: npx tsx demo/build-sample-db.ts [--test-dir <a folder inside the temp folder>] [--end-month YYYY-MM]";

function refuse(message: string): never {
  console.error(message);
  process.exit(2);
}

/** The path as the file system knows it: the nearest existing folder made real, in one letter case on Windows. */
function canonical(p: string): string {
  let head = resolve(p);
  const rest: string[] = [];
  while (!existsSync(head) && dirname(head) !== head) {
    rest.unshift(basename(head));
    head = dirname(head);
  }
  const real = join(existsSync(head) ? realpathSync.native(head) : head, ...rest);
  return process.platform === "win32" ? real.toLowerCase() : real;
}

/** True when `child` is `parent` itself or anywhere below it. */
function within(child: string, parent: string): boolean {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

/** The two options, each at most once, each with a value; anything else is refused. */
function parseArgs(argv: string[]): { testDir?: string; endMonth?: string } {
  const out: { testDir?: string; endMonth?: string } = {};
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (!value) return refuse(USAGE);
    if (flag === "--test-dir" && out.testDir === undefined) out.testDir = value;
    else if (flag === "--end-month" && out.endMonth === undefined && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) out.endMonth = value;
    else return refuse(USAGE);
  }
  return out;
}

function destination(testDir: string | undefined, live: string | undefined): string {
  if (!live) return refuse("LOCALAPPDATA is not set, so the sample folder cannot be found.");
  const liveBase = canonical(live);
  let base: string;
  if (testDir === undefined) {
    base = join(live, "finance-sample");
  } else {
    base = testDir;
    const temp = canonical(tmpdir());
    const c = canonical(base);
    if (c === temp || !within(c, temp)) return refuse("A test folder must be inside the system temp folder.");
  }
  // Never the real app's folder: its base (where finance\finance.db lives) or anything inside finance.
  const c = canonical(base);
  if (c === liveBase || within(c, join(liveBase, "finance"))) {
    return refuse("That is the real app's folder. The sample is never built there.");
  }
  return resolve(base);
}

/** Refuses unless the database at `file` carries the sample stamp. */
function assertStampedOrAbsent(file: string): void {
  if (!existsSync(file)) return;
  let stamped = false;
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(SAMPLE_STAMP_KEY) as { value: string } | undefined;
      stamped = row?.value === "true";
    } finally {
      db.close();
    }
  } catch {
    stamped = false;
  }
  if (!stamped) refuse("There is already a database there that this script did not build. Nothing was changed.");
}

const lastDayOf = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const base = destination(args.testDir, process.env.LOCALAPPDATA);
  const today = localDateIso();
  const DEMO = buildDemo({ endMonth: args.endMonth ?? today.slice(0, 7), through: today });
  const file = join(base, "finance", "finance.db");
  assertStampedOrAbsent(file);
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) rmSync(f, { force: true });

  // The app finds its database under LOCALAPPDATA; point it at the sample folder before any
  // module that opens the database is loaded.
  process.env.LOCALAPPDATA = base;
  process.env.FINANCE_NO_AUTOSYNC = "1";
  const { openRepo } = await import("../server/db/openDb.js");
  const { setIncomeSettings } = await import("../server/services/salarySettingsService.js");
  const { setHousehold, setIncludePartnerAccounts, setCharityPotStored, setTaxProfile, setSetupStep, markSetupFinished } = await import("../server/services/settingsService.js");
  const { SETUP_STEPS } = await import("../src/domain/setup-progress.js");

  const repo = openRepo();
  // First, so a build that stops part-way can still be rebuilt over.
  repo.setSetting(SAMPLE_STAMP_KEY, "true");

  // Accounts, then the flags upsertAccounts leaves alone.
  repo.upsertAccounts(DEMO.accounts.map((a) => a.account));
  for (const { account: a } of DEMO.accounts) {
    repo.setAccountOwner(a.id, a.owner);
    if (a.savingsDestination) repo.setAccountSavingsDestination(a.id, a.savingsDestination);
    if (a.maaserPot) repo.setAccountMaaserPot(a.id, true);
  }
  setHousehold(householdOf(DEMO.people));
  setIncludePartnerAccounts(true);
  // Every interview step done, so the sample opens on its figures, never on the first-run interview.
  for (const step of SETUP_STEPS) setSetupStep(step, "done");
  markSetupFinished("2026-01-01T00:00:00.000Z");

  // Transactions, recorded as an import, and a mapping of each category to itself.
  repo.upsertTransactions(DEMO.transactions, "csv");
  const mapped = repo.getCategoryMappings();
  for (const c of new Set(DEMO.transactions.map((t) => t.sourceCategory ?? "Uncategorized"))) {
    if (mapped[c] === undefined) repo.setCategoryMapping(c, c);
  }

  // A balance reading at each month's end, built from the opening balances and the rows.
  const running = new Map(DEMO.accounts.map((a) => [a.account.id, a.openingBalanceCents]));
  const months = [...new Set(DEMO.transactions.map((t) => t.date.slice(0, 7)))].sort();
  for (const ym of months) {
    for (const t of DEMO.transactions) if (t.date.slice(0, 7) === ym) running.set(t.accountId, (running.get(t.accountId) ?? 0) + t.amountCents);
    const asOf = lastDayOf(ym);
    repo.upsertAccountBalances([...running].map(([accountId, balanceCents]) => ({ accountId, balanceCents, asOf })), asOf);
  }

  // The budget year and its every-month lines.
  repo.startPlanWithLines(
    DEMO.plan,
    DEMO.budgetLines.map((l) => ({ line: l.planningCategory, amountCents: l.amountCents, source: l.source ?? "you" })),
    `${DEMO.plan.startDate}T12:00:00.000Z`,
  );

  // Settings, Salary: the salary, pay schedule and benefits.
  setIncomeSettings({
    currentSalary: DEMO.salary.current,
    additionalSalary: null,
    paySchedule: DEMO.salary.paySchedule,
    benefits: DEMO.salary.benefits,
  });
  // The tax profile: filing status and children, as the interview's tax step saves them.
  setTaxProfile({ filingStatus: DEMO.salary.filingStatus, children: DEMO.salary.children });
  // The charity pot: its name, kind, whose pay counts, and a percent pot's rate.
  const pot = DEMO.pot;
  setCharityPotStored({
    on: pot.on, name: pot.name, kind: pot.kind,
    fixedCents: pot.kind === "percent" ? null : pot.amount, fixedFrom: pot.kind === "percent" ? null : DEMO.plan.startDate.slice(0, 7),
    counts: { me: true, partner: true, joint: true },
    rateBps: pot.kind === "percent" ? Math.round(pot.amount * 100) : null,
  });

  // Yearly bills, a holiday raise and the US holiday calendar.
  await writeYearly(repo, ACCOUNT_IDS.checking, today);

  // The what-ifs.
  for (const w of DEMO.whatIfs) {
    repo.createWhatIf(DEMO.plan.id, w.whatIf.scenarioId, w.name, `${DEMO.plan.startDate}T12:00:00.000Z`);
    repo.saveWhatIf(w.whatIf);
  }

  console.log(
    `Sample data built in ${file}: ${repo.getAccounts().length} accounts, ${repo.getTransactions().length} transactions, ` +
      `${repo.getBudgetLines(DEMO.plan.id).length} budget lines.`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
