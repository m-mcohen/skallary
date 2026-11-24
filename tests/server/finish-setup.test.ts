// tests/server/finish-setup.test.ts -- the end of the first-run interview and
// Set up budget's standard categories. Each test opens its own fresh database.
import { beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STANDARD_CATEGORIES } from "../../src/domain/starter-set";
import { demoBudgetLines } from "../demo";

let setup: typeof import("../../server/services/setupService.js");
let settings: typeof import("../../server/services/settingsService.js");
let starter: typeof import("../../server/services/starterService.js");
let repo: import("../../src/data/repo.node.js").NodeRepository;
const now = () => new Date(2026, 2, 10, 12);

beforeEach(async () => {
  vi.resetModules();
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-finish-"));
  setup = await import("../../server/services/setupService.js");
  settings = await import("../../server/services/settingsService.js");
  starter = await import("../../server/services/starterService.js");
  repo = (await import("../../server/db/openDb.js")).openRepo();
});

test("finishing makes this year's budget once and saves the finish time once", () => {
  expect(setup.setupService(now).finishSetup()).toEqual({ planId: "plan-2026", created: true });
  const first = settings.getSetupProgress().finishedAt;
  expect(first).toBeTruthy();
  expect(setup.setupService(() => new Date(2026, 5, 1)).finishSetup()).toEqual({ planId: "plan-2026", created: false });
  expect(repo.listPlans()).toHaveLength(1);
  expect(repo.getBudgetLines("plan-2026")).toEqual([]);
  expect(settings.getSetupProgress().finishedAt).toBe(first);
});

test("finishing never touches a budget that already covers the year", () => {
  repo.createPlan({ id: "plan-2026", name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
  for (const l of demoBudgetLines()) repo.setBudgetLine({ ...l, planId: "plan-2026" });
  const before = JSON.stringify(repo.getBudgetLines("plan-2026"));
  expect(setup.setupService(now).finishSetup()).toEqual({ planId: "plan-2026", created: false });
  expect(JSON.stringify(repo.getBudgetLines("plan-2026"))).toBe(before);
  expect(repo.listPlans()).toHaveLength(1);
});

test("Set up budget offers the standard categories once the household files to them, even with no history", () => {
  repo.createPlan({ id: "plan-2026", name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
  // A household with a filing choice saved that never took the standard categories (an existing
  // one) sees none of them.
  settings.setStarterFiling("categories-only");
  expect(setup.setupService(now).suggestions("plan-2026")).toEqual([]);
  starter.applyStarterFiling("categories-only");
  const rows = setup.setupService(now).suggestions("plan-2026");
  const spending = STANDARD_CATEGORIES.filter((c) => c.side === "spending").map((c) => c.name);
  expect(rows.map((s) => s.planningCategory)).toEqual(expect.arrayContaining(spending));
  for (const r of rows) expect(r.amountCents).toBe(0);
  for (const c of STANDARD_CATEGORIES.filter((c) => c.side !== "spending")) {
    expect(rows.map((s) => s.planningCategory)).not.toContain(c.name);
  }
});

test("a finish reached without the filing step adds the standard categories, and Set up budget offers them before and after", () => {
  repo.createPlan({ id: "plan-2026", name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
  const spending = STANDARD_CATEGORIES.filter((c) => c.side === "spending").map((c) => c.name);
  // No filing choice saved yet: Set up budget still offers them.
  expect(setup.setupService(now).suggestions("plan-2026").map((s) => s.planningCategory)).toEqual(expect.arrayContaining(spending));
  setup.setupService(now).finishSetup();
  expect(settings.getStarterFiling()).toBe("categories-only");
  expect(Object.values(repo.getCategoryMappings())).toEqual(expect.arrayContaining(spending));
  expect(setup.setupService(now).suggestions("plan-2026").map((s) => s.planningCategory)).toEqual(expect.arrayContaining(spending));
});
