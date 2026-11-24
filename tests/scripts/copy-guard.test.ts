import { expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { assertCopyFolder } from "../../scripts/lib/copy-guard.js";

it("accepts only a separate folder containing a database", () => {
  const root = mkdtempSync(join(tmpdir(), "guard-"));
  const live = join(root, "live");
  mkdirSync(join(live, "finance"), { recursive: true });
  writeFileSync(join(live, "finance", "finance.db"), "");
  vi.stubEnv("LOCALAPPDATA", live);
  vi.spyOn(process, "exit").mockImplementation(() => { throw Error("refused"); });
  try {
    for (const path of [undefined, live, live + "/", live.toUpperCase(), relative(process.cwd(), live), root]) {
      expect(() => assertCopyFolder(path, "usage")).toThrow("refused");
      expect(process.exit).toHaveBeenLastCalledWith(2);
    }
    mkdirSync(join(root, "finance"));
    writeFileSync(join(root, "finance", "finance.db"), "");
    expect(assertCopyFolder(root, "usage")).toBe(root);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

it("refuses the user's own local app data folder when LOCALAPPDATA points at a copy", () => {
  const root = mkdtempSync(join(tmpdir(), "guard-"));
  const local = join(root, "home", "AppData", "Local");
  mkdirSync(join(local, "finance"), { recursive: true });
  writeFileSync(join(local, "finance", "finance.db"), "");
  vi.stubEnv("USERPROFILE", join(root, "home"));
  vi.stubEnv("HOME", join(root, "home"));
  vi.stubEnv("LOCALAPPDATA", join(root, "decoy"));
  vi.spyOn(process, "exit").mockImplementation(() => { throw Error("refused"); });
  try {
    for (const path of [local, local.toUpperCase()]) expect(() => assertCopyFolder(path, "usage")).toThrow("refused");
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

it("refuses a hard link to the live database, but accepts an independent copy", () => {
  const root = mkdtempSync(join(tmpdir(), "guard-"));
  const live = join(root, "live");
  mkdirSync(join(live, "finance"), { recursive: true });
  writeFileSync(join(live, "finance", "finance.db"), "made-up");
  const linked = join(root, "linked");
  mkdirSync(join(linked, "finance"), { recursive: true });
  linkSync(join(live, "finance", "finance.db"), join(linked, "finance", "finance.db"));
  const copy = join(root, "copy");
  mkdirSync(join(copy, "finance"), { recursive: true });
  writeFileSync(join(copy, "finance", "finance.db"), "made-up");
  vi.stubEnv("LOCALAPPDATA", live);
  vi.spyOn(process, "exit").mockImplementation(() => { throw Error("refused"); });
  try {
    expect(() => assertCopyFolder(linked, "usage")).toThrow("refused");
    expect(assertCopyFolder(copy, "usage")).toBe(copy);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
