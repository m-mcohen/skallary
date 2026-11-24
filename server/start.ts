// server/start.ts
//
// Starting the server once the database has been opened (server/index.ts opens it first,
// so an older database is refused before any port is taken). Kept apart from index.ts so
// a test can start it with its own environment and a stand-in for the network.
import type { Server } from "node:http";
import { buildApp } from "./app.js";
import { openAppWindow } from "./launch.js";
import { autoSyncIfStale } from "./services/connectorService.js";
import { openRepo } from "./db/openDb.js";
import { isSampleInstance } from "./instance.js";
import { getLaunchBrowser } from "./services/settingsService.js";

export interface StartOptions {
  port: number;
  env: Record<string, string | undefined>;
  /** The network call the start-up sync uses; tests pass a stub. */
  fetchFn?: typeof fetch;
}

export interface Started {
  server: Server;
  sample: boolean;
  /** Settles when the start-up sync has finished, or at once when there is none. */
  startupSync: Promise<void>;
}

export function startServer({ port, env, fetchFn = fetch }: StartOptions): Promise<Started> {
  openRepo();
  // Read once, right after the database is opened (amendment B2).
  const sample = isSampleInstance();
  // The saved browser choice, read once before listening.
  const browser = getLaunchBrowser();
  return new Promise((resolve) => {
    // Bind 127.0.0.1 ONLY -- never 0.0.0.0. This is a local-only server for the
    // desktop app's own UI; it must never be reachable from the network.
    const server: Server = buildApp().listen(port, "127.0.0.1", () => {
      const bound = (server.address() as { port: number }).port;
      console.log(`Skallary server on http://127.0.0.1:${bound}${sample ? " (sample data)" : ""}`);
      // Only after the port is actually up -- open the UI in a browser
      // app-window. Best-effort: never crashes the server if no browser found.
      openAppWindow(bound, browser);
      resolve({ server, sample, startupSync: startupSync(sample, env, fetchFn) });
    });
  });
}

// Fire-and-forget sync when the last one is stale. Nothing here blocks the
// UI coming up, and a failure is one log line: the app is still fully
// usable on the data it has, and the Sync button reports the real error.
async function startupSync(sample: boolean, env: Record<string, string | undefined>, fetchFn: typeof fetch): Promise<void> {
  if (sample) {
    console.log("SimpleFIN auto-sync: off for sample data");
    return;
  }
  if (env.FINANCE_NO_AUTOSYNC || env.NODE_ENV === "test") {
    console.log("SimpleFIN auto-sync: disabled");
    return;
  }
  try {
    const summary = await autoSyncIfStale(Date.now, fetchFn);
    if (!summary) {
      console.log("SimpleFIN auto-sync: not due");
      return;
    }
    const reconnect = summary.needsReconnect ? " -- needs reconnect" : "";
    console.log(
      `SimpleFIN auto-sync: ${summary.inserted} new, ${summary.updated} updated, ${summary.retiredPending} pending retired, ${summary.errors.length} errors${reconnect}`
    );
  } catch (e: unknown) {
    console.error(`SimpleFIN auto-sync failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
