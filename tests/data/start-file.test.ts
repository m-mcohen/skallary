import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { dumpSchema } from "../../scripts/schema-dump";
import { applyMigrations, checkDatabaseVersion, OlderDatabaseError } from "../../src/data/migrate.node";
import { NodeRepository } from "../../src/data/repo.node";

const canonical = readFileSync(new URL("../fixtures/schema-canonical.txt", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = "0000_start.sql";
const folders: string[] = [];
function location() {
  const folder = mkdtempSync(join(tmpdir(), "toy-schema-"));
  folders.push(folder);
  return join(folder, "toy.db");
}
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function contents(db: Database.Database) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name <> '_migrations' AND name NOT GLOB 'sqlite_*' ORDER BY name").pluck().all() as string[];
  return Object.fromEntries(names.map(name => [name, db.prepare('SELECT * FROM "' + name.replace(/"/g, '""') + '"').all()]));
}

test("a missing file is new and inspecting it creates nothing", () => {
  const file = location();
  expect(checkDatabaseVersion(file)).toBe("new");
  expect(existsSync(file)).toBe(false);
});

test("the start file alone builds the canonical structure", () => {
  const only = mkdtempSync(join(tmpdir(), "toy-start-"));
  folders.push(only);
  copyFileSync(new URL("../../migrations/" + start, import.meta.url), join(only, start));
  const db = new Database(location());
  try {
    applyMigrations(db, only);
    expect(dumpSchema(db)).toBe(canonical);
  } finally { db.close(); }
});

test("a new database from the full folder is empty and its history starts with the start file", () => {
  const file = location();
  const db = new Database(file);
  try {
    applyMigrations(db);
    applyMigrations(db);
    expect(Object.values(contents(db)).every(rows => rows.length === 0)).toBe(true);
    expect(db.prepare("SELECT name FROM _migrations ORDER BY name").pluck().all()[0]).toBe(start);
    expect(checkDatabaseVersion(file)).toBe("current");
  } finally { db.close(); }
});

// An old-style database: the start file's structure alone, with no start record.
function oldStyle(db: Database.Database) {
  db.exec(readFileSync(new URL("../../migrations/" + start, import.meta.url), "utf8"));
}

test("a matching old schema gains only the start record", () => {
  const file = location();
  const db = new Database(file);
  try {
    oldStyle(db);
    db.exec("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT)");
    const add = db.prepare("INSERT INTO _migrations VALUES (?, 'before')");
    for (let i = 0; i < 35; i++) add.run("toy-" + i);
    // Later migrations are already in the made-up history, so a bridge that marked one done would show.
    const later = readdirSync(new URL("../../migrations/", import.meta.url)).filter(f => f.endsWith(".sql") && f !== start);
    for (const name of later) add.run(name);
    db.exec("INSERT INTO app_settings VALUES ('toy', 'blocks')");
    const before = contents(db);
    const records = db.prepare("SELECT * FROM _migrations ORDER BY name");
    const history = records.all();
    expect(checkDatabaseVersion(file)).toBe("bridge");
    applyMigrations(db);
    expect(checkDatabaseVersion(file)).toBe("current");
    expect(records.all()).toEqual([...history, { name: start, applied_at: expect.any(String) }].sort((x: any, y: any) => (x.name < y.name ? -1 : 1)));
    expect(contents(db)).toEqual(before);
  } finally { db.close(); }
});

test("a missing column is older and opening the repository leaves the file untouched", () => {
  const file = location();
  const db = new Database(file);
  try {
    oldStyle(db);
    db.exec("ALTER TABLE accounts DROP COLUMN balance_date");
  } finally { db.close(); }
  const hash = () => createHash("sha256").update(readFileSync(file)).digest("hex");
  const before = hash();
  expect(checkDatabaseVersion(file)).toBe("older");
  expect(() => new NodeRepository(file)).toThrow(OlderDatabaseError);
  expect(hash()).toBe(before);
});

test("the earliest framework's migration history survives bridging a matching schema", () => {
  const file = location();
  const db = new Database(file);
  try {
    oldStyle(db);
    db.exec("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, note TEXT)");
    db.exec("INSERT INTO _sqlx_migrations VALUES (1, 'toy history')");
    expect(checkDatabaseVersion(file)).toBe("bridge");
    applyMigrations(db);
    expect(db.prepare("SELECT * FROM _sqlx_migrations").all()).toEqual([{ version: 1, note: "toy history" }]);
  } finally { db.close(); }
});
