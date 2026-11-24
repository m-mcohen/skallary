// src/ui/ConnectorSection.tsx
//
// The SimpleFIN connector screen: connection state, the one-time account-typing
// pass, and the categorization review queue.
//
// Why this screen exists at all: SimpleFIN gives raw bank memos instead of
// Monarch's lossy labels, but it supplies NO account type, and a mistyped
// liability silently corrupts drawable (a card's positive balance reading as
// cash). So typing is user-owned and surfaced here until confirmed, and the
// review queue turns "what is this transaction?" into a rule that is never
// asked twice.
//
// Registry-first (see the ui-registries skill): @shadcn/card, @shadcn/table,
// @shadcn/badge, @shadcn/button, @shadcn/toggle-group and @shadcn/alert are
// already installed in this repo, so no `npx shadcn@latest add` was needed.
// The account-typing list follows @shadcnblocks/switch-switch-cards-3's
// settings-list pattern (divide-y rounded border; label and description left,
// control right) -- the closer block, @shadcnblocks/settings-members4, is Pro
// and returns 401. Row controls use ToggleGroup rather than Select, per
// AccountsSection.tsx: Base UI's Select popup has
// known jsdom click-through quirks in this repo's suite.
//
// Data layer is injected via the `dataLayer` prop (mirrors AccountsSection.tsx)
// so this file has no hard dependency on a live server: App.tsx passes the real
// db.ts functions, tests inject stubs, and a headless build renders a neutral
// "not connected" state instead of crashing.
import { useCallback, useEffect, useState } from "react";

import {
  loadDb,
  getConnectorStatusUI,
  connectSimpleFinUI,
  reconnectSimpleFinUI,
  disconnectSimpleFinUI,
  syncSimpleFinUI,
  setAccountTypeUI,
  getUncategorizedUI,
  getRulesUI,
  addRuleUI,
  deleteRuleUI,
  bootstrapRulesUI,
  rederiveRulesUI,
  getAccountsUI,
  type Db,
  type ConnectorStatus,
  type SyncSummary,
} from "./lib/db";
import type { Account, NormalizedTxn } from "../domain/types";
import type { CategorizationRule } from "../domain/rules";
import { formatCents } from "../domain/money";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { useConfirm } from "./ConfirmDialog";
import { ACCOUNT_TYPES, displayAccountName } from "../domain/account-display";
import { BRIDGE_URL, bankProblemShort, bankProblemStep, bankProblems, banksNeedYou } from "../domain/bank-problems";
import { localDateIso } from "../domain/period";
import { getBankGraceUI, setBankGraceUI } from "./lib/db-setup";
import { SYNCED_EVENT } from "./lib/useBankProblems";
import { SAMPLE_NO_BANK_SHORT, useSampleInstance } from "./lib/useSampleInstance";

export interface ConnectorDataLayer {
  loadDb: () => Promise<Db>;
  getConnectorStatus: (db: Db) => Promise<ConnectorStatus>;
  connect: (db: Db) => Promise<{ connected: boolean; alreadyConnected: boolean }>;
  /** Swaps a dead access for a fresh setup token from the usual file; data is kept. */
  reconnect: (db: Db) => Promise<{ reconnected: true }>;
  disconnect: (db: Db) => Promise<void>;
  sync: (db: Db) => Promise<SyncSummary>;
  setAccountType: (db: Db, id: string, type: string) => Promise<void>;
  getUncategorized: (db: Db) => Promise<NormalizedTxn[]>;
  getRules: (db: Db) => Promise<CategorizationRule[]>;
  addRule: (db: Db, rule: Omit<CategorizationRule, "id">) => Promise<number>;
  deleteRule: (db: Db, id: number) => Promise<void>;
  bootstrapRules: (db: Db) => Promise<{ created: number }>;
  rederiveRules: (db: Db) => Promise<{ removed: number; created: number }>;
  /** Every account, for each bank's newest balance date (a quiet bank). Optional: absent reads as none. */
  getAccounts?: (db: Db) => Promise<Account[]>;
  /** Banks that may lag, by name (trimmed, lower case), with their days. Optional: absent reads as none and saving is unavailable. */
  getBankGrace?: () => Promise<Record<string, number>>;
  setBankGrace?: (grace: Record<string, number>) => Promise<void>;
}

