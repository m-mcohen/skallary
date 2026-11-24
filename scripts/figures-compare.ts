import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Snapshot {
  today: string;
  cases: Record<string, Record<string, number>>;
}

function figures(snapshot: Snapshot) {
  const entries = new Map<string, number>();
  for (const [group, values] of Object.entries(snapshot.cases)) {
    if (!values || typeof values !== "object" || Array.isArray(values)) throw Error();
    for (const [key, value] of Object.entries(values)) {
      if (!Number.isFinite(value)) throw Error();
      entries.set(group + "/" + key, value);
    }
  }
  return entries;
}

export function compareSnapshots(a: Snapshot, b: Snapshot) {
  if (!a.today || a.today !== b.today) throw Error("Choose snapshots taken for the same day.");
  const left = figures(a);
  const right = figures(b);
  const result = { same: 0, changed: [] as string[], onlyInA: [] as string[], onlyInB: [] as string[] };
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    if (!left.has(key)) result.onlyInB.push(key);
    else if (!right.has(key)) result.onlyInA.push(key);
    else if (left.get(key) !== right.get(key)) result.changed.push(key);
    else result.same++;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [a, b, option, allowFile, ...extra] = process.argv.slice(2);
    if (!a || !b || extra.length || (option !== undefined && (option !== "--allow" || !allowFile))) throw Error();
    const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
    const result = compareSnapshots(read(a), read(b));
    const allowed = new Set(allowFile ? readFileSync(allowFile, "utf8").split(/\r?\n/).map(s => s.trim()) : []);
    console.log(`same: ${result.same}, changed: ${result.changed.length}, onlyInA: ${result.onlyInA.length}, onlyInB: ${result.onlyInB.length}`);
    const differences = [...result.changed, ...result.onlyInA, ...result.onlyInB];
    for (const id of differences) console.log(id);
    process.exitCode = differences.every(id => allowed.has(id)) ? 0 : 1;
  } catch {
    console.error("Supply two valid snapshots for the same day and, optionally, --allow followed by a file of figure IDs, one per line.");
    process.exitCode = 2;
  }
}
