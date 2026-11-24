import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { SAMPLE_STAMP_KEY } from "../../src/domain/sample-data.js";
import { cleanHousehold } from "../../src/domain/household.js";
import { stillToSetUp } from "../../src/domain/setup-progress.js";

// The builder runs as its own process, as it does from the command line, with LOCALAPPDATA
// pointed at a made-up folder that stands in for the real one.
let root: string;
let local: string;

function build(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "demo/build-sample-db.ts", ...args], {
    env: { ...process.env, LOCALAPPDATA: local },
    encoding: "utf8",
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sample-instance-"));
  local = join(root, "local");
  mkdirSync(join(local, "finance"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("building the sample database", () => {
  it("refuses any destination but the sample folder or a folder inside the temp folder", () => {
    const outside = join(process.cwd(), ".sample-refused-" + Date.now());
    const liveFolder = join(local, "finance");
    try {
      for (const dest of [outside, local, liveFolder.toUpperCase(), liveFolder + "/", liveFolder + "\\"]) {
        const r = build("--test-dir", dest);
        expect(r.status, dest).toBe(2);
      }
      expect(existsSync(outside)).toBe(false);
      expect(existsSync(join(local, "finance", "finance.db"))).toBe(false);
      expect(existsSync(join(local, "finance", "finance"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a database it did not build", () => {
    const dest = join(root, "other");
    const file = join(dest, "finance", "finance.db");
    mkdirSync(join(dest, "finance"), { recursive: true });
    const db = new Database(file);
    db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.close();
    const hash = () => createHash("sha256").update(readFileSync(file)).digest("hex");
    const before = hash();
    expect(build("--test-dir", dest).status).toBe(2);
    expect(hash()).toBe(before);
  });

  it("builds a stamped database with accounts, transactions and budget lines", () => {
    const dest = join(root, "sample");
    const r = build("--test-dir", dest);
    expect(r.status, r.stderr).toBe(0);
    const db = new Database(join(dest, "finance", "finance.db"), { readonly: true });
    try {
      expect(db.prepare("SELECT value FROM app_settings WHERE key = 'sample_data'").pluck().get()).toBe("true");
      for (const table of ["accounts", "transactions", "budget_lines"]) {
        expect(db.prepare(`SELECT count(*) FROM ${table}`).pluck().get(), table).toBeGreaterThan(0);
      }
      const household = db.prepare("SELECT value FROM app_settings WHERE key = 'household'").pluck().get() as string;
      expect(cleanHousehold(JSON.parse(household))).toEqual({ youName: "Alex", partnerName: "Sam" });
      expect(db.prepare("SELECT count(*) FROM accounts WHERE owner NOT IN ('me', 'partner', 'joint')").pluck().get()).toBe(0);
      // The sample opens on its figures, never on the first-run interview.
      const progress = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'setup_progress'").pluck().get() as string);
      expect(stillToSetUp(progress)).toEqual([]);
      expect(progress.finishedAt).toBeTruthy();
    } finally {
      db.close();
    }
  });
});

// A server on its own made-up database. The modules are loaded afresh each time, so each
// server opens its own database and reads its own stamp.
async function openFresh(stamped: boolean) {
  vi.resetModules();
  // Left in the temp folder like the other server tests: the open database holds the file on Windows.
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "sample-server-"));
  const { openRepo } = await import("../../server/db/openDb.js");
  const repo = openRepo();
  if (stamped) repo.setSetting(SAMPLE_STAMP_KEY, "true");
  return repo;
}

async function listen(): Promise<{ server: Server; url: string }> {
  const { buildApp } = await import("../../server/app.js");
  return new Promise((resolve) => {
    const server = buildApp().listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

describe("a server on sample data", () => {
  const savedLocal = process.env.LOCALAPPDATA;
  afterEach(() => { process.env.LOCALAPPDATA = savedLocal; });

  it("says whether it is the sample", async () => {
    for (const stamped of [true, false]) {
      await openFresh(stamped);
      const { server, url } = await listen();
      try {
        expect(await (await fetch(`${url}/api/instance`)).json()).toEqual({ sample: stamped });
      } finally {
        server.close();
      }
    }
  });

  it("refuses a bank route", async () => {
    await openFresh(true);
    const { SAMPLE_NO_BANK } = await import("../../server/instance.js");
    const { server, url } = await listen();
    try {
      const res = await fetch(`${url}/api/simplefin/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(SAMPLE_NO_BANK);
    } finally {
      server.close();
    }
  });

  it("makes no bank call at start, with no environment flags set", async () => {
    const repo = await openFresh(true);
    // A link whose last sync is long past: an ordinary database would sync now.
    repo.setSimpleFinState({ accessUrl: "https://user:pass@bridge.example/simplefin", lastSyncedAt: "2020-01-01T00:00:00.000Z", earliestBackfilled: null, lastErrors: [] });
    const { startServer } = await import("../../server/start.js");
    const fetchFn = vi.fn();
    const started = await startServer({ port: 0, env: {}, fetchFn: fetchFn as unknown as typeof fetch });
    try {
      await started.startupSync;
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      started.server.close();
    }
  });
});