const defaultDataLayer: ConnectorDataLayer = {
  loadDb,
  getConnectorStatus: getConnectorStatusUI,
  connect: connectSimpleFinUI,
  reconnect: reconnectSimpleFinUI,
  disconnect: disconnectSimpleFinUI,
  sync: syncSimpleFinUI,
  setAccountType: setAccountTypeUI,
  getUncategorized: getUncategorizedUI,
  getRules: getRulesUI,
  addRule: addRuleUI,
  deleteRule: deleteRuleUI,
  bootstrapRules: bootstrapRulesUI,
  rederiveRules: rederiveRulesUI,
  getAccounts: getAccountsUI,
  getBankGrace: getBankGraceUI,
  setBankGrace: setBankGraceUI,
};


function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString();
}

/** A rule in words: what it matches. */
function describeRule(rule: CategorizationRule): string {
  return [
    rule.memoContains && `memo contains "${rule.memoContains}"`,
    rule.payeeContains && `payee contains "${rule.payeeContains}"`,
    rule.descriptionContains && `description contains "${rule.descriptionContains}"`,
    rule.mcc && `mcc ${rule.mcc}`,
    rule.amountCents != null && `amount ${formatCents(rule.amountCents)}`,
    rule.amountMinCents != null &&
      rule.amountMaxCents != null &&
      `amount ${formatCents(rule.amountMinCents)} to ${formatCents(rule.amountMaxCents)}`,
  ]
    .filter(Boolean)
    .join(" and ");
}

/**
 * One "wait days" box per bank. Blank means the usual rule (a bank is named after 3 quiet days);
 * a number gives that bank more time, for a bank that cannot stay signed in.
 */
