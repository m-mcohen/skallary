// server/services/mappingBootstrapService.ts
//
// Append-only category-mapping bootstrap: fills in an identity mapping
// (source -> source) for every distinct source category that has no
// mapping yet, and never touches a source category the user already
// mapped. A null/undefined sourceCategory on a transaction is treated as
// the literal "Uncategorized" bucket, same as src/domain/dedup.ts's
// classify() fallback -- this is what makes that fallback explicit in the
// mappings table instead of implicit.
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";

export function run(): { added: number; total: number } {
  const repo = sqliteFinanceRepository();
  const existing = repo.getCategoryMappings(); // source -> planning

  const sources = new Set<string>();
  for (const t of repo.getTransactions()) sources.add(t.sourceCategory ?? "Uncategorized");

  let added = 0;
  for (const s of sources) {
    if (existing[s] === undefined) {
      repo.setCategoryMapping(s, s); // identity, append-only
      added++;
    }
  }
  return { added, total: sources.size };
}
