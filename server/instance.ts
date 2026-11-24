// server/instance.ts
//
// Whether this server runs on sample data (plan Project 1, task 6; amendments A6 and B2).
// demo/build-sample-db.ts stamps every sample database with SAMPLE_STAMP_KEY = "true". The
// stamp is read once, when the server starts (startServer calls isSampleInstance right after
// the database is opened), and kept for the life of the process. A sample server never syncs
// at start and refuses every bank route, whatever the environment says.
import { SAMPLE_STAMP_KEY } from "../src/domain/sample-data.js";
import { sqliteFinanceRepository } from "./repositories/sqliteFinanceRepository.js";

/** What a bank route answers on sample data, and what the screens say. */
export const SAMPLE_NO_BANK =
  "This is sample data. It cannot be linked to a bank. Your own copy of the app, started the usual way, is where banks are linked.";

let sample: boolean | null = null;

/** True when the open database carries the sample stamp. Read once, then remembered. */
export function isSampleInstance(): boolean {
  return (sample ??= sqliteFinanceRepository().getSetting(SAMPLE_STAMP_KEY) === "true");
}
