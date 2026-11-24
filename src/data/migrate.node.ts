import Database from "better-sqlite3";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dumpSchema } from "../../scripts/schema-dump.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const START = "0000_start.sql";
type Version = "new" | "current" | "bridge" | "older";

export class OlderDatabaseError extends Error {
  constructor() {
    super("This database is from an older version. Bring it up to date first; see the upgrade note.");
  }
}

function version(db: Database.Database): Version {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'").pluck().all();
  if (names.includes("_migrations")) {
    if (!db.prepare("SELECT 1 FROM pragma_table_info('_migrations') WHERE name='name'").get()) return "older";
    if (db.prepare("SELECT 1 FROM _migrations WHERE name=?").get(START)) return "current";
  }
  if (!names.some(name => name !== "_migrations")) return "new";
  const reference = new Database(":memory:");
  try {
    reference.exec(readFileSync(join(MIGRATIONS_DIR, START), "utf8"));
    return dumpSchema(db) === dumpSchema(reference) ? "bridge" : "older";
  } finally { reference.close(); }
}

export function checkDatabaseVersion(path: string): Version {
  if (path === ":memory:" || !statSync(path, { throwIfNoEntry: false })) return "new";
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try { return db.transaction(() => version(db))(); }
  finally { db.close(); }
}

export function applyMigrations(db: Database.Database, dir?: string): void {
  const folder = dir ?? MIGRATIONS_DIR;
  const files = readdirSync(folder).filter(name => name.endsWith(".sql")).sort();
  const record = (name: string) =>
    db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());

  db.transaction(() => {
    const state = dir === undefined ? version(db) : null;
    if (state === "older") throw new OlderDatabaseError();
    db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT)");
    if (state === "bridge") record(START);
  }).immediate();

  const recorded = db.prepare("SELECT 1 FROM _migrations WHERE name=?");
  for (const file of files) {
    if (recorded.get(file)) continue;
    const sql = readFileSync(join(folder, file), "utf8");
    // Historical scripts used by the private upgrade may manage their own transaction.
    if (/^\s*BEGIN\b/im.test(sql)) {
      db.exec(sql);
      record(file);
    } else {
      db.transaction(() => {
        if (recorded.get(file)) return;
        db.exec(sql);
        record(file);
      }).immediate();
    }
  }
}
