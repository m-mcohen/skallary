// tests/server/settings-household.test.ts -- a fresh database from the starting migration.
import { beforeAll, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let settings: typeof import("../../server/services/settingsService.js");

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-settings-household-"));
  settings = await import("../../server/services/settingsService.js");
});

test("with nothing saved, the partner's accounts count", () => {
  expect(settings.getIncludePartnerAccounts()).toBe(true);
  settings.setIncludePartnerAccounts(false);
  expect(settings.getIncludePartnerAccounts()).toBe(false);
});