function BankWaitDays({ banks, grace, disabled, onSave }: {
  banks: { key: string; name: string }[];
  grace: Record<string, number>;
  disabled: boolean;
  onSave: (grace: Record<string, number>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const shown = (key: string) => draft[key] ?? (grace[key] !== undefined ? String(grace[key]) : "");
  const save = () => {
    // Names saved earlier that are not in this list stay as they are.
    const next: Record<string, number> = { ...grace };
    for (const b of banks) {
      const raw = shown(b.key).trim();
      if (raw === "") { delete next[b.key]; continue; }
      const days = Number(raw);
      if (!Number.isInteger(days) || days < 1 || days > 90) {
        setProblem(`${b.name}: enter a whole number of days from 1 to 90, or leave it blank.`);
        return;
      }
      next[b.key] = days;
    }
    setProblem(null);
    setDraft({});
    onSave(next);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>How long a bank may wait</CardTitle>
        <CardDescription>
          A bank is named as needing you after 3 days without new data. If a bank can&rsquo;t stay signed
          in, give it more days here. Leave a box blank to use the usual 3.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col divide-y rounded-lg border bg-background">
          {banks.map((b) => (
            <label key={b.key} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <span className="font-medium">{b.name}</span>
              <span className="flex items-center gap-2">
                <Input
                  className="w-20"
                  inputMode="numeric"
                  placeholder="3"
                  aria-label={`Wait days for ${b.name}`}
                  value={shown(b.key)}
                  onChange={(e) => setDraft((d) => ({ ...d, [b.key]: e.target.value }))}
                />
                <span className="text-muted-foreground">days</span>
              </span>
            </label>
          ))}
        </div>
        {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        <Button className="self-start" disabled={disabled} onClick={save}>Save</Button>
      </CardContent>
    </Card>
  );
}

export default function ConnectorSection({ dataLayer = defaultDataLayer }: { dataLayer?: ConnectorDataLayer }) {
  const [db, setDb] = useState<Db | null>(null);
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [uncategorized, setUncategorized] = useState<NormalizedTxn[]>([]);
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [grace, setGrace] = useState<Record<string, number>>({});
  const [ruleQuery, setRuleQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  // Sample data is never linked to a bank (the server refuses too): say so instead of offering it.
  const sample = useSampleInstance();

  const reload = useCallback(
    async (handle: Db) => {
      const [nextStatus, nextQueue, nextRules, nextAccounts, nextGrace] = await Promise.all([
        dataLayer.getConnectorStatus(handle),
        dataLayer.getUncategorized(handle),
        dataLayer.getRules(handle),
        dataLayer.getAccounts ? dataLayer.getAccounts(handle) : Promise.resolve([]),
        // A grace list that cannot be read is no grace: every bank keeps the usual rule.
        dataLayer.getBankGrace ? dataLayer.getBankGrace().catch(() => ({})) : Promise.resolve({}),
      ]);
      setGrace(nextGrace);
      setStatus(nextStatus);
      setAccounts(nextAccounts);
      setUncategorized(nextQueue);
      setRules(nextRules);
    },
    [dataLayer]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const handle = await dataLayer.loadDb();
        if (cancelled) return;
        setDb(handle);
        await reload(handle);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataLayer, reload]);

  /** Wraps an action so every button shares the same busy/error/reload handling. */
  const run = useCallback(
    async (action: (handle: Db) => Promise<string | void>) => {
      if (!db) return;
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const note = await action(db);
        if (note) setMessage(note);
        await reload(db);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [db, reload]
  );

  if (error && !status) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">{error}</div>
    );
  }
  if (!status) return <div className="text-sm text-muted-foreground">Loading connector…</div>;

  const needsType = status.accountsNeedingType;
  // The same list as the Sync button's box, the banner and the Dashboard line.
  const today = localDateIso();
  const problems = bankProblems({ errors: status.lastErrors, accounts, today, graceDays: grace });
  // Each bank once, by the name its accounts carry; the saved list is keyed by that name, trimmed and lower case.
  const banks = [...new Map(accounts.filter((a) => !a.archived && a.institution?.trim()).map((a) => [a.institution!.trim().toLowerCase(), a.institution!.trim()])).entries()]
    .map(([key, name]) => ({ key, name }))
    .sort((x, y) => x.name.localeCompare(y.name));
  const otherWarnings = status.lastErrors.filter((e) => e.code !== "con.auth");
  const query = ruleQuery.trim().toLowerCase();
  const shownRules = query
    ? rules.filter((r) => `${describeRule(r)} ${r.toCategory ?? r.action}`.toLowerCase().includes(query))
    : rules;

  return (
    <div className="flex flex-col gap-4">
      {/* One confirmation dialog for the whole screen, never inside a card that can go away. */}
      {confirm.dialog}
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          {message}
        </div>
      )}

      {/* --- Connection ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Bank connection
            <Badge variant={status.connected ? "default" : "secondary"}>
              {status.connected ? "Connected" : "Not connected"}
            </Badge>
          </CardTitle>
          <CardDescription>
            {sample ? (
              <>{SAMPLE_NO_BANK_SHORT} Your own copy of the app, started the usual way, is where banks are linked.</>
            ) : status.accessLost ? (
              <>
                SimpleFIN access was revoked or expired, so nothing new can come in. Generate a new setup
                token on the SimpleFIN Bridge website and save it to{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{status.setupTokenPath}</code>, then
                press Reconnect. Your data is kept: accounts, transactions and sync dates stay exactly as
                they are.
              </>
            ) : status.connected ? (
              <>
                Last pulled {formatWhen(status.lastSyncedAt)}. SimpleFIN refreshes each account about once a
                day on its own schedule, so syncing more often won&rsquo;t fetch anything newer.
              </>
            ) : (
              <>
                Save a setup token from the SimpleFIN Bridge to{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{status.setupTokenPath}</code>, then
                connect. The token decodes to credentials for every linked bank, so it stays on disk rather
                than being pasted into the app.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button disabled={sample || busy || status.connected} onClick={() => run(async (h) => {
            const res = await dataLayer.connect(h);
            return res.alreadyConnected ? "Already connected." : "Connected to SimpleFIN.";
          })}>
            Connect
          </Button>
          {/* Only when access is really gone: one bank needing a sign-in is not this. */}
          {status.accessLost && (
            <Button disabled={sample || busy} onClick={() => run(async (h) => {
              await dataLayer.reconnect(h);
              return "Reconnected to SimpleFIN. All your data is kept. Press Sync now to catch up.";
            })}>
              Reconnect
            </Button>
          )}
          <Button variant="outline" disabled={sample || busy || !status.connected} onClick={() => run(async (h) => {
            const s = await dataLayer.sync(h);
            if (s.needsReconnect) return "SimpleFIN needs reconnecting. Save a new setup token to the file named above, then press Reconnect.";
            const synced = `Synced ${s.accounts} accounts: ${s.inserted} new, ${s.updated} updated.`;
            // Read the saved state again, as the banner does, so the message names the same banks.
            const [after, afterAccounts] = await Promise.all([
              dataLayer.getConnectorStatus(h),
              dataLayer.getAccounts ? dataLayer.getAccounts(h) : Promise.resolve([]),
            ]);
            // The banner on every screen reads again too.
            window.dispatchEvent(new Event(SYNCED_EVENT));
            const found = bankProblems({ errors: after.lastErrors, accounts: afterAccounts, today: localDateIso(), graceDays: grace });
            return found.length ? `${synced} ${found.map((p) => `${bankProblemShort(p, localDateIso())}.`).join(" ")}` : synced;
          })}>
            Sync now
          </Button>
          {status.connected && (
            <Button variant="outline" disabled={sample || busy} onClick={() => confirm.ask({
              title: "Stop syncing your banks?",
              description: "Skallary will forget its access key and delete the token file. Your accounts and past transactions stay. To end sharing completely, also turn off Skallary's access in SimpleFIN Bridge.",
              confirmLabel: "Disconnect",
              onConfirm: () => run(async (h) => {
                await dataLayer.disconnect(h);
                window.dispatchEvent(new Event(SYNCED_EVENT));
                return "Disconnected from SimpleFIN.";
              }),
            })}>
              Disconnect
            </Button>
          )}
        </CardContent>
        {/* Each bank that needs the user, in the same words as the Sync button's box. */}
        {problems.length > 0 && (
          <CardContent>
            <div data-testid="connector-bank-problems" className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">{banksNeedYou(problems.length)}</p>
              <ul className="flex flex-col gap-1">
                {problems.map((p) => (
                  <li key={`${p.kind}:${p.bank}`}>
                    <span className="text-destructive">{bankProblemShort(p, today)}.</span>{" "}
                    <span className="text-muted-foreground">{bankProblemStep(p)}</span>
                  </li>
                ))}
              </ul>
              <a href={BRIDGE_URL} target="_blank" rel="noreferrer" className="self-start underline underline-offset-4 hover:text-foreground">
                Open SimpleFIN Bridge
              </a>
            </div>
          </CardContent>
        )}
      </Card>

      {otherWarnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Feed warnings</CardTitle>
            <CardDescription>
              Reported by SimpleFIN on the last pull. A single account failing is usually a transient bank
              error; everything else still imported.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {/* A bank asking for a sign-in is a step for the user, not a code to
                decode, so it is said once as that step, in the list above. */}
            {otherWarnings.map((e, i) => (
              <div key={i} className="flex gap-2">
                <code className="text-xs text-muted-foreground">{e.code}</code>
                <span>{e.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* --- How long a bank may go quiet ---------------------------------- */}
      {dataLayer.setBankGrace && banks.length > 0 && (
        <BankWaitDays
          banks={banks}
          grace={grace}
          disabled={busy}
          onSave={(next) => run(async () => { await dataLayer.setBankGrace!(next); return "Saved how long each bank may wait."; })}
        />
      )}

      {/* --- Account typing ------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Confirm account types</CardTitle>
          <CardDescription>
            SimpleFIN doesn&rsquo;t say what kind of account each one is, and the answer decides whether a
            balance adds to or subtracts from your drawable cash. Unconfirmed accounts are left out of
            drawable rather than guessed at, so this list is worth clearing once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {needsType.length === 0 ? (
            <p className="text-sm text-muted-foreground">All accounts are typed.</p>
          ) : (
            <div className="flex flex-col divide-y rounded-lg border bg-background">
              {needsType.map((account) => (
                <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{displayAccountName(account.name)}</span>
                    <span className="text-xs text-muted-foreground">
                      {account.institution ?? "Unknown institution"}
                      {account.suggestedType ? ` · looks like ${account.suggestedType}` : ""}
                    </span>
                  </div>
                  <ToggleGroup
                    aria-label={`${account.name} type`}
                    value={account.type ? [account.type] : []}
                    onValueChange={(value: string[]) => {
                      const next = value[0];
                      if (next) void run(async (h) => {
                        await dataLayer.setAccountType(h, account.id, next);
                        return `${account.name} set to ${next}.`;
                      });
                    }}
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <ToggleGroupItem key={t.value} value={t.value} aria-label={t.label} disabled={busy}>
                        {t.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Needs a category ------------------------------------------ */}
      {/* The review queue itself lives on Transactions, Needs a
          category. This screen keeps the count and a link, not a second copy. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Needs a category
            {uncategorized.length > 0 && <Badge variant="secondary">{uncategorized.length}</Badge>}
          </CardTitle>
          <CardDescription>
            {uncategorized.length === 0
              ? "Nothing is waiting for a category. "
              : `${uncategorized.length} transaction${uncategorized.length === 1 ? "" : "s"} no rule covers yet. `}
            They are filed on{" "}
            <a href="#/transactions/needs-category" className="underline underline-offset-4 hover:text-foreground">
              Transactions, Needs a category
            </a>
            ; filing one there writes a rule from its payee.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* --- Rules ---------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Categorization rules</CardTitle>
          <CardDescription>
            Create rules from past categories to file future purchases the same way. The app looks for merchants or bank notes
            you usually file in the same category. Rules you wrote by hand take priority.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => run(async (h) => {
              const res = await dataLayer.bootstrapRules(h);
              return res.created === 0
                ? "No new rules found in your categorized transactions."
                : `Learned ${res.created} rule${res.created === 1 ? "" : "s"} from your existing categorized history.`;
            })}>
              Create rules from past categories
            </Button>
            <Button variant="outline" disabled={busy} onClick={() =>
              confirm.ask({
                title: "Rebuild learned rules?",
                description: "This deletes every rule the app learned from history and builds them again from your transactions as they stand now. Rules you wrote by hand are not touched. This cannot be undone.",
                confirmLabel: "Rebuild rules",
                onConfirm: () => void run(async (h) => {
                  const res = await dataLayer.rederiveRules(h);
                  return `Rebuilt your learned rules: removed ${res.removed}, kept ${res.created}. `
                    + `Rules that no longer meet the confidence bar are gone, so those transactions go to Transactions, Needs a category instead of being filed wrongly.`;
                }),
              })
            }>
              Rebuild learned rules
            </Button>
          </div>
          {rules.length > 0 && (
            <Input
              type="search"
              aria-label="Search rules"
              placeholder="Search rules"
              value={ruleQuery}
              onChange={(e) => setRuleQuery(e.target.value)}
              className="max-w-sm"
            />
          )}
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Matches</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownRules.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-sm text-muted-foreground">No rule matches.</TableCell>
                    </TableRow>
                  )}
                  {shownRules.map((rule) => (
                    <TableRow key={rule.id} data-testid={`rule-row-${rule.id}`}>
                      <TableCell className="text-sm">{describeRule(rule)}</TableCell>
                      <TableCell>{rule.toCategory ?? rule.action}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={`Delete rule ${rule.id}`}
                          onClick={() =>
                            confirm.ask({
                              title: `Delete rule ${rule.id}?`,
                              description: "Transactions this rule was filing, and that have no category of their own, go back to needing a category. This cannot be undone.",
                              confirmLabel: "Delete rule",
                              onConfirm: () => void run(async (h) => {
                                await dataLayer.deleteRule(h, rule.id);
                                return "Rule deleted.";
                              }),
                            })
                          }
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
