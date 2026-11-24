// src/ui/shell/AppShell.tsx
//
// Layout, routing, scroll reset, and section dispatch.
//
// Panels are rendered with exactly the props they took under the old mode
// shell, so every tests/ui/*.test.tsx keeps passing untouched. They restyle in
// later plans, one at a time.
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";

import { getTransactionsUI, loadDb, type Db } from "../lib/db";
import { usePlanState } from "../lib/usePlanState";
import { parseLedgerQuery } from "../lib/ledger-link";
import AppSidebar, { readSidebarCookie } from "./AppSidebar";
import SiteHeader from "./SiteHeader";
import EquationBar, { useEquationBarCollapsed } from "./EquationBar";
import OverlayBanner from "./OverlayBanner";
import BankProblemsBanner from "./BankProblemsBanner";
import SampleDataStrip from "./SampleDataStrip";
import { useSampleInstance } from "../lib/useSampleInstance";
import { useBankProblems } from "../lib/useBankProblems";
import PageAnswers from "../help/PageAnswers";
import { findSubPage, resolveRoute } from "./nav";
import { formatRoute, navigate, useRoute } from "./router";

import DashboardSection from "../DashboardSection";
import { getHouseholdUI, getSetupProgressUI } from "../lib/db-setup";
import { isSetupStepId } from "../../domain/setup-progress";

const SetupInterview = lazy(() => import("../setup/SetupInterview"));
const HouseholdSettings = lazy(() => import("../HouseholdSettings"));

const BudgetMonth = lazy(() => import("../budget/BudgetMonth"));
const BudgetYear = lazy(() => import("../budget/BudgetYear"));
const YearlyCostsTab = lazy(() => import("../yearly/YearlyCostsTab"));
const Charts = lazy(() => import("../Charts"));
const CategoryMappingDialog = lazy(() => import("../CategoryMappingDialog"));
const GoalsSection = lazy(() => import("../GoalsSection"));
const WishlistSection = lazy(() => import("../WishlistSection"));
const RunwayOverview = lazy(() => import("../RunwayOverview"));
const AccountsBalances = lazy(() => import("../AccountsBalances"));
const WhatIfSection = lazy(() => import("../what-if/WhatIfSection"));
const NotesHistorySection = lazy(() => import("../NotesHistorySection"));
const AccountsSection = lazy(() => import("../AccountsSection"));
const TransactionsSection = lazy(() => import("../TransactionsSection"));
const ReportsSection = lazy(() => import("../ReportsSection"));
const BillsSection = lazy(() => import("../BillsSection"));
const NetWorthSection = lazy(() => import("../NetWorthSection"));
const ConnectorSection = lazy(() => import("../ConnectorSection"));
const SalaryAssumptionsCard = lazy(() => import("../SalaryAssumptionsCard"));
const CharityPotSettings = lazy(() => import("../CharityPotSettings"));
const CurrentSalaryCard = lazy(() => import("../CurrentSalaryCard"));
const GuideSettings = lazy(() => import("../GuideSettings"));
const AppearanceSettings = lazy(() => import("../AppearanceSettings"));
const AboutSettings = lazy(() => import("../AboutSettings"));
const LifestyleGroupsCard = lazy(() => import("../LifestyleGroupsCard"));
const MerchantSettings = lazy(() => import("../MerchantSettings"));
const MerchantPage = lazy(() => import("../reports/MerchantPage"));
const HelpSection = lazy(() => import("../help/HelpSection"));

type SyncState =
  | { status: "loading" }
  | { status: "unavailable" } // the local Node server is not reachable
  | { status: "empty" } // db reachable, but nothing imported yet
  | { status: "ok"; throughDate: string; transactionCount: number };

