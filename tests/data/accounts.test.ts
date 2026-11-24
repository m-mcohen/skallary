import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import type { Account } from "../../src/domain/types";

const acct: Account = {
  id: "acc1", name: "Checking", type: "depository", institution: "Bank",
  currency: "USD", isOwned: true, includeInSpend: true, owner: "me",
};

test("upsertAccounts is idempotent and preserves include_in_spend across re-sync", () => {
  const repo = new NodeRepository(":memory:");
  repo.upsertAccounts([acct]);
  expect(repo.getAccounts()).toHaveLength(1);
  expect(repo.getAccounts()[0].includeInSpend).toBe(true);

  repo.setAccountIncludeInSpend("acc1", false);
  expect(repo.getAccounts()[0].includeInSpend).toBe(false);

  // re-sync (e.g. a sync upsert) must NOT clobber the user's exclusion
  repo.upsertAccounts([{ ...acct, name: "Checking Renamed" }]);
  const after = repo.getAccounts()[0];
  expect(after.name).toBe("Checking Renamed");
  expect(after.includeInSpend).toBe(false);

  repo.setAccountIncludeInSpend("acc1", true);
  expect(repo.getAccounts()[0].includeInSpend).toBe(true);
});

test("getAccounts defaults owner to 'me' and setAccountOwner round-trips + survives re-sync", () => {
  const repo = new NodeRepository(":memory:");
  repo.upsertAccounts([acct]);
  expect(repo.getAccounts()[0].owner).toBe("me");

  repo.setAccountOwner("acc1", "partner");
  expect(repo.getAccounts()[0].owner).toBe("partner");

  // re-sync must NOT clobber the user-set owner tag, same as include_in_spend.
  repo.upsertAccounts([{ ...acct, name: "Checking Renamed 2" }]);
  const after = repo.getAccounts()[0];
  expect(after.name).toBe("Checking Renamed 2");
  expect(after.owner).toBe("partner");

  repo.setAccountOwner("acc1", "joint");
  expect(repo.getAccounts()[0].owner).toBe("joint");
});

test("getSetting/setSetting round-trip an app_settings key, including default-to-null when unset", () => {
  const repo = new NodeRepository(":memory:");
  repo.setSetting("include_partner_accounts", "false");
  expect(repo.getSetting("include_partner_accounts")).toBe("false");
  expect(repo.getSetting("nonexistent_key")).toBeNull();

  repo.setSetting("include_partner_accounts", "true");
  expect(repo.getSetting("include_partner_accounts")).toBe("true");

  repo.setSetting("include_partner_accounts", "false");
  expect(repo.getSetting("include_partner_accounts")).toBe("false");
});
