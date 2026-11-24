// server/repositories/sqliteFinanceRepository.ts
//
// Delegates straight through to the existing NodeRepository (real
// better-sqlite3 connection, real migrations) -- this file adds no logic
// of its own. It exists purely to hand back the singleton repo typed as
// the narrower FinanceRepository interface, so services/routes only ever
// see the seam, never the concrete sqlite class.
import { openRepo } from "../db/openDb.js";
import type { FinanceRepository } from "./financeRepository.js";

export function sqliteFinanceRepository(): FinanceRepository {
  return openRepo();
}