// Moved from App.tsx unchanged.
function useSyncStatus(): SyncState {
  const [state, setState] = useState<SyncState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let db: Db;
      try {
        db = await loadDb();
      } catch {
        // Expected when the local server is unreachable (headless, jsdom).
        if (!cancelled) setState({ status: "unavailable" });
        return;
      }

      try {
        const txns = await getTransactionsUI(db);
        if (cancelled) return;
        if (txns.length === 0) {
          setState({ status: "empty" });
          return;
        }
        const throughDate = txns.reduce((max, t) => (t.date > max ? t.date : max), txns[0].date);
        setState({ status: "ok", throughDate, transactionCount: txns.length });
      } catch {
        if (!cancelled) setState({ status: "unavailable" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * Only the states that need an answer from you.
 *
 * The old shell showed a full-width "Data current through <date>" alert above
 * every screen. That is provenance, not a problem -- it belongs on the
 * Dashboard, which is where the next task puts it. What stays here is the two
 * states that explain why a screen is empty, because those are worth
 * interrupting for wherever you happen to be.
 */
function SyncStatusBanner({ sync }: { sync: SyncState }) {
  if (sync.status === "loading" || sync.status === "ok") return null;

  if (sync.status === "unavailable") {
    return (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>
          No local database connection. The local server is not reachable. Restart the app.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <AlertTitle>No data yet</AlertTitle>
      <AlertDescription>
        Connected to the local database, but no transactions have been imported yet.
      </AlertDescription>
    </Alert>
  );
}

/**
 * The raw query string from the current hash, `#/section?k=v` -> "k=v".
 * The router deliberately drops the query when building routes, so parsing
 * happens here at the read point rather than in nav.ts.
 */
function hashQuery(): URLSearchParams {
  const h = window.location.hash;
  const q = h.indexOf("?");
  return new URLSearchParams(q < 0 ? "" : h.slice(q + 1));
}

/**
 * The first-run gate. With no household yet, or an interview never
 * finished, the interview is all there is. A server that cannot be reached opens the app as
 * before, so its "not connected" messages show. `#/setup/<step>` opens one step any time.
 */
export default function AppShell() {
  const route = useRoute();
  const [gate, setGate] = useState<"checking" | "interview" | "app">("checking");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getHouseholdUI(), getSetupProgressUI()])
      .then(([household, progress]) => {
        if (!cancelled) setGate(household === null || !progress?.finishedAt ? "interview" : "app");
      })
      .catch(() => {
        if (!cancelled) setGate("app");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate === "checking") return <div className="min-h-svh bg-background" />;
  const revisit = gate === "app" && route.section === "setup";
  if (gate === "interview" || revisit) {
    const startAt = revisit && isSetupStepId(route.tab) ? route.tab : undefined;
    return (
      <Suspense fallback={<div className="min-h-svh bg-background" />}>
        <SetupInterview key={startAt ?? "all"} startAt={startAt} onFinished={() => setGate("app")} />
      </Suspense>
    );
  }
  return <MainShell />;
}

function MainShell() {
  const route = useRoute();
  const { item, tab } = resolveRoute(route);
  const plan = usePlanState();
  const sync = useSyncStatus();
  const banks = useBankProblems();
  const sample = useSampleInstance();
  const mainRef = useRef<HTMLDivElement | null>(null);

  // Defect 2. Clicking a nav item used to keep the previous screen's scroll
  // offset, landing you mid-way down a grid with rows cut off above -- which
  // reads as breakage. Both the window and the inset are scrolled because
  // which one owns the overflow depends on the panel.
  useEffect(() => {
    // typeof-guarded because jsdom implements neither, and an unguarded call
    // would throw during tests rather than no-op.
    if (typeof window.scrollTo === "function") window.scrollTo({ top: 0 });
    const main = mainRef.current;
    if (main && typeof main.scrollTo === "function") main.scrollTo({ top: 0 });
    // Help has no tabs; its second segment is the article, and a new article
    // should start at the top the same way a new tab does.
  }, [item.id, tab?.id, item.id === "help" ? route.tab : null]);

  const [barCollapsed, setBarCollapsed] = useEquationBarCollapsed();
  const section = item.id;
  const tabId = tab?.id ?? null;
  // A page under a screen with no tab of its own.
  const subPage = findSubPage(section, route.tab);

  return (
    // --header-height is the combined height of SiteHeader (h-14) and
    // EquationBar (h-16 on a desktop, h-12 folded): 56 + 64 = 120px, or 56 + 48 = 104px. AppSidebar
    // offsets itself by it so the fixed sidebar starts below both bars instead of covering them.
    <SidebarProvider
      defaultOpen={readSidebarCookie()}
      className="flex flex-col"
      style={{ "--header-height": barCollapsed ? "6.5rem" : "7.5rem" } as CSSProperties}
    >
      <SiteHeader
        item={item}
        tab={tab}
        planName={plan.planName}
        scenarios={plan.whatIfScenarios}
        scenarioId={plan.scenarioId}
        onPickScenario={plan.setScenarioId}
      />
      <EquationBar
        equation={plan.summary?.equation ?? null}
        scenarioLabel={plan.summary?.scenarioLabel ?? null}
        unavailable={sync.status === "unavailable"}
        unreadable={plan.summary?.equationUnreadable ?? false}
        collapsed={barCollapsed}
        onCollapsedChange={setBarCollapsed}
      />

      <div className="flex flex-1">
        <AppSidebar activeSection={section} />
        {/* min-w-0 is load-bearing: a flex item defaults to min-width:auto,
            so without it a wide panel (the Accounts table, the AG-Grid budget)
            refuses to shrink and pushes the whole PAGE sideways instead of
            scrolling inside its own area. */}
        <SidebarInset className="min-w-0">
          {/* Every screen, while a what-if is on. Inside the
              inset, not between the bars, so the fixed sidebar never covers it. */}
          {/* A bank that needs a sign-in or has gone quiet: every screen, from the saved state, so it also shows
              after the start-up sync. Same place and reason as the what-if banner. */}
          <div className="px-4 pt-3 empty:hidden md:px-section">
            {banks && <BankProblemsBanner problems={banks.problems} lastSyncedAt={banks.lastSyncedAt} today={banks.today} syncing={banks.syncing} refreshReady={banks.refreshReady} />}
          </div>
          <div className="px-4 pt-3 empty:hidden md:px-section">
            <OverlayBanner
              name={plan.activeWhatIf ? (plan.whatIfScenarios.find((s) => s.id === plan.activeWhatIf!.scenarioId)?.name ?? null) : null}
              goalCostsMissing={plan.goalCostsMissing}
              usesWhatIf={item.usesWhatIf === true}
              onTurnOff={() => plan.setScenarioId(null)}
            />
          </div>
          {item.tabs && (
            // Anchors, not a controlled <Tabs>. A controlled tab strip whose
            // onValueChange writes the URL, while the URL writes its value
            // back, is a two-way binding -- and the Back button changing the
            // hash out from under it made the two fight until the renderer
            // froze. Reproducible: click a tab, press Back.
            //
            // One-way instead: the URL is the only state, and these navigate
            // to it the same way the sidebar does. Same benefit too -- they
            // middle-click and copy as links.
            //
            // flex-wrap: Settings' six tabs ran
            // 521 px wide on a 390 px phone and pushed the page sideways; they
            // wrap onto a second line instead, and gap-1 spaces the rows too.
            <div
              role="tablist"
              className="flex flex-wrap gap-1 px-4 pt-3 md:px-section"
            >
              {item.tabs.map((t) => {
                const selected = t.id === tabId;
                return (
                  <a
                    key={t.id}
                    role="tab"
                    aria-selected={selected}
                    href={formatRoute({ section, tab: t.id })}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      navigate({ section, tab: t.id });
                    }}
                    className={
                      "rounded-md px-3 py-1.5 text-sm transition-colors " +
                      (selected
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {t.label}
                  </a>
                );
              })}
            </div>
          )}

          <div ref={mainRef} className="flex min-w-0 flex-col gap-section overflow-x-auto p-4 md:p-section">
            {/* "This page answers": one line, every
                screen, from the same help data the "?" panel reads. */}
            <PageAnswers sectionId={section} tabId={subPage ? subPage.page : tabId} />
            <SyncStatusBanner sync={sync} />

            {section === "dashboard" && (
              <DashboardSection
                summary={plan.summary}
                planId={plan.planId}
                onChanged={plan.refresh}
                whatIfOn={plan.activeWhatIf !== null && plan.activeWhatIf !== undefined}
                unavailable={sync.status === "unavailable"}
              />
            )}

            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              {/* One page: the net worth line on top,
                  the folding account groups and the Summary below. */}
              {section === "accounts" && (
                <div className="flex flex-col gap-section">
                  <NetWorthSection />
                  <AccountsBalances />
                </div>
              )}
              {section === "reports" && (subPage?.page === "merchant" ? <MerchantPage /> : <ReportsSection />)}
              {section === "recurring" && <BillsSection />}
              {section === "transactions" && (() => {
                // The router strips the hash query from the tab, so a ledger
                // link (a summed figure on another screen, clicked through to
                // the rows behind it) gets read here and threaded through.
                const q = hashQuery();
                const parsed = parseLedgerQuery(q);
                const initialFilter = {
                  ...(tabId === "needs-category" ? { needsCategory: true as const } : {}),
                  ...parsed.initialFilter,
                };
                // Keyed by the query: a different ledger link is a different
                // ledger, so every filter field follows the link rather than
                // only the ones the screen knows how to re-sync. The period keys
                // are left out: the screen follows a period change by itself,
                // without remounting and fetching every transaction again.
                const identity = new URLSearchParams(q);
                for (const k of ["period", "from", "to"]) identity.delete(k);
                return (
                  <TransactionsSection
                    key={identity.toString()}
                    initialFilter={initialFilter}
                    ledger={parsed.ledger}
                  />
                );
              })()}
              {section === "budget" && tabId === "month" && (
                // The Dashboard's Review your budget links here with ?setup=1.
                <BudgetMonth planId={plan.planId} onChanged={plan.refresh} startSetup={hashQuery().get("setup") === "1"} />
              )}
              {section === "budget" && tabId === "year" && <BudgetYear planId={plan.planId} onChanged={plan.refresh} />}
              {section === "budget" && tabId === "yearly" && <YearlyCostsTab planId={plan.planId} onChanged={plan.refresh} />}
              {section === "budget" && tabId === "charts" && <Charts planId={plan.planId} />}
              {/* Forecast: the Runway screen, renamed; the component keeps its file name. */}
              {section === "forecast" && <RunwayOverview planId={plan.planId} scenario={plan.scenario} whatIf={plan.activeWhatIf} goals={plan.goals} salaryAssumptions={plan.salaryAssumptions} />}
              {section === "goals" && tabId === "goals" && <GoalsSection planId={plan.planId} onBudgetChanged={plan.refresh} onGoalsChanged={plan.refreshWhatIfs} />}
              {section === "goals" && tabId === "wishlist" && (
                <WishlistSection />
              )}
              {/* Editing here never switches the app: the screen gets no way to
                  pick the what-if that is on, only a refresh after each save. */}
              {section === "whatif" && (
                <WhatIfSection planId={plan.planId} onChanged={plan.refresh} onWhatIfSaved={plan.refreshWhatIfs} unavailable={sync.status === "unavailable"} />
              )}
              {section === "notes" && <NotesHistorySection planId={plan.planId} />}
              {section === "settings" && tabId === "household" && <HouseholdSettings />}
              {section === "settings" && tabId === "connection" && <ConnectorSection />}
              {section === "settings" && tabId === "accounts" && <AccountsSection />}
              {section === "settings" && tabId === "mappings" && (
                <div className="flex flex-col gap-4">
                  <CategoryMappingDialog inline />
                  <LifestyleGroupsCard />
                </div>
              )}
              {section === "settings" && tabId === "merchants" && <MerchantSettings />}
              {section === "settings" && tabId === "salary" && (
                <div className="flex flex-col gap-4">
                  {/* Real income first: the Forecast runs it; the assumptions below price it. */}
                  <CurrentSalaryCard onChanged={plan.refresh} />
                  <SalaryAssumptionsCard onChanged={plan.refresh} />
                  <CharityPotSettings onChanged={plan.refresh} />
                </div>
              )}
              {section === "settings" && tabId === "guide" && <GuideSettings />}
              {section === "settings" && tabId === "appearance" && <AppearanceSettings />}
              {section === "settings" && tabId === "about" && <AboutSettings />}
              {section === "help" && <HelpSection selectedKey={route.tab} />}
            </Suspense>
          </div>
          {/* The sample app (plan task 6): held at the foot of the window on every screen,
              where it never moves the top bars or covers a figure. */}
          {sample && (
            <div className="sticky bottom-0 z-10 mt-auto">
              <SampleDataStrip />
            </div>
          )}
        </SidebarInset>
      </div>
      {/* The "Filed. Undo" message after each filing, once for every screen. */}
      <Toaster position="bottom-center" />
    </SidebarProvider>
  );
}
