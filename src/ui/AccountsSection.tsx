// src/ui/AccountsSection.tsx
//
// Account ownership management. Accounts carry an owner slot (me, partner,
// joint) and a per-account includeInSpend flag; a persistent "include the
// partner's accounts" setting is the second exclusion lever. The partner slot,
// its label and that switch are drawn only when the household has a partner.
// Every calc-facing consumer (BudgetGrid, Charts, Overview, RunwayOverview)
// already reads the EFFECTIVE account list via getAccountsUI ->
// withEffectiveInclude() server-side (server/services/readService.ts), so
// this screen only needs to read/write the RAW state
// (getAccountsManageUI/setAccountOwnerUI/setAccountIncludeUI in src/ui/lib/db.ts,
// the household and the include setting in src/ui/lib/db-setup.ts) -- flipping either lever
// here takes effect the next time any other section reloads its data.
//
// Registry-first (see the ui-registries skill): @shadcn/switch,
// @shadcn/toggle-group, @shadcn/table, @shadcn/card, @shadcn/alert,
// @shadcn/badge, @shadcn/skeleton are all already installed in this repo
// (WishlistSection.tsx's Switch, ConnectorSection.tsx's ToggleGroup,
// NotesHistorySection.tsx's Table) -- no new `npx shadcn@latest add` needed.
// The per-row Owner control uses ToggleGroup (plain Toggle buttons, no
// floating-ui portal) rather than @shadcn/select: Base UI's Select popup has
// known jsdom click-through quirks in this repo's test suite, while ToggleGroup items are reliably
// clickable in both a real browser and jsdom.
//
// Data layer is injected via the `dataLayer` prop (mirrors GoalsSection.tsx/
// NotesHistorySection.tsx) so this file has no hard dependency on a live
// server connection: App.tsx uses the real db.ts functions, tests inject
// stubs, and headless `vite build`/`vite preview` render a neutral "not
// connected" state instead of crashing.
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  loadDb,
  getAccountsManageUI,
  getAccountBalancesUI,
  setAccountOwnerUI,
  setAccountIncludeUI,
  setAccountDrawableUI,
  setAccountArchivedUI,
  setAccountSavingsDestinationUI,
  setAccountMaaserPotUI,
  getMaaserFloorUI,
  setMaaserFloorUI,
  type Db,
} from "./lib/db";
import { getCharityPotUI, getHouseholdUI, getIncludePartnerUI, setIncludePartnerUI } from "./lib/db-setup";
import { potLabel, type CharityPot } from "../domain/charity-pot";
import { ownerLabel, type Household, type OwnerSlot } from "../domain/household";
import { ledgerHref } from "./lib/ledger-link";
import { getRememberedPeriod } from "./lib/period-store";
import type { Period } from "../domain/period";
import type { Account } from "../domain/types";
import type { AccountBalance } from "../domain/plan-types";
import { formatCents, parseDollarsToCents } from "../domain/money";
import { defaultDrawableFor, drawableLiquidCents, isCardAccount } from "../domain/runway";
import { withEffectiveInclude } from "../domain/account-filter";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { accountTypeLabel, displayAccountName } from "../domain/account-display";

// ---------------------------------------------------------------------------
// Injectable data layer (mirrors GoalsSection.tsx's GoalsDataLayer)
// ---------------------------------------------------------------------------

export interface AccountsDataLayer {
  loadDb: () => Promise<Db>;
  getAccountsManage: (db: Db) => Promise<Account[]>;
  getAccountBalances: (db: Db) => Promise<AccountBalance[]>;
  getHousehold: (db: Db) => Promise<Household | null>;
  getIncludePartner: (db: Db) => Promise<boolean>;
  setIncludePartner: (db: Db, includePartner: boolean) => Promise<void>;
  setAccountOwner: (db: Db, id: string, owner: Account["owner"]) => Promise<void>;
  setAccountInclude: (db: Db, id: string, includeInSpend: boolean) => Promise<void>;
  setAccountDrawable: (db: Db, id: string, drawable: boolean | null) => Promise<void>;
  setAccountArchived: (db: Db, id: string, archived: boolean) => Promise<void>;
  setAccountSavingsDestination: (db: Db, id: string, savingsDestination: string | null) => Promise<void>;
  /** The pot account: the one account the charity pot is set aside in, and the floor kept in it. */
  setAccountMaaserPot: (db: Db, id: string, on: boolean) => Promise<void>;
  getMaaserFloor: (db: Db) => Promise<number>;
  setMaaserFloor: (db: Db, floorCents: number) => Promise<void>;
  /** The charity pot (null: off, so the pot account column is not shown). */
  getCharityPot: (db: Db) => Promise<Pick<CharityPot, "on" | "name"> | null>;
}

