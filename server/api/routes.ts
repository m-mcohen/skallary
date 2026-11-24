// server/api/routes.ts
// API layer: routes only, no business logic and no direct DB access here.
// Every route is a thin HTTP<->readService binding: GET for reads, POST for
// writes/upserts, DELETE for removal-by-id. Reads/POST bodies mirror the
// exact domain shapes the repository (NodeRepository) already returns/
// accepts -- no reshaping here, no reimplementing the ''<->null budget-line
// period boundary or the integer-cents convention (both live in repo.node.ts).
import { Router } from "express";
import { yearlyCostsRoutes } from "./yearlyCostsRoutes.js";
import * as readService from "../services/readService.js";
import * as connectorService from "../services/connectorService.js";
import * as categorizationService from "../services/categorizationService.js";
import { budgetChangeService } from "../services/budgetChangeService.js";
import { setupService } from "../services/setupService.js";
import { validateFiling } from "../../src/domain/categorizations.js";
import { isLockedCategory } from "../../src/domain/starter-set.js";
import { getMortgageRates } from "../services/mortgageRateService.js";
import { getTheme, setTheme } from "../services/settingsService.js";
import { isSampleInstance, SAMPLE_NO_BANK } from "../instance.js";
import { settingsRoutes } from "./settingsRoutes.js";

