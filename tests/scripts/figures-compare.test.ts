import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compareSnapshots } from "../../scripts/figures-compare.js";

const a = { today: "2026-03-01", cases: { "budget-2026": { "line-2/m03": 100, other: 200 }, forecast: { net: 300 } } };
it("counts equal figures and identifies changed and missing figures", () => {
  expect(compareSnapshots(a, a)).toEqual({ same: 3, changed: [], onlyInA: [], onlyInB: [] });
  const b = { ...a, cases: { "budget-2026": { ...a.cases["budget-2026"], "line-2/m03": 101 } } };
  expect(compareSnapshots(a, b)).toEqual({ same: 1, changed: ["budget-2026/line-2/m03"], onlyInA: ["forecast/net"], onlyInB: [] });
});
it("allows only listed differences at the command line", () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-"));
  try {
    const files = ["a", "b", "allow"].map(name => join(dir, name));
    writeFileSync(files[0], JSON.stringify(a));
    writeFileSync(files[1], JSON.stringify({ ...a, cases: { "budget-2026": a.cases["budget-2026"] } }));
    writeFileSync(files[2], "forecast/net\n");
    const run = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/figures-compare.ts", ...args]).status;
    expect(run(files.slice(0, 2))).toBe(1);
    expect(run([...files.slice(0, 2), "--allow", files[2]])).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
