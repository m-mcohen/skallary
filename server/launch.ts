// server/launch.ts
// Opens the app's UI in a browser "app window" once the server is listening.
// Never ships a compiled binary (Windows Smart App Control blocks those), so
// this only ever spawns already-installed, signed executables (Edge/Chrome)
// or hands off to the OS default browser -- never node.exe itself.
import { spawn } from "node:child_process";
import { isSafeProfileName } from "../src/domain/setup-progress.js";

type Command = { command: string; args: string[] };

/**
 * The browsers to try, first to last, for the saved setting (null: the usual chain, with no
 * profile). The chosen browser comes first and the others follow as fallbacks; "default" is the
 * computer's own default browser, tried alone. A profile flag appears only when a safe profile is set (checked again here: it reaches a command line).
 * Pure.
 */
export function browserCommands(setting: { browser: "edge" | "chrome" | "default"; profile: string | null } | null, url: string): Command[] {
  const profile = (name: string | null): string[] => (name && isSafeProfileName(name) ? [`--profile-directory=${name}`] : []);
  // Through `start`, which finds the browser by its registered name (App Paths); a bare spawn of
  // "msedge" or "chrome" only works when the browser's folder is on PATH, which it usually is not.
  const viaStart = (exe: string, name: string | null): Command => ({ command: "cmd", args: ["/c", "start", "", exe, ...profile(name), `--app=${url}`] });
  const edge = (name: string | null): Command => viaStart("msedge", name);
  const chrome = (name: string | null): Command => viaStart("chrome", name);
  const standard: Command = { command: "cmd", args: ["/c", "start", "", url] };
  if (!setting) return [edge(null), chrome(null), standard];
  if (setting.browser === "default") return [standard];
  return setting.browser === "chrome" ? [chrome(setting.profile), edge(null), standard] : [edge(setting.profile), chrome(null), standard];
}

/**
 * Best-effort auto-open of the app in a browser app-window. Safe to call
 * unconditionally from start.ts after listen() fires -- it no-ops under
 * test/CI and never throws or crashes the server if no browser is found.
 */
export function openAppWindow(port: number, setting: Parameters<typeof browserCommands>[0] = null): void {
  if (process.env.NODE_ENV === "test" || process.env.FINANCE_NO_OPEN) {
    return;
  }

  const url = `http://127.0.0.1:${port}`;

  // A missing binary fails ASYNCHRONOUSLY on Windows (spawn() itself doesn't
  // throw for ENOENT -- the child emits an 'error' event), so the chain
  // advances from that 'error' handler.
  tryNext(browserCommands(setting, url), 0, url);
}

function tryNext(
  candidates: Array<{ command: string; args: string[] }>,
  index: number,
  url: string,
): void {
  const candidate = candidates[index];
  if (!candidate) {
    console.warn(`Could not auto-open a browser. Open ${url} manually.`);
    return;
  }

  try {
    const child = spawn(candidate.command, candidate.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });

    let spawned = false;
    child.once("spawn", () => {
      // Binary found and launched -- proof this attempt succeeded. Stop
      // caring about this child (a later crash inside the browser itself
      // is not our problem to retry).
      spawned = true;
    });
    // `start` reports a browser it cannot find by a failing exit code, not a spawn error.
    child.once("exit", (code) => {
      if (code !== 0 && code !== null) tryNext(candidates, index + 1, url);
    });
    child.on("error", () => {
      if (!spawned) {
        // ENOENT or similar launch failure -- advance to the next
        // candidate in the chain instead of giving up.
        tryNext(candidates, index + 1, url);
      }
    });
    child.unref();
  } catch {
    // Belt-and-suspenders for a synchronous throw (unexpected on Windows,
    // but cheap to guard against) -- fall through to the next candidate.
    tryNext(candidates, index + 1, url);
  }
}
