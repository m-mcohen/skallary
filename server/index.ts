// server/index.ts
// Entrypoint: run via `node --import tsx server/index.ts` -- the same
// SAC-proven loader the CLI uses. No build/bundle, no compiled binary.
import { PORT } from "./security.js";
import { startServer } from "./start.js";

import { openRepo } from "./db/openDb.js";
import { OlderDatabaseError } from "../src/data/migrate.node.js";

try { openRepo(); }
catch (error) {
  if (!(error instanceof OlderDatabaseError)) throw error;
  console.error(error.message);
  process.exit(1);
}

// Listens on 127.0.0.1 only, reads whether the database is sample data, opens the
// window and runs the start-up sync (never on sample data). See server/start.ts.
void startServer({ port: PORT, env: process.env });