export function routes(): Router {
  const r = Router();
  r.use(yearlyCostsRoutes());
  // The household settings: the names, and whether the partner's own accounts count.
  r.use(settingsRoutes());
  r.get("/health", (_req, res) => res.json({ ok: true }));
  // Which app answered: the start files open a window only when this says what they expect.
  r.get("/instance", (_req, res) => res.json({ sample: isSampleInstance() }));

  r.get("/accounts", (_req, res) => res.json(readService.getAccounts()));

  // Accounts management (raw, not the effective/calc-facing list above) +
  // the owner slot that, with the include-partner setting, drives the effective list.
  r.get("/accounts/manage", (_req, res) => res.json(readService.getAccountsManage()));
  r.post("/accounts/:id/owner", (req, res) => {
    try {
      readService.setAccountOwner(req.params.id, req.body?.owner);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  r.post("/accounts/:id/include", (req, res) => {
    readService.setAccountInclude(req.params.id, !!req.body?.includeInSpend);
    res.status(204).end();
  });

  // --- SimpleFIN connector ---------------------------------------------------
  // The setup token is read from a file on disk, never a request body: it
  // decodes to credentials for every linked bank.
  r.get("/simplefin/status", (_req, res) => res.json(connectorService.getStatus()));

  // Sample data is never linked to a bank. Refuse bank actions on the server.
  r.use(["/simplefin/connect", "/simplefin/reconnect", "/simplefin/disconnect", "/simplefin/sync"], (_req, res, next) => {
    if (!isSampleInstance()) return next();
    res.status(403).json({ ok: false, error: SAMPLE_NO_BANK });
  });

  r.post("/simplefin/connect", async (_req, res) => {
    try {
      res.json(await connectorService.connect());
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  // Replaces a dead access url with a fresh setup token from the same file.
  r.post("/simplefin/reconnect", async (_req, res) => {
    try {
      res.json(await connectorService.reconnect());
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  r.post("/simplefin/disconnect", async (req, res) => {
    if (req.body?.confirmed !== true) {
      res.status(400).json({ ok: false, error: "Confirm that you want to disconnect your banks." });
      return;
    }
    try {
      await connectorService.disconnect();
      res.status(204).end();
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  r.post("/simplefin/sync", async (_req, res) => {
    try {
      res.json({ ok: true, summary: await connectorService.sync() });
    } catch (e) {
      // "Not connected" is a user-fixable setup problem, not a server fault.
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  // The one-time typing pass. SimpleFIN supplies no account type, and a
  // mistyped liability silently corrupts drawable, so this is user-owned.
  r.post("/accounts/:id/type", (req, res) => {
    try {
      connectorService.setAccountType(req.params.id, req.body?.type);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  // Whether this account's balance counts as cash you can draw on. Separate
  // from /include, which is about whether its transactions count as spending.
  r.post("/accounts/:id/drawable", (req, res) => {
    const v = req.body?.drawable;
    connectorService.setAccountDrawable(req.params.id, v === null ? null : !!v);
    res.status(204).end();
  });

  // Hides a superseded account record (the legacy Monarch row left behind by
  // the SimpleFIN cutover). Presentational only -- nothing leaves the math.
  r.post("/accounts/:id/archived", (req, res) => {
    connectorService.setAccountArchived(req.params.id, !!req.body?.archived);
    res.json({ ok: true });
  });

  // Where money put away in this account lands: 'Investing', 'Retirement', or
  // null for an ordinary account. This is the flag the saving rule reads.
  // The pot account: the one account the charity pot is set aside in and gifts are
  // paid back from. One at a time; the repository keeps that.
  r.post("/accounts/:id/maaser-pot", (req, res) => {
    try {
      connectorService.setAccountMaaserPot(req.params.id, req.body?.on);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  r.post("/accounts/:id/savings-destination", (req, res) => {
    try {
      connectorService.setAccountSavingsDestination(req.params.id, req.body?.savingsDestination ?? null);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  // --- Categorization rules ---------------------------------------------------
  r.get("/rules", (_req, res) => res.json(connectorService.getRules()));
  r.post("/rules", (req, res) => {
    try {
      res.json({ id: connectorService.addRule(req.body) });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  r.delete("/rules/:id", (req, res) => {
    connectorService.deleteRule(Number(req.params.id));
    res.status(204).end();
  });
  r.post("/rules/bootstrap", (_req, res) => res.json(connectorService.bootstrapRules()));
  r.post("/rules/rederive", (_req, res) => res.json(connectorService.rederiveRules()));

  // Re-walk SimpleFIN's full window rather than only the days since last sync.
  r.post("/simplefin/reset-backfill", (req, res) => {
    const days = Number(req.body?.days);
    connectorService.resetBackfillBookmarks(Number.isFinite(days) && days > 0 ? days : undefined);
    res.json({ ok: true });
  });

  // The review queue: everything no rule and no feed category covers.
  r.get("/transactions/uncategorized", (_req, res) => res.json(connectorService.getUncategorized()));

  // The "This page answers" line's on/off switch.
  r.get("/settings/guide", (_req, res) => res.json({ show: readService.getShowGuideLines() }));
  r.post("/settings/guide", (req, res) => {
    readService.setShowGuideLines(!!req.body?.show);
    res.status(204).end();
  });

  // The theme switch (Settings, Appearance): "light", "dark" or "system".
  r.get("/settings/theme", (_req, res) => res.json({ theme: getTheme() }));
  r.post("/settings/theme", (req, res) => {
    const t = req.body?.theme;
    if (t !== "light" && t !== "dark" && t !== "system") {
      res.status(400).json({ error: "theme must be light, dark or system" });
      return;
    }
    setTheme(t);
    res.status(204).end();
  });

  // When the budget was last seeded from actuals, and whether a re-seed is
  // due (90 days). The seed stamps this itself; POST exists for the one-time
  // backfill and for a UI that seeds by another path.
  // Old Zelle rows named by the person in the note: off until the user turns it on.
  r.get("/settings/zelle-names", (_req, res) => res.json({ on: readService.getZelleMemoNames() }));
  r.post("/settings/zelle-names", (req, res) => {
    try {
      readService.setZelleMemoNames(req.body?.on);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  // The floor kept in the pot account.
  r.get("/settings/maaser-floor", (_req, res) => res.json({ floorCents: readService.getMaaserFloorCents() }));
  r.post("/settings/maaser-floor", (req, res) => {
    try {
      readService.setMaaserFloorCents(req.body?.floorCents);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  r.get("/settings/seed", (_req, res) => res.json(readService.getSeedStatus()));
  r.post("/settings/seed", (req, res) => {
    try {
      readService.setLastSeedAt(req.body?.lastSeedAt);
      res.json(readService.getSeedStatus());
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  // The salary readout's assumptions: premium and children (the pot's rate is saved with the pot).
  r.get("/settings/salary", (_req, res) => res.json(readService.getSalarySettings()));
  r.post("/settings/salary", (req, res) => {
    try {
      readService.setSalarySettings(req.body);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  // The user's current salary and the additional salary. Read back
  // through GET /settings/salary, beside the assumptions; saved here on their own.
  r.post("/settings/income", (req, res) => {
    try {
      readService.setIncomeSettings(req.body);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  r.get("/transactions", (_req, res) => res.json(readService.getTransactions()));

  r.get("/category-mappings", (_req, res) => res.json(readService.getCategoryMappings()));
  r.post("/category-mappings", (req, res) => {
    const { source, planning } = req.body as { source: string; planning: string };
    // A name the figures read (Paychecks, Charity, the saving and income names) stays itself.
    if (isLockedCategory(String(source ?? "")) && String(planning ?? "").trim().toLowerCase() !== String(source).trim().toLowerCase()) {
      res.status(400).json({ error: `${String(source).trim()} is one of the categories the app's figures read, so it cannot be filed under another name.` });
      return;
    }
    readService.setCategoryMapping(source, planning);
    res.status(204).end();
  });

  r.get("/plans", (_req, res) => res.json(readService.listPlans()));
  r.post("/plans", (req, res) => res.json(readService.createPlan(req.body)));
  r.get("/plans/:id", (req, res) => res.json(readService.getPlan(req.params.id)));
  r.get("/plans/:planId/budget-lines", (req, res) =>
    res.json(readService.getBudgetLines(req.params.planId))
  );

  r.post("/budget-lines", (req, res) => {
    readService.setBudgetLine(req.body);
    res.status(204).end();
  });

  r.delete("/budget-lines", (req, res) => {
    const { planId, planningCategory, period } = req.query as Record<string, string>;
    readService.deleteBudgetLine(planId, planningCategory, period ?? null);
    res.status(204).end();
  });

  // Budget changes, going back to suggested, big months and notes.
  const fail = (res: import("express").Response, e: unknown) =>
    void res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
  r.get("/plans/:planId/budget-extras", (req, res) => res.json(budgetChangeService().extras(req.params.planId)));
  r.post("/plans/:planId/lines/:line/change", (req, res) => {
    try { res.json(budgetChangeService().changeLine(req.params.planId, req.params.line, req.body ?? {})); } catch (e) { fail(res, e); }
  });
  r.post("/plans/:planId/lines/:line/reset", (req, res) => {
    try { res.json(budgetChangeService().resetLine(req.params.planId, req.params.line)); } catch (e) { fail(res, e); }
  });
  r.get("/plans/:planId/lines/:line/suggestion", (req, res) => {
    try { res.json(budgetChangeService().suggestion(req.params.planId, req.params.line)); } catch (e) { fail(res, e); }
  });
  r.post("/plans/:planId/big-months", (req, res) => {
    try { res.json(budgetChangeService().addBigMonth(req.params.planId, req.body ?? {})); } catch (e) { fail(res, e); }
  });
  r.put("/big-months/:id", (req, res) => {
    try { budgetChangeService().updateBigMonth(Number(req.params.id), req.body ?? {}); res.status(204).end(); } catch (e) { fail(res, e); }
  });
  r.delete("/big-months/:id", (req, res) => {
    try { budgetChangeService().deleteBigMonth(Number(req.params.id)); res.status(204).end(); } catch (e) { fail(res, e); }
  });
  r.put("/plans/:planId/month-notes", (req, res) => {
    try { budgetChangeService().setNote(req.params.planId, req.body ?? {}); res.status(204).end(); } catch (e) { fail(res, e); }
  });
  // Set up budget and next year's budget.
  r.get("/plans/:planId/setup", (req, res) => {
    try { res.json({ suggestions: setupService().suggestions(req.params.planId) }); } catch (e) { fail(res, e); }
  });
  r.post("/plans/:planId/apply-setup", (req, res) => {
    try { res.json(setupService().apply(req.params.planId, req.body ?? {})); } catch (e) { fail(res, e); }
  });
  r.post("/plans/next-year", (req, res) => {
    try { res.json(setupService().startNextYear(req.body ?? {})); } catch (e) { fail(res, e); }
  });

  r.post("/bootstrap-mappings", (_req, res) => res.json(readService.bootstrapMappings()));

  r.post("/plans/:id/seed-budget", (req, res) =>
    res.json(readService.seedBudget(req.params.id, Number(req.body?.windowMonths) || 3))
  );

  // Average monthly expense over the trailing N complete months (default 12).
  // Not under /plans: actuals are shared across plans.
  r.get("/trailing", (req, res) => {
    try {
      const months = req.query.months === undefined ? undefined : Number(req.query.months);
      res.json(readService.trailingSpend(months));
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  // Today's mortgage rate for the goal payment helper. A
  // failure is not the app's fault: the helper leaves the rate for the user to type.
  r.get("/mortgage-rates", async (_req, res) => {
    try {
      res.json(await getMortgageRates());
    } catch (e) {
      res.status(502).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  r.get("/goals", (_req, res) => res.json(readService.listGoals()));
  r.post("/goals", (req, res) => {
    try {
      readService.upsertGoal(req.body);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  r.delete("/goals/:id", (req, res) => {
    readService.deleteGoal(req.params.id);
    res.status(204).end();
  });
  // Mark complete / unmark, and Start this cost: one step.
  r.post("/goals/:id/state", (req, res) => {
    try {
      readService.setGoalState(req.params.id, req.body);
      res.status(204).end();
    } catch (e) {
      if (e instanceof readService.NotFound) return void res.status(404).json({ ok: false, error: e.message });
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  // Which accounts fund which goals (0018). Replace-all per goal.
  r.get("/goal-links", (_req, res) => res.json(readService.listGoalAccountLinks()));
  r.put("/goals/:id/links", (req, res) => {
    try {
      readService.replaceGoalAccountLinks(req.params.id, req.body);
      res.status(204).end();
    } catch (e) {
      const status = e instanceof readService.NotFound ? 404 : e instanceof readService.Conflict ? 409 : 400;
      res.status(status).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  r.get("/wishlist", (_req, res) => res.json(readService.listWishlistItems()));
  r.post("/wishlist", (req, res) => {
    readService.upsertWishlistItem(req.body);
    res.status(204).end();
  });
  r.put("/wishlist/order", (req, res) => {
    try {
      readService.reorderWishlist(req.body?.ids);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  r.delete("/wishlist/:id", (req, res) => {
    readService.deleteWishlistItem(req.params.id);
    res.status(204).end();
  });

  r.get("/account-balances", (_req, res) => res.json(readService.getAccountBalances()));
  r.get("/account-balance-readings", (_req, res) => res.json(readService.listBalanceReadings()));
  r.post("/account-balances", (req, res) => {
    readService.upsertAccountBalances(req.body);
    res.status(204).end();
  });

  r.get("/transaction-adjustments", (_req, res) => res.json(readService.getTransactionAdjustments()));
  r.post("/transaction-adjustments", (req, res) => {
    readService.addTransactionAdjustment(req.body);
    res.status(204).end();
  });

  r.delete("/transaction-adjustments/:id", (req, res) => {
    readService.deleteTransactionAdjustment(Number(req.params.id));
    res.status(204).end();
  });

  // Filing and Undo: one call per filing, see categorizationService.
  r.post("/categorizations", (req, res) => {
    const checked = validateFiling(req.body);
    if (typeof checked === "string") {
      res.status(400).json({ ok: false, error: checked });
      return;
    }
    try {
      res.json(categorizationService.fileCategorization(req.body));
    } catch {
      res.status(500).json({ ok: false, error: "The filing was not saved. Nothing changed." });
    }
  });
  r.get("/categorizations", (_req, res) => res.json(categorizationService.listRecentCategorizations()));
  r.post("/categorizations/:id/undo", (req, res) => {
    try {
      res.json(categorizationService.undoCategorization(Number(req.params.id)));
    } catch (e) {
      if (e instanceof categorizationService.NotFoundError) res.status(404).json({ ok: false, error: e.message });
      else res.status(500).json({ ok: false, error: "The undo did not finish. Nothing changed." });
    }
  });

  // Notes on transactions. An empty note deletes it.
  r.get("/transaction-notes", (_req, res) => res.json(readService.listTransactionNotes()));
  r.put("/transaction-notes/:id", (req, res) => {
    try {
      readService.saveTransactionNote(req.params.id, req.body?.note);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  // The two per-row maaser marks.
  r.get("/maaser-marks", (_req, res) => res.json(readService.listMaaserMarks()));
  r.put("/maaser-marks/:id", (req, res) => {
    try {
      readService.saveMaaserMark(req.params.id, req.body);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  r.delete("/maaser-marks/:id", (req, res) => {
    try {
      readService.deleteMaaserMark(req.params.id);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  r.get("/plans/:planId/scenarios", (req, res) =>
    res.json(readService.listScenarios(req.params.planId))
  );
  r.get("/scenarios/:id", (req, res) => res.json(readService.getScenario(req.params.id)));
  r.post("/scenarios", (req, res) => {
    readService.upsertScenario(req.body);
    res.status(204).end();
  });
  r.delete("/scenarios/:id", (req, res) => {
    readService.deleteScenario(req.params.id);
    res.status(204).end();
  });

  // What-ifs: a base salary, ordered changes, goal picks.
  r.get("/plans/:planId/what-ifs", (req, res) => res.json(readService.listWhatIfs(req.params.planId)));
  // One step: the New button's scenario row and its
  // empty what-if, written together so a failure between two requests can
  // never leave an empty scenarios row behind.
  r.post("/plans/:planId/what-ifs", (req, res) => {
    try {
      res.status(201).json(readService.createWhatIf(req.params.planId, req.body?.id, req.body?.name));
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  r.get("/scenarios/:id/what-if", (req, res) => {
    try {
      res.json(readService.getWhatIf(req.params.id));
    } catch (e) {
      const status = e instanceof readService.NotFound ? 404 : 400;
      res.status(status).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  r.put("/scenarios/:id/what-if", (req, res) => {
    try {
      readService.saveWhatIf(req.params.id, req.body);
      res.status(204).end();
    } catch (e) {
      const status = e instanceof readService.NotFound ? 404 : 400;
      res.status(status).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  r.get("/plans/:planId/budget-notes", (req, res) =>
    res.json(readService.listBudgetNotes(req.params.planId))
  );
  r.get("/plans/:planId/snapshots", (req, res) =>
    res.json(readService.listSnapshotHistory(req.params.planId))
  );
  r.get("/plans/:planId/data-quality-flags", (req, res) =>
    res.json(readService.listDataQualityFlags(req.params.planId))
  );

  // Category settings (recurring vs non-recurring + pinned budget lines).
  // The user's recurring choices: Not recurring, Mark as recurring, Show again.
  r.get("/recurring-choices", (_req, res) => res.json(readService.listRecurringChoices()));
  r.put("/recurring-choices", (req, res) => {
    try {
      readService.saveRecurringChoice(req.body);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  r.delete("/recurring-choices", (req, res) => {
    try {
      readService.deleteRecurringChoice(req.query.payeeKey, req.query.accountId, req.query.amountCents);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  // Merchants: the rename list and the dismissed suggestions.
  r.get("/merchant-renames", (_req, res) => res.json(readService.listMerchantRenames()));
  r.put("/merchant-renames", (req, res) => {
    try {
      readService.saveMerchantRename(req.body);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  r.delete("/merchant-renames", (req, res) => {
    try {
      readService.deleteMerchantRename(req.query.sourceName);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  r.get("/merchant-suggestion-dismissals", (_req, res) => res.json(readService.listSuggestionDismissals()));
  r.put("/merchant-suggestion-dismissals", (req, res) => {
    try {
      readService.dismissSuggestion(req.body);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });
  r.delete("/merchant-suggestion-dismissals", (req, res) => {
    try {
      readService.deleteSuggestionDismissal(req.query.id);
      res.status(204).end();
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e instanceof Error ? e.message : e) });
    }
  });

  r.get("/category-settings", (_req, res) => res.json(readService.getCategorySettings()));
  r.post("/category-settings", (req, res) => {
    readService.upsertCategorySetting(req.body);
    res.status(204).end();
  });
  r.post("/category-settings/:category/pinned", (req, res) => {
    readService.setCategoryPinned(req.params.category, !!req.body?.pinned);
    res.status(204).end();
  });
  r.post("/category-settings/:category/recurring", (req, res) => {
    const { recurring } = req.body as { recurring: boolean | null };
    readService.setCategoryRecurring(req.params.category, recurring);
    res.status(204).end();
  });

  return r;
}