const defaultDataLayer: AccountsDataLayer = {
  loadDb,
  getAccountsManage: getAccountsManageUI,
  getAccountBalances: getAccountBalancesUI,
  getHousehold: () => getHouseholdUI(),
  getIncludePartner: () => getIncludePartnerUI(),
  setIncludePartner: (_db, on) => setIncludePartnerUI(on),
  setAccountOwner: setAccountOwnerUI,
  setAccountInclude: setAccountIncludeUI,
  setAccountDrawable: setAccountDrawableUI,
  setAccountArchived: setAccountArchivedUI,
  setAccountSavingsDestination: setAccountSavingsDestinationUI,
  setAccountMaaserPot: setAccountMaaserPotUI,
  getMaaserFloor: getMaaserFloorUI,
  setMaaserFloor: setMaaserFloorUI,
  getCharityPot: () => getCharityPotUI(),
};

export interface AccountsSectionProps {
  /** Override any subset of the data layer (tests inject stubs; App.tsx uses the default). */
  dataLayer?: Partial<AccountsDataLayer>;
  /** Overrides the shared period for the activity links. Tests pin it. */
  period?: Period;
}

type Phase = "loading" | "unavailable" | "ready" | "error";

// Display order for both the sort and the table grouping: yours, then shared,
// then the partner's, so the partner's accounts are easy to scan as one block.
const OWNER_ORDER: OwnerSlot[] = ["me", "joint", "partner"];
/** The owner choices this household has: the partner slot only when there is a partner. */
const ownerChoices = (h: Household | null): OwnerSlot[] => OWNER_ORDER.filter((slot) => slot !== "partner" || !!h?.partnerName);

/**
 * The floor kept in the pot account: what the pot can give is its balance less this.
 * Enter or clicking away saves, as the budget box does; a value that is not dollars is refused in words.
 */
function MaaserFloorBox({ accountName, floorCents, onSave }: { accountName: string; floorCents: number; onSave: (cents: number) => Promise<void> }) {
  const [value, setValue] = useState((floorCents / 100).toFixed(2));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    if (busy) return;
    let cents: number;
    try {
      cents = parseDollarsToCents(value);
      if (cents < 0) throw new Error("negative");
    } catch {
      setStatus("Type dollars, such as 1500.00.");
      return;
    }
    if (cents === floorCents) {
      setStatus(null);
      return;
    }
    setBusy(true);
    try {
      await onSave(cents);
      setValue((cents / 100).toFixed(2));
      setStatus("Saved.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      Keep at least
      <span className="flex items-center gap-1">
        $
        <Input
          className="h-8 w-24 text-right tabular-nums"
          inputMode="decimal"
          aria-label={`Keep at least in ${accountName}`}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
          }}
        />
      </span>
      {status && <span aria-live="polite">{status}</span>}
    </label>
  );
}

/** The bank's full name as it sent it, less the doubled bracket it adds to a few ("(967))"). */
const bankName = (name: string) => name.replace(/\)\)/g, ")");

