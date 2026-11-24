// tests/server/settings-defaults.test.ts -- the household settings on a fresh database from the
// starting migration (lane contracts, section 1): what each reads when absent, and the routes
// refusing a bad value without writing anything.
import { afterAll, beforeAll, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let settings: typeof import("../../server/services/settingsService.js");
let progress: typeof import("../../src/domain/setup-progress.js");
let allSettingsRows: () => unknown[];
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-settings-defaults-"));
  settings = await import("../../server/services/settingsService.js");
  progress = await import("../../src/domain/setup-progress.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  const { buildApp } = await import("../../server/app.js");
  const db = openRepo().connection();
  allSettingsRows = () => db.prepare("SELECT key, value FROM app_settings ORDER BY key").all();
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test("every new setting reads its contract default when absent", async () => {
  expect(settings.getCharityPotStored()).toBeNull();
  expect(settings.getTaxProfile()).toEqual({ filingStatus: null, children: null });
  expect(settings.getStarterFiling()).toBeNull();
  expect(settings.getLifestyleGroupsStored()).toBeNull();
  expect(settings.getBankGraceDays()).toEqual({});
  expect(settings.getLaunchBrowser()).toBeNull();
  expect(settings.getSetupProgress()).toEqual({});
  // A blank child count is absent too (contracts Revision 5), never a count of zero.
  const { sqliteFinanceRepository } = await import("../../server/repositories/sqliteFinanceRepository.js");
  sqliteFinanceRepository().setSetting("salary_child_count", " ");
  expect(settings.getTaxProfile().children).toBeNull();
});

test.each([
  // Complete but for its kind, so only the kind can refuse it.
  ["/settings/charity-pot", {
    on: true, name: "Giving", kind: "weekly", fixedCents: 5000, fixedFrom: null,
    counts: { me: true, partner: true, joint: true },
  }],
  ["/settings/tax", { filingStatus: "joint", children: 1 }],
  ["/settings/bank-grace", { "example bank": -3 }],
  ["/settings/setup-progress/pay", { state: "maybe" }],
])("a malformed value is refused and nothing is written: %s", async (path, body) => {
  const rowsBefore = allSettingsRows();
  const res = await fetch(baseUrl + "/api" + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(400);
  expect(allSettingsRows()).toEqual(rowsBefore);
});

test("marking one interview step keeps the others; skipped steps are still to set up", () => {
  settings.setSetupStep("household", "done");
  settings.setSetupStep("pay", "skipped");
  const p = settings.getSetupProgress();
  expect(p).toEqual({ household: "done", pay: "skipped" });
  expect(progress.stillToSetUp(p)).toEqual(["pay", "tax", "charity", "holidays", "banks", "accounts", "filing"]);
});

test("one bad entry in the stored progress is dropped; the good ones survive the next step", async () => {
  const { sqliteFinanceRepository } = await import("../../server/repositories/sqliteFinanceRepository.js");
  sqliteFinanceRepository().setSetting("setup_progress", JSON.stringify({ household: "done", pay: "maybe", tax: "skipped" }));
  expect(settings.getSetupProgress()).toEqual({ household: "done", tax: "skipped" });
  settings.setSetupStep("charity", "done");
  expect(settings.getSetupProgress()).toEqual({ household: "done", tax: "skipped", charity: "done" });
});

test("one bad stored bank entry is dropped and the others keep their days; names save trimmed and lower case", async () => {
  const { sqliteFinanceRepository } = await import("../../server/repositories/sqliteFinanceRepository.js");
  sqliteFinanceRepository().setSetting("bank_grace_days", JSON.stringify({ "bank a": 5, "bank b": -3 }));
  expect(settings.getBankGraceDays()).toEqual({ "bank a": 5 });
  settings.setBankGraceDays({ "  Example Bank ": 7 });
  expect(settings.getBankGraceDays()).toEqual({ "example bank": 7 });
});
