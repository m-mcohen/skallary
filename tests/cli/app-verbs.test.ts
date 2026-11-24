// tests/cli/app-verbs.test.ts -- the CLI verbs that talk to the running app.
// A real server on a temp database (as tests/server/*.test.ts), the real CLI in a child process
// pointed at it with --port. Every effect is read back through the app's own GET calls.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeRepository } from "../../src/data/repo.node.js";

let server: Server;
let port: number;
let repo: NodeRepository;
const get = async (path: string) => (await fetch(`http://127.0.0.1:${port}/api${path}`)).json();

/**
 * Runs the CLI in a child process, asynchronously: the server it talks to lives on this
 * worker's own event loop, so a synchronous spawn would block the loop and deadlock the child.
 * Resolves with stdout, or rejects with stderr in the message on a non-zero exit.
 */
const run = (...args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(process.execPath, ["--import", "tsx", "cli/finance.ts", ...args, "--port", String(port)], { encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(new Error(`exit ${(err as { code?: number }).code}: ${String(stderr).trim()}`));
      else resolve(String(stdout));
    });
  });

const txn = (id: string, accountId: string, date: string, amountCents: number, merchant: string, sourceCategory: string | null = null) =>
  ({ sourceTransactionId: id, accountId, date, amountCents, sourceCategory, merchant, payee: merchant, isTransfer: false, sourceUpdatedAt: null }) as const;

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-cli-app-"));
  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  repo.upsertAccounts([
    { id: "card", name: "REWARDS CARD (0303)", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
    { id: "chk", name: "PERSONAL CHECKING (0101)", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
    { id: "pot", name: "GIVING (0505)", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
  ]);
  repo.upsertTransactions(
    [
      txn("a1", "card", "2026-07-30", -20000, "Anthropic Claude Sub", "Business Software"),
      txn("a2", "card", "2026-08-31", -20000, "Anthropic Claude Sub", "Business Software"),
      txn("a3", "card", "2026-09-30", -10000, "Anthropic Claude Sub", "Business Software"),
      txn("b1", "chk", "2026-08-03", -200000, "Zelle Transfer To Maple Realty", "Rent"),
      txn("b2", "chk", "2026-08-03", -7000, "Zelle Transfer To Maple Realty", "Internet & Cable"),
      txn("g1", "card", "2026-10-02", -4200, "Publix"),
    ] as never,
    "simplefin",
  );
  repo.createPlan({ id: "plan-2026", name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("recurring marks", () => {
  test("mark with an amount: the merchant's key, its account found from its charges, the amount in cents", async () => {
    const out = await run("recurring", "mark", "Anthropic Claude Sub", "200", "monthly");
    expect(out).toContain("Marked Anthropic Claude Sub on Rewards Card (0303), charges of about $200.00 as recurring, every month.");
    const choices = await get("/recurring-choices");
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ payeeKey: "anthropic claude sub", accountId: "card", choice: "recurring", cadence: "monthly", amountCents: 20000 });
  });
  test("two marks on one merchant, then unmark one by its amount", async () => {
    await run("recurring", "mark", "Zelle Transfer To Maple Realty", "2000", "monthly", "--label", "Maple Realty, rent");
    await run("recurring", "mark", "Zelle Transfer To Maple Realty", "70", "monthly", "--label", "Maple Realty, internet");
    let landlord = (await get("/recurring-choices")).filter((c: { payeeKey: string }) => c.payeeKey === "zelle transfer to maple realty");
    expect(landlord.map((c: { label: string; amountCents: number }) => [c.label, c.amountCents]).sort()).toEqual([["Maple Realty, rent", 200000], ["Maple Realty, internet", 7000]].sort());
    expect(await run("recurring", "unmark", "Zelle Transfer To Maple Realty", "70")).toContain("Removed the mark");
    landlord = (await get("/recurring-choices")).filter((c: { payeeKey: string }) => c.payeeKey === "zelle transfer to maple realty");
    expect(landlord.map((c: { amountCents: number }) => c.amountCents)).toEqual([200000]);
    expect(await run("recurring", "list")).toContain("Maple Realty, rent: recurring, every month, charges of about $2,000.00, on Personal Checking (0101)");
  });
  test("a merchant the app has never seen, a bad amount and a bad rhythm are refused in words, exit 1", async () => {
    await expect(run("recurring", "mark", "Nobody Inc", "10", "monthly")).rejects.toThrow(/No charge from "Nobody Inc"/);
    await expect(run("recurring", "mark", "Publix", "lots", "monthly")).rejects.toThrow(/not an amount in dollars/);
    await expect(run("recurring", "mark", "Publix", "42", "sometimes")).rejects.toThrow(/How often/);
  });
  test("--dry-run prints the call and sends nothing", async () => {
    const before = (await get("/recurring-choices")).length;
    const out = await run("recurring", "mark", "Publix", "all", "weekly", "--dry-run");
    expect(out).toContain("Would send PUT /recurring-choices");
    expect((await get("/recurring-choices")).length).toBe(before);
  });
});

describe("the pot, the budget and filing", () => {
  test("pot floor and pot account", async () => {
    expect(await run("pot", "floor", "1500")).toContain("keeps at least $1,500.00");
    expect(await get("/settings/maaser-floor")).toEqual({ floorCents: 150000 });
    expect(await run("pot", "account", "giving")).toContain("is the charity pot's account.");
    expect((await get("/accounts/manage")).find((a: { id: string }) => a.id === "pot").maaserPot).toBe(true);
  });
  test("budget change from a month on lands on the budget year that holds it", async () => {
    expect(await run("budget", "change", "Groceries", "450", "--from", "2026-11")).toContain("Groceries: $450.00 a month from 2026-11 on.");
    const extras = await get("/plans/plan-2026/budget-extras");
    expect(extras.changes).toHaveLength(1);
    expect(extras.changes[0]).toMatchObject({ planningCategory: "Groceries", fromMonth: "2026-11", amountCents: 45000, reason: "changed" });
  });
  test("file the newest charge from a merchant; --all makes a rule for every charge", async () => {
    expect(await run("file", "Publix", "Groceries")).toContain("Publix on 2026-10-02, -$42.00: filed as Groceries.");
    const log = await get("/categorizations");
    expect(log[0]).toMatchObject({ label: "Publix", toCategory: "Groceries" });
    expect(log[0].adjustmentId).not.toBeNull();
    expect(await run("file", "Publix", "Groceries", "--all")).toContain("every charge files as Groceries from now on");
    const rules = await get("/rules");
    expect(rules.some((r: { payeeContains?: string; toCategory?: string }) => r.payeeContains === "publix" && r.toCategory === "Groceries")).toBe(true);
  });
  test("accounts lists balances and the switches in plain words", async () => {
    const out = await run("accounts");
    expect(out).toContain("Giving (0505)");
    expect(out).toContain("charity pot account");
    expect(out).toContain("not counted");
  });
  test("the older database verbs still work and do not need the app", async () => {
    const out = execFileSync(process.execPath, ["--import", "tsx", "cli/finance.ts", "plan", "list", "--json", "--db", join(mkdtempSync(join(tmpdir(), "fin-cli-db-")), "t.db")], { encoding: "utf8" });
    expect(JSON.parse(out)).toEqual([]);
  });
});
