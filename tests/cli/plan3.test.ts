import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

// Windows note: `npx` resolves to npx.cmd, which execFileSync (without shell:true)
// cannot exec directly (ENOENT). Invoke node directly with the tsx loader instead —
// this still runs the real CLI in a separate child process end-to-end.
const run = (db: string, ...args: string[]) =>
  execFileSync(process.execPath, ["--import", "tsx", "cli/finance.ts", ...args, "--db", db], { encoding: "utf8" });

function seedAccountAndBalance(db: string, accountId: string, balanceCents: number) {
  // Bootstrap schema via a harmless CLI call, then seed an account + balance directly
  // (there is no CLI command for account balances; that's the sync's job).
  run(db, "actuals", "rollup", "--json");
  const conn = new Database(db);
  conn.prepare(
    `INSERT INTO accounts (id, name, type, institution, currency, is_owned, include_in_spend)
     VALUES (?, ?, 'depository', 'Test Bank', 'USD', 1, 1)`
  ).run(accountId, "Test Checking");
  conn.prepare(`INSERT INTO account_balances (account_id, balance_cents, as_of) VALUES (?, ?, ?)`).run(
    accountId,
    balanceCents,
    new Date().toISOString()
  );
  conn.close();
}

test("goal add/list, wishlist add/list, and runway --json return sane structured output (the Wish List never reaches the runway)", () => {
  const dir = mkdtempSync(join(tmpdir(), "finp3-"));
  const db = join(dir, "t.db");

  // Wide plan range so "today" always falls inside it with future months on both sides.
  run(db, "plan", "create", "wide", "Wide Plan", "2020-01-01", "2035-12-31");
  run(db, "budget", "set", "wide", "Income", "5000");
  run(db, "budget", "set", "wide", "Rent", "2000");

  seedAccountAndBalance(db, "acctA", 1000000); // $10,000.00 starting liquid

  // A goal, tracked but not fed into the forecast.
  run(db, "goal", "add", "g1", "Emergency Fund", "20000", "2030-01-01", "--priority", "1", "--current", "5000");

  // Two one-time wishes (the Wish List never feeds the forecast or the runway).
  run(db, "wishlist", "add", "w1", "New Laptop", "2500", "--priority", "2");
  run(db, "wishlist", "add", "w2", "Roof Repair", "3000", "--priority", "1");

  // goal list --json
  const goals = JSON.parse(run(db, "goal", "list", "--json"));
  expect(Array.isArray(goals)).toBe(true);
  expect(goals).toHaveLength(1);
  expect(goals[0].goal).toMatchObject({
    id: "g1", name: "Emergency Fund", goalType: "savings", targetAmountCents: 2000000, targetDate: "2030-01-01",
    currentAmountCents: 500000, plannedMonthlyCents: 0, archivedAt: null,
  });
  expect(goals[0].savedCents).toBe(500000); // no linked accounts: the outside amount alone
  expect(goals[0].progressPct).toBeCloseTo(0.25, 5);
  expect(typeof goals[0].recommendedMonthlyCents).toBe("number");
  expect(goals[0].status).toBe("no_plan");
  expect(goals[0].forecastPeriod).toBeNull();

  // wishlist list --json
  const wishItems = JSON.parse(run(db, "wishlist", "list", "--json"));
  expect(Array.isArray(wishItems)).toBe(true);
  expect(wishItems).toHaveLength(2);
  expect(wishItems.map((i: any) => [i.id, i.name, i.costCents, i.priority])).toEqual([["w2", "Roof Repair", 300000, 1], ["w1", "New Laptop", 250000, 2]]);
  expect(wishItems.every((i: any) => i.kind === "wish" && i.targetDate === null && i.planningCategory === null)).toBe(true);
  expect(wishItems.some((i: any) => "feedsForecast" in i || "affordablePeriod" in i)).toBe(false);

  // runway --json
  const runway = JSON.parse(run(db, "runway", "wide", "--json"));
  expect(runway.startingLiquidCents).toBe(1000000);
  expect(Array.isArray(runway.liquidByMonth)).toBe(true);
  expect(runway.liquidByMonth.length).toBeGreaterThan(0);
  expect("runwayMonths" in runway).toBe(true);
  expect("crossZeroPeriod" in runway).toBe(true);
  expect("wishlistAffordability" in runway).toBe(false);

  // The wishes never reach the runway: every month rises by income($5000) - rent($2000) = $3000.
  runway.liquidByMonth.forEach((m: any, i: number) => {
    const prior = i === 0 ? runway.startingLiquidCents : runway.liquidByMonth[i - 1].cents;
    expect(m.cents - prior).toBe(300000);
  });
});

