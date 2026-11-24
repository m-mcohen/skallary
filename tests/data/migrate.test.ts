import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../../src/data/migrate.node";

test("a migration and its bookkeeping row commit together and retry once", () => {
  const dir = mkdtempSync(join(tmpdir(), "toy-migrations-"));
  const db = new Database(":memory:");
  try {
    writeFileSync(join(dir, "01.sql"), "CREATE TABLE toys (n INTEGER); INSERT INTO toys VALUES (1)");
    applyMigrations(db, dir);
    writeFileSync(join(dir, "02.sql"), "UPDATE toys SET n=n+1");
    db.exec("CREATE TRIGGER refuse BEFORE INSERT ON _migrations BEGIN SELECT RAISE(ABORT, 'refused'); END");
    const value = () => db.prepare("SELECT n FROM toys").pluck().get();
    expect(() => applyMigrations(db, dir)).toThrow(/refused/);
    expect(value()).toBe(1);
    db.exec("DROP TRIGGER refuse");
    applyMigrations(db, dir);
    applyMigrations(db, dir);
    expect(value()).toBe(2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
