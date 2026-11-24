// server/db/openDb.ts
// Opens the same app database the CLI uses:
// %LOCALAPPDATA%\finance\finance.db (falls back to $HOME outside Windows).
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { NodeRepository } from "../../src/data/repo.node.js";

export function dbPath(): string {
  const base = process.env.LOCALAPPDATA || process.env.HOME || ".";
  const dir = join(base, "finance");
  mkdirSync(dir, { recursive: true });
  return join(dir, "finance.db");
}

let repo: NodeRepository | null = null;

// Singleton: one NodeRepository (one better-sqlite3 connection) per server process.
export function openRepo(): NodeRepository {
  return (repo ??= new NodeRepository(dbPath()));
}
