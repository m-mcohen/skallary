import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";

function sameFile(a: string, b: string): boolean {
  try {
    const x = statSync(a, { bigint: true });
    const y = statSync(b, { bigint: true });
    return x.ino !== 0n && x.dev === y.dev && x.ino === y.ino;
  } catch { return false; } // one of them does not exist: nothing to compare
}

export function assertCopyFolder(arg: string | undefined, usage: string): string {
  function refuse(message: string): never {
    console.error(message);
    process.exit(2);
  }
  if (!arg) return refuse(usage);
  const copy = resolve(arg);
  const env = process.env.LOCALAPPDATA;
  const file = join(copy, "finance", "finance.db");
  if (!env) return refuse("Point this at a copy of the database.");
  // A shell can point LOCALAPPDATA at a copy, so the user's own local app data folder,
  // found from the home folder rather than from that variable, is live as well. homedir()
  // follows USERPROFILE; userInfo() reads the account's own profile.
  const homes = [homedir()];
  try { homes.push(userInfo().homedir); } catch { /* no account entry: homedir() still applies */ }
  const lives = [resolve(env), ...homes.map(home => resolve(home, "AppData", "Local"))];
  if (lives.some(live => live.toLowerCase() === copy.toLowerCase())) {
    return refuse("Point this at a copy of the database.");
  }
  if (!existsSync(file) || !statSync(file).isFile()) return refuse("No finance/finance.db under that folder.");
  const target = realpathSync(file).toLowerCase();
  for (const live of lives) {
    const liveFile = join(existsSync(live) ? realpathSync(live) : live, "finance", "finance.db");
    if (target === liveFile.toLowerCase()) return refuse("Point this at a copy of the database.");
    // A link can make the live file appear under another name: compare the files themselves.
    if (sameFile(file, liveFile)) return refuse("Point this at a copy of the database.");
  }
  return copy;
}
