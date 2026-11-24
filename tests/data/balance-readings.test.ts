import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import { localDateIso } from "../../src/domain/period";
import type { Account } from "../../src/domain/types";


const account = (id: string): Account => ({
  id, name: id, type: "checking", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me",
});

test("every balance write also records a reading for that day; a second write the same day replaces it", () => {
  const repo = new NodeRepository(":memory:");
  repo.upsertAccounts([account("chk"), account("sav")]);
  repo.upsertAccountBalances([{ accountId: "chk", balanceCents: 100_00, asOf: "2026-09-30T04:00:00Z" }], "2026-10-01");
  repo.upsertAccountBalances([{ accountId: "chk", balanceCents: 150_00, asOf: "2026-10-01T04:00:00Z" }], "2026-10-01");
  repo.upsertAccountBalances([{ accountId: "sav", balanceCents: 900_00, asOf: "2026-10-01T04:00:00Z" }], "2026-10-01");
  repo.upsertAccountBalances([{ accountId: "chk", balanceCents: 175_00, asOf: "2026-10-02T04:00:00Z" }], "2026-10-02");

  expect(repo.listBalanceReadings()).toEqual([
    { accountId: "chk", recordedOn: "2026-10-01", balanceCents: 150_00, asOf: "2026-10-01T04:00:00Z" },
    { accountId: "sav", recordedOn: "2026-10-01", balanceCents: 900_00, asOf: "2026-10-01T04:00:00Z" },
    { accountId: "chk", recordedOn: "2026-10-02", balanceCents: 175_00, asOf: "2026-10-02T04:00:00Z" },
  ]);
  // The latest-balance table is unchanged in behavior: one row per account.
  expect(repo.getAccountBalances()).toHaveLength(2);
});

test("a write with no day given is dated today, on this computer's calendar", () => {
  const repo = new NodeRepository(":memory:");
  repo.upsertAccounts([account("chk")]);
  repo.upsertAccountBalances([{ accountId: "chk", balanceCents: 1_00, asOf: "2026-10-01T04:00:00Z" }]);
  expect(repo.listBalanceReadings().map((r) => r.recordedOn)).toEqual([localDateIso()]);
});
