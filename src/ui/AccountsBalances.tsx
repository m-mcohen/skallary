// src/ui/AccountsBalances.tsx -- Accounts, Balances.
//
// What you have today. The balance sheet that used to sit on the Dashboard as
// "Position": read-only, footing to the same Drawable the top
// bar shows. Which accounts count is decided in Settings, Accounts, so this
// screen carries no switches.
import { useEffect, useMemo, useState } from "react";

import { loadDb, getAccountsUI, getAccountBalancesUI, type Db } from "./lib/db";
import type { Account } from "../domain/types";
import type { AccountBalance } from "../domain/plan-types";
import { PositionCard } from "./PositionCard";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export interface AccountsBalancesDataLayer {
  loadDb: () => Promise<Db>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getAccountBalances: (db: Db) => Promise<AccountBalance[]>;
}

const defaultDataLayer: AccountsBalancesDataLayer = {
  loadDb,
  getAccounts: getAccountsUI,
  getAccountBalances: getAccountBalancesUI,
};

type Loaded = { accounts: Account[]; balances: AccountBalance[] };

export default function AccountsBalances({ dataLayer }: { dataLayer?: Partial<AccountsBalancesDataLayer> }) {
  const deps = useMemo<AccountsBalancesDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await deps.loadDb();
        const [accounts, balances] = await Promise.all([deps.getAccounts(db), deps.getAccountBalances(db)]);
        if (!cancelled) setLoaded({ accounts, balances });
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps]);

  if (unavailable) {
    return (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>The local server is not reachable. Restart the app.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      {loaded ? <PositionCard accounts={loaded.accounts} balances={loaded.balances} /> : <Skeleton className="h-96 w-full" />}
      <p className="text-sm text-muted-foreground">
        Change which accounts count:{" "}
        <a href="#/settings/accounts" className="underline underline-offset-4 hover:text-foreground">
          Settings, Accounts
        </a>
      </p>
    </div>
  );
}