export default function AccountsSection({ dataLayer, period: pinned }: AccountsSectionProps) {
  // The period last chosen on the history screens: an account's activity opens over the same dates.
  const period = pinned ?? getRememberedPeriod();
  const deps = useMemo<AccountsDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);

  const [db, setDb] = useState<Db | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [household, setHousehold] = useState<Household | null>(null);
  const [includePartner, setIncludePartnerState] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [floorCents, setFloorCents] = useState(0);
  // The charity pot; undefined until read (or when it cannot be read: the column shows as it always has).
  const [charityPot, setCharityPot] = useState<Pick<CharityPot, "on" | "name"> | null | undefined>(undefined);
  const potShown = charityPot === undefined || (charityPot !== null && charityPot.on);
  const potName = potLabel(charityPot);

  const refresh = useCallback(
    async (handle: Db) => {
      const [accts, bals, home, partnerIn, floor, pot] = await Promise.all([
        deps.getAccountsManage(handle),
        deps.getAccountBalances(handle),
        deps.getHousehold(handle),
        deps.getIncludePartner(handle),
        // The floor is extra; the screen works without it (an older server has none).
        deps.getMaaserFloor(handle).catch(() => 0),
        deps.getCharityPot(handle).catch(() => undefined),
      ]);
      setCharityPot(pot);
      setAccounts(accts);
      setBalances(bals);
      setHousehold(home);
      setIncludePartnerState(partnerIn);
      setFloorCents(floor);
      return { accts, bals };
    },
    [deps]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let handle: Db;
      try {
        handle = await deps.loadDb();
      } catch {
        // Expected when the local Node server is unreachable (headless build / preview).
        if (!cancelled) setPhase("unavailable");
        return;
      }
      if (cancelled) return;
      setDb(handle);

      try {
        await refresh(handle);
        if (cancelled) return;
        setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setErrorMessage(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Data layer only meaningfully changes identity across remounts in this app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleIncludePartner = useCallback(
    async (checked: boolean) => {
      if (!db) return;
      try {
        await deps.setIncludePartner(db, checked);
        await refresh(db);
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    },
    [db, deps, refresh]
  );

  const handleOwnerChange = useCallback(
    async (id: string, owner: Account["owner"]) => {
      if (!db) return;
      try {
        await deps.setAccountOwner(db, id, owner);
        await refresh(db);
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    },
    [db, deps, refresh]
  );

  const handleToggleInclude = useCallback(
    async (id: string, checked: boolean) => {
      if (!db) return;
      setTogglingId(id);
      try {
        await deps.setAccountInclude(db, id, checked);
        await refresh(db);
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setPhase("error");
      } finally {
        setTogglingId(null);
      }
    },
    [db, deps, refresh]
  );

  // Whether this account's BALANCE counts as cash you can draw on -- a
  // different question from whether its TRANSACTIONS count as spending.
  const handleToggleDrawable = useCallback(
    async (id: string, checked: boolean) => {
      if (!db) return;
      setTogglingId(id);
      try {
        await deps.setAccountDrawable(db, id, checked);
        setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, drawable: checked } : a)));
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setTogglingId(null);
      }
    },
    [db, deps]
  );

  /**
   * Hides a superseded account record. Deliberately does NOT touch
   * includeInSpend: archiving answers "should this row clutter the list",
   * never "should this money count", and conflating the two would move totals
   * without saying so.
   */
  const handleToggleArchived = useCallback(
    async (id: string, archived: boolean) => {
      if (!db) return;
      setTogglingId(id);
      try {
        await deps.setAccountArchived(db, id, archived);
        setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, archived } : a)));
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setTogglingId(null);
      }
    },
    [db, deps]
  );

  /**
   * Flags this account as somewhere money is put away, and names the flavor.
   * Changing it re-reads every month: a move into a flagged account stops being
   * an invisible transfer and starts counting as saving.
   */
  const handleSavingsDestination = useCallback(
    async (id: string, value: string) => {
      if (!db) return;
      const savingsDestination = value === "" ? null : value;
      setTogglingId(id);
      try {
        await deps.setAccountSavingsDestination(db, id, savingsDestination);
        setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, savingsDestination } : a)));
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setTogglingId(null);
      }
    },
    [db, deps]
  );

  // The maaser pot: one live account at a time, so switching one on clears the other live rows here as the
  // server does; an archived row may carry the switch too for the pot's older history.
  const handleToggleMaaserPot = useCallback(
    async (id: string, on: boolean) => {
      if (!db) return;
      setTogglingId(id);
      try {
        await deps.setAccountMaaserPot(db, id, on);
        setAccounts((prev) => {
          const archived = !!prev.find((a) => a.id === id)?.archived;
          return prev.map((a) => ({ ...a, maaserPot: a.id === id ? on : on && !archived && !a.archived ? false : a.maaserPot }));
        });
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setTogglingId(null);
      }
    },
    [db, deps]
  );

  const balanceById = useMemo(() => new Map(balances.map((b) => [b.accountId, b.balanceCents])), [balances]);

  const archivedCount = useMemo(() => accounts.filter((a) => a.archived).length, [accounts]);

  // Archived rows leave the LIST. The summaries below still read the full
  // `accounts` array, but an archived BALANCE never counts toward drawable,
  // so archiving an account that
  // holds a drawable balance does lower the figure. Its transactions still
  // count. The comment that stood here said archiving could never move a
  // number; that is no longer true.
  const sortedAccounts = useMemo(() => {
    return [...accounts]
      .filter((a) => showArchived || !a.archived)
      .sort((a, b) => {
        const byOwner = OWNER_ORDER.indexOf(a.owner) - OWNER_ORDER.indexOf(b.owner);
        return byOwner !== 0 ? byOwner : a.name.localeCompare(b.name);
      });
  }, [accounts, showArchived]);

  // Effective summary: what drawable liquid reads with the partner's own accounts
  // included vs. excluded, using the same pure withEffectiveInclude() +
  // drawableLiquidCents() the server/RunwayOverview use -- no math
  // reimplemented here, just fed the current raw account list both ways.
  const drawableWithPartner = useMemo(
    () => drawableLiquidCents(withEffectiveInclude(accounts, true), balances),
    [accounts, balances]
  );
  const drawableWithoutPartner = useMemo(
    () => drawableLiquidCents(withEffectiveInclude(accounts, false), balances),
    [accounts, balances]
  );

  const partnerName = household?.partnerName ?? null;

  let body: React.ReactNode;
  if (phase === "loading") {
    body = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  } else if (phase === "unavailable") {
    body = (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>
          No local database connection. The local server is not reachable. Restart the app.
        </AlertDescription>
      </Alert>
    );
  } else if (phase === "error") {
    body = (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load accounts</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {partnerName && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">Include {partnerName}'s accounts</CardTitle>
                  <CardDescription>
                    Off: {partnerName}'s own accounts are left out of spending, the budget, and Drawable.
                    Shared accounts and yours always count.
                  </CardDescription>
                </div>
                <Switch
                  checked={includePartner}
                  onCheckedChange={handleToggleIncludePartner}
                  aria-label={`Include ${partnerName}'s accounts`}
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Drawable, without {partnerName}'s accounts</span>
                  <span
                    className={`font-medium tabular-nums ${!includePartner ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {formatCents(drawableWithoutPartner)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Drawable, with {partnerName}'s accounts</span>
                  <span
                    className={`font-medium tabular-nums ${includePartner ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {formatCents(drawableWithPartner)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {accounts.length === 0 ? (
          <Alert>
            <AlertTitle>No accounts yet</AlertTitle>
            <AlertDescription>Sync to pull accounts in.</AlertDescription>
          </Alert>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Accounts</CardTitle>
              <CardDescription>
                {partnerName ? `Grouped by owner: you, shared, then ${partnerName}.` : "Grouped by owner: you, then shared."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {archivedCount > 0 && (
                <div className="mb-3 flex items-center gap-2">
                  <Switch
                    id="show-archived"
                    checked={showArchived}
                    onCheckedChange={(checked: boolean) => setShowArchived(checked)}
                    aria-label="Show archived accounts"
                  />
                  <label htmlFor="show-archived" className="text-sm text-muted-foreground">
                    {/* Archived rows are superseded records that still own history --
                        they stay in every total, they just don't clutter the list. */}
                    Show {archivedCount} archived account{archivedCount === 1 ? "" : "s"} (their transactions still count; their balances do not)
                  </label>
                </div>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Counted?</TableHead>
                      <TableHead>Drawable?</TableHead>
                      <TableHead>Money put away</TableHead>
                      {potShown && <TableHead>{potName} account</TableHead>}
                      <TableHead className="w-0">Archive</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedAccounts.map((acct) => {
                      // A card's debt is always subtracted, so
                      // its row has no switch and never wears the "not counted" badge.
                      const isCard = isCardAccount(acct);
                      const isDrawable = isCard || (acct.drawable ?? defaultDrawableFor(acct));
                      return (
                        <TableRow key={acct.id}>
                          <TableCell className="font-medium">
                            <div className="flex flex-wrap items-center gap-2">
                              {/* The figure on this row is a BALANCE, not a sum of transactions, so
                                  the name opens the account's activity and that ledger says so. */}
                              <a
                                data-ledger="1"
                                href={ledgerHref({
                                  label: displayAccountName(acct.name),
                                  back: "#/settings/accounts",
                                  accountId: acct.id,
                                  countedAccountsOnly: false,
                                  transfers: "include",
                                  view: "account",
                                  from: period.from,
                                  to: period.to,
                                })}
                                className="underline-offset-4 hover:underline"
                              >
                                {displayAccountName(acct.name)}
                              </a>
                              {/* The bank's own name, so the row can be matched to the bank. */}
                              {displayAccountName(acct.name) !== bankName(acct.name) && (
                                <span className="basis-full text-xs font-normal text-muted-foreground">{bankName(acct.name)}</span>
                              )}
                              {!isDrawable && (
                                <Badge variant="outline" className="shrink-0 text-xs font-normal text-muted-foreground">
                                  Not counted as cash
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatCents(balanceById.get(acct.id) ?? 0)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{accountTypeLabel(acct.type)}</TableCell>
                          <TableCell>
                            <ToggleGroup
                              value={[acct.owner]}
                              onValueChange={(v: string[]) => {
                                const next = v[0] as Account["owner"] | undefined;
                                if (next && next !== acct.owner) handleOwnerChange(acct.id, next);
                              }}
                              aria-label={`Owner for ${acct.name}`}
                              variant="outline"
                              size="sm"
                            >
                              {ownerChoices(household).map((slot) => (
                                <ToggleGroupItem
                                  key={slot}
                                  value={slot}
                                  aria-label={`Set ${acct.name} owner to ${ownerLabel(slot, household)}`}
                                >
                                  {ownerLabel(slot, household)}
                                </ToggleGroupItem>
                              ))}
                            </ToggleGroup>
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={acct.includeInSpend}
                              onCheckedChange={(checked: boolean) => handleToggleInclude(acct.id, checked)}
                              disabled={togglingId === acct.id}
                              aria-label={`Counted: ${acct.name}`}
                            />
                          </TableCell>
                          <TableCell>
                            {isCard ? (
                              <span className="text-xs text-muted-foreground">Always subtracted</span>
                            ) : (
                              <Switch
                                checked={isDrawable}
                                onCheckedChange={(checked: boolean) => handleToggleDrawable(acct.id, checked)}
                                disabled={togglingId === acct.id}
                                aria-label={`Drawable: ${acct.name}`}
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <select
                              className="h-8 rounded-md border bg-background px-2 text-xs"
                              value={acct.savingsDestination ?? ""}
                              disabled={togglingId === acct.id}
                              aria-label={`Money put away in ${acct.name}`}
                              onChange={(e) => handleSavingsDestination(acct.id, e.target.value)}
                            >
                              <option value="">Not a savings account</option>
                              <option value="Investing">Investing</option>
                              <option value="Retirement">Retirement</option>
                            </select>
                          </TableCell>
                          {potShown && <TableCell>
                            <div className="flex flex-col gap-2">
                              <Switch
                                checked={!!acct.maaserPot}
                                onCheckedChange={(checked: boolean) => handleToggleMaaserPot(acct.id, checked)}
                                disabled={togglingId === acct.id}
                                aria-label={`${potName} account: ${acct.name}`}
                              />
                              {acct.maaserPot && !acct.archived && db && (
                                <MaaserFloorBox
                                  accountName={acct.name}
                                  floorCents={floorCents}
                                  onSave={async (cents) => {
                                    await deps.setMaaserFloor(db, cents);
                                    setFloorCents(cents);
                                  }}
                                />
                              )}
                            </div>
                          </TableCell>}
                          <TableCell>
                            <Switch
                              checked={!!acct.archived}
                              onCheckedChange={(checked: boolean) => handleToggleArchived(acct.id, checked)}
                              disabled={togglingId === acct.id}
                              aria-label={`Archive ${acct.name}`}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-base font-semibold">Accounts</h2>
        <p className="text-sm text-muted-foreground">
          Which accounts count toward spending, and toward the cash you can use. Retirement and charity set-asides start off; switch any of them on if you consider that money available. Card balances are always subtracted.
        </p>
      </div>
      {body}
    </div>
  );
}
