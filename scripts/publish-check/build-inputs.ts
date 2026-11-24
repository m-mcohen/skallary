import Database from "better-sqlite3";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { assertCopyFolder } from "../lib/copy-guard.js";

function build(db: Database.Database, extra: string) {
  const amounts = new Set<number>();
  const strings = new Set<string>();
  const ids = new Set<string>();
  const tails = new Set<string>();
  function collect(value: unknown, broader: boolean) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return;
    const cents = Math.abs(value);
    if ((cents >= 10000 && cents % 100 !== 0) || (broader && cents >= 100000 && cents % 10000 !== 0)) amounts.add(cents);
  }
  function setting(value: unknown) {
    if (Array.isArray(value)) value.forEach(setting);
    else if (value && typeof value === "object") Object.values(value).forEach(setting);
    else if (typeof value === "number") collect(value, true);
    else if (typeof value === "string" && /^-?\d+$/.test(value)) collect(Number(value), true);
  }
  const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"';
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'").pluck().all() as string[];
  for (const table of tables) {
    const columns = db.prepare("SELECT name FROM pragma_table_info(?)").pluck().all(table) as string[];
    for (const col of columns.filter(name => name.endsWith("_cents"))) {
      const broader = table.startsWith("budget_") || table.endsWith("_settings") ||
        ["account_balances", "account_balance_readings"].includes(table) || (table === "accounts" && col.endsWith("balance_cents"));
      for (const value of db.prepare("SELECT DISTINCT " + quote(col) + " FROM " + quote(table)).pluck().iterate()) collect(value, broader);
    }
  }
  for (const raw of db.prepare("SELECT value FROM app_settings").pluck().iterate()) {
    if (typeof raw !== "string") continue;
    let value;
    try { value = JSON.parse(raw); }
    catch { value = raw; }
    setting(value);
  }
  for (const account of db.prepare("SELECT id, conn_id, name FROM accounts").iterate() as Iterable<{id:string;conn_id:string|null;name:string}>) {
    for (const id of [account.id, account.conn_id]) {
      if (!id || id.length < 6) continue;
      ids.add(id);
      for (const part of id.split(":")) {
        if (part.length >= 6 && /\d/.test(part)) ids.add(part);
      }
    }
    for (const match of account.name.matchAll(/(?<!\d)\d{4}(?!\d)/g)) tails.add(match[0]);
  }
  for (const line of extra.split(/\r?\n/)) {
    const entry = line.trim();
    // "=NAME" entries are exact whole-word names, kept at 3+ characters after the "=".
    if (entry.length >= 6 || (entry.startsWith("=") && entry.length >= 4)) strings.add(entry);
  }
  return { builtAt: new Date().toISOString(), amountsCents: [...amounts].sort((a,b) => a-b), strings: [...strings].sort(), tails: [...tails].sort(), ids: [...ids].sort() };
}

try {
  const copy = assertCopyFolder(process.argv[2], "Supply a database copy folder.");
  const folder = join(process.env.LOCALAPPDATA!, "finance", "private", "publish-check");
  let extra = "";
  try { extra = readFileSync(join(folder, "extra.txt"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const db = new Database(join(copy, "finance", "finance.db"), { readonly: true, fileMustExist: true });
  let inputs;
  try { inputs = db.transaction(() => build(db, extra))(); }
  finally { db.close(); }
  mkdirSync(folder, { recursive: true });
  const temp = join(folder, randomUUID() + ".tmp");
  try {
    writeFileSync(temp, JSON.stringify(inputs), { flag: "wx", mode: 0o600 });
    renameSync(temp, join(folder, "inputs.json"));
  } finally { rmSync(temp, { force: true }); }
  console.log(`Amounts: ${inputs.amountsCents.length}, strings: ${inputs.strings.length}, tails: ${inputs.tails.length}, ids: ${inputs.ids.length}`);
} catch {
  console.error("Could not build publish check inputs.");
  process.exitCode = 2;
}
