// server/api/settingsRoutes.ts -- the household settings routes.
// Mounted from routes.ts with one line; each route is a thin binding to settingsService.
import { Router, type Response } from "express";
import {
  getHousehold, setHousehold, getIncludePartnerAccounts, setIncludePartnerAccounts,
  getCharityPotStored, setCharityPotStored, getTaxProfile, setTaxProfile,
  getStarterFiling, setStarterFiling, getLifestyleGroupsStored, setLifestyleGroups,
  getBankGraceDays, setBankGraceDays, getLaunchBrowser, setLaunchBrowser,
  getSetupProgress, setSetupStep,
} from "../services/settingsService.js";
import { applyStarterFiling } from "../services/starterService.js";
import { setupService } from "../services/setupService.js";
import { setupTokenPath } from "../services/connectorService.js";
import { isSampleInstance, SAMPLE_NO_BANK } from "../instance.js";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { openAppWindow } from "../launch.js";
import { PORT } from "../security.js";
import { isSetupStepId, isSetupStepState } from "../../src/domain/setup-progress.js";

/** A refused value: 400 with the plain message; the setter has written nothing. */
function refuse(res: Response, e: unknown): void {
  res.status(400).json({ error: String(e instanceof Error ? e.message : e) });
}

export function settingsRoutes(): Router {
  const r = Router();

  /** GET returns the stored value; PUT checks the body, saves it, and returns what was saved. */
  function getPut(path: string, get: () => unknown, set: (body: unknown) => void): void {
    r.get(path, (_req, res) => res.json(get()));
    r.put(path, (req, res) => {
      try {
        set(req.body);
        res.status(200).json(get());
      } catch (e) {
        refuse(res, e);
      }
    });
  }

  getPut("/settings/household", getHousehold, setHousehold);

  r.get("/settings/include-partner", (_req, res) => res.json({ includePartner: getIncludePartnerAccounts() }));
  r.post("/settings/include-partner", (req, res) => {
    const on = req.body?.includePartner;
    if (typeof on !== "boolean") {
      res.status(400).json({ error: "Counting your partner's accounts is either on or off." });
      return;
    }
    setIncludePartnerAccounts(on);
    res.status(204).end();
  });

  getPut("/settings/charity-pot", getCharityPotStored, setCharityPotStored);
  getPut("/settings/tax", getTaxProfile, setTaxProfile);
  // express.json() takes only objects and lists, so the choice travels as { filing }.
  getPut(
    "/settings/starter-filing",
    () => ({ filing: getStarterFiling() }),
    (body) => setStarterFiling((body as { filing?: unknown } | undefined)?.filing),
  );
  // The filing step: adds the standard categories and the chosen starter rules, and saves the choice.
  r.post("/setup/starter", (req, res) => {
    try {
      res.status(200).json(applyStarterFiling(req.body?.choice, req.body?.ruleIds));
    } catch (e) {
      refuse(res, e);
    }
  });
  getPut("/settings/lifestyle-groups", getLifestyleGroupsStored, setLifestyleGroups);
  getPut("/settings/bank-grace", getBankGraceDays, setBankGraceDays);
  getPut("/settings/launch-browser", getLaunchBrowser, setLaunchBrowser);

  // The launcher asks the running app to open its own window in the saved browser (reads the setting each time).
  r.post("/open-window", (req, res) => {
    openAppWindow(req.socket.localPort ?? PORT, getLaunchBrowser());
    res.status(204).end();
  });

  r.get("/settings/setup-progress", (_req, res) => res.json(getSetupProgress()));
  r.put("/settings/setup-progress/:step", (req, res) => {
    const step = req.params.step;
    const state = req.body?.state;
    if (!isSetupStepId(step)) {
      res.status(400).json({ error: "That is not a set-up step." });
      return;
    }
    if (!isSetupStepState(state)) {
      res.status(400).json({ error: "A step is either done or skipped." });
      return;
    }
    setSetupStep(step, state);
    res.status(200).json(getSetupProgress());
  });

  // The interview's last step: this year's budget (made once) and the finish time.
  r.post("/setup/finish", (_req, res) => {
    try {
      res.status(200).json(setupService().finishSetup());
    } catch (e) {
      refuse(res, e);
    }
  });

  // The banks step: opens the folder the setup token is read from, so the
  // person can save it there. Only that folder, only on Windows, never on sample data.
  r.post("/setup/open-token-folder", (_req, res) => {
    if (isSampleInstance()) {
      res.status(403).json({ error: SAMPLE_NO_BANK });
      return;
    }
    if (process.platform !== "win32") {
      res.status(400).json({ error: "Opening the folder works on Windows only. The path is shown on this screen." });
      return;
    }
    const folder = dirname(setupTokenPath());
    try {
      mkdirSync(folder, { recursive: true });
      const child = spawn("explorer.exe", [folder], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      res.status(204).end();
    } catch (e) {
      refuse(res, e);
    }
  });

  return r;
}
