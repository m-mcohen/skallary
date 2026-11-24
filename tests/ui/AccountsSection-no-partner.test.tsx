// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import AccountsSection, { type AccountsDataLayer } from "../../src/ui/AccountsSection";
import type { Db } from "../../src/ui/lib/db";
import { demoAccounts } from "../demo";

afterEach(cleanup);

test("with no partner, the owner picker offers two choices and the include switch is absent", async () => {
  const accounts = demoAccounts();
  const dataLayer: Partial<AccountsDataLayer> = {
    loadDb: async () => ({}) as Db,
    getAccountsManage: async () => accounts,
    getAccountBalances: async () => [],
    getHousehold: async () => ({ youName: "Alex", partnerName: null }),
    getIncludePartner: async () => true,
    getMaaserFloor: async () => 0,
  };
  render(<AccountsSection dataLayer={dataLayer} />);
  const firstOwnerPicker = (await screen.findAllByRole("group", { name: /^Owner for / }))[0];
  expect(within(firstOwnerPicker).getAllByRole("button")).toHaveLength(2);
  expect(screen.queryByRole("switch", { name: /include/i })).toBeNull();
});