test("goal link/unlink: an entire-balance link reads the synced balance; a fixed slice adds its amount", () => {
  const dir = mkdtempSync(join(tmpdir(), "finp3-links-"));
  const db = join(dir, "t.db");
  seedAccountAndBalance(db, "acctA", 1000000); // $10,000.00 in Test Checking

  run(db, "goal", "add", "g1", "Vacation", "3000", "--type", "vacation", "--planned", "250");
  const [added] = JSON.parse(run(db, "goal", "list", "--json"));
  expect(added.goal).toMatchObject({ goalType: "vacation", targetDate: null, plannedMonthlyCents: 25000 });
  expect(added.savedCents).toBe(0);

  // Entire balance: the goal reads the whole $10,000, which already covers $3,000.
  expect(JSON.parse(run(db, "goal", "link", "g1", "acctA", "entire"))).toEqual([
    { goalId: "g1", accountId: "acctA", mode: "entire", amountCents: null },
  ]);
  const [entire] = JSON.parse(run(db, "goal", "list", "--json"));
  expect(entire.savedCents).toBe(1000000);
  expect(entire.status).toBe("fully_saved"); // 100% saved is Fully saved; Completed is Mark complete
  expect(entire.funding.byAccount).toEqual([
    { accountId: "acctA", accountName: "Test Checking", mode: "entire", cents: 1000000, balanceKnown: true },
  ]);

  // A fixed $1,000 slice instead: $2,000 left at $250/mo = 8 contributions from this month, so done 7 months out.
  expect(JSON.parse(run(db, "goal", "unlink", "g1", "acctA"))).toEqual([]);
  run(db, "goal", "link", "g1", "acctA", "fixed", "1000");
  const [fixed] = JSON.parse(run(db, "goal", "list", "--json"));
  expect(fixed.savedCents).toBe(100000);
  expect(fixed.monthsUntilDone).toBe(7);
  expect(fixed.status).toBe("no_plan"); // planned, but no target date to be on track for

  // The same account cannot fund two goals with its entire balance.
  run(db, "goal", "add", "g2", "Car", "5000");
  run(db, "goal", "link", "g1", "acctA", "entire");
  expect(() => run(db, "goal", "link", "g2", "acctA", "entire")).toThrow(/already funds another goal/);
});

// The CLI read accounts raw, so a goal funded by
// one of the partner's accounts counted it even with the include setting off,
// while the Goals screen did not. It also let a goal take an account's entire
// balance while another goal sliced it.
test("goal list honors Include the partner's accounts, and goal link refuses a double claim", () => {
  const dir = mkdtempSync(join(tmpdir(), "finp3-partner-"));
  const db = join(dir, "t.db");
  seedAccountAndBalance(db, "acctPartner", 1000000); // $10,000.00
  const conn = new Database(db);
  conn.prepare("UPDATE accounts SET owner = 'partner' WHERE id = 'acctPartner'").run();
  conn.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES ('include_partner_accounts','false')").run();
  conn.close();

  run(db, "goal", "add", "g1", "Vacation", "3000");
  run(db, "goal", "link", "g1", "acctPartner", "entire");
  // Setting off: the account does not count, so nothing is saved.
  expect(JSON.parse(run(db, "goal", "list", "--json"))[0].savedCents).toBe(0);

  const on = new Database(db);
  on.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES ('include_partner_accounts','true')").run();
  on.close();
  expect(JSON.parse(run(db, "goal", "list", "--json"))[0].savedCents).toBe(1000000);

  // g1 holds the entire balance, so g2 cannot take a slice of it.
  run(db, "goal", "add", "g2", "Car", "5000");
  expect(() => run(db, "goal", "link", "g2", "acctPartner", "fixed", "100")).toThrow(/already funds another goal/);
  // And with a slice held, the entire balance cannot go to another goal.
  run(db, "goal", "unlink", "g1", "acctPartner");
  run(db, "goal", "link", "g1", "acctPartner", "fixed", "100");
  expect(() => run(db, "goal", "link", "g2", "acctPartner", "entire")).toThrow(/fixed amount of that account/);
});

// The goal list shows a goal's ongoing cost
// and, once it has started, the month it did.
test("goal list shows a goal's ongoing cost, and the month it started", () => {
  const dir = mkdtempSync(join(tmpdir(), "fin-cli-cost-"));
  const db = join(dir, "t.db");
  run(db, "goal", "add", "house", "House", "10000", "2030-09-01");
  run(db, "goal", "add", "ma", "Toy club", "225");
  const conn = new Database(db);
  conn.prepare("UPDATE goals SET ongoing_monthly_cents = 10000 WHERE id = 'house'").run();
  conn.prepare("UPDATE goals SET ongoing_monthly_cents = 20000, ongoing_started_period = '2026-10' WHERE id = 'ma'").run();
  conn.close();
  const lines = run(db, "goal", "list").trim().split(/\r?\n/);
  expect(lines.find((l) => l.startsWith("house"))).toMatch(/ cost=\$100\.00\/mo$/);
  expect(lines.find((l) => l.startsWith("ma"))).toMatch(/ cost=\$200\.00\/mo started 2026-10$/);
});

// Finding 1: goal add on an existing goal keeps its started cost.
test("goal add on an existing goal keeps its ongoing cost and marks", () => {
  const dir = mkdtempSync(join(tmpdir(), "fin-cli-keep-"));
  const db = join(dir, "t.db");
  run(db, "goal", "add", "ma", "Toy club", "225");
  const conn = new Database(db);
  conn.prepare("UPDATE goals SET ongoing_monthly_cents = 20000, ongoing_started_period = '2026-10', ongoing_budget_line = 'Toy club', completed_at = '2026-10-01T00:00:00.000Z' WHERE id = 'ma'").run();
  conn.close();
  run(db, "goal", "add", "ma", "Toy club, renamed", "300");
  const row = new Database(db).prepare("SELECT * FROM goals WHERE id = 'ma'").get() as Record<string, unknown>;
  expect(row).toMatchObject({ name: "Toy club, renamed", ongoing_monthly_cents: 20000, ongoing_started_period: "2026-10", ongoing_budget_line: "Toy club", completed_at: "2026-10-01T00:00:00.000Z" });
});
