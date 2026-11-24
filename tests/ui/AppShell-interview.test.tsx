// @vitest-environment jsdom
// tests/ui/AppShell-interview.test.tsx -- the first-run gate (design 5.3, items 17 and 41). With
// no household the interview is all there is; its only required step is the names; every other
// step skips; the end makes this year's budget and opens the app on Set up budget. A household
// whose interview is finished (the owner's, the sample's) never sees it.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppShell from "../../src/ui/shell/AppShell";
import { SETUP_REGISTRY } from "../../src/ui/setup/steps";
import { SETUP_STEPS } from "../../src/domain/setup-progress";
import { demoHousehold } from "../demo";
import { version } from "../../package.json";

// The steps' own screens read their settings through many routes; stand-ins keep this test on the flow.
vi.mock("../../src/ui/CurrentSalaryCard", () => ({ default: () => null }));
vi.mock("../../src/ui/CharityPotSettings", () => ({ default: () => null }));
vi.mock("../../src/ui/ConnectorSection", () => ({ default: () => null }));
vi.mock("../../src/ui/AccountsSection", () => ({ default: () => null }));

let household: unknown;
let progress: Record<string, string>;
let calls: { method: string; url: string; body: unknown }[];

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

beforeEach(() => {
  window.location.hash = "";
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  household = null;
  progress = {};
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url === "/api/settings/household") {
      if (method === "PUT") household = body;
      return json(household);
    }
    if (url === "/api/settings/include-partner") return method === "POST" ? new Response(null, { status: 204 }) : json({ includePartner: true });
    if (url === "/api/settings/setup-progress") return json(progress);
    const step = url.match(/^\/api\/settings\/setup-progress\/(\w+)$/);
    if (step) {
      progress = { ...progress, [step[1]]: (body as { state: string }).state };
      return json(progress);
    }
    if (url === "/api/holiday-calendars") return json([{ id: "us-national", name: "US national holidays", source: "us-national", on: false, importedAt: null, coversThrough: null }]);
    if (url === "/api/settings/tax") return json({ filingStatus: null, children: null });
    if (url === "/api/setup/starter") return json({ categoriesAdded: 3, rulesAdded: 0 });
    if (url === "/api/setup/finish") {
      progress = { ...progress, finishedAt: "2026-03-10T12:00:00.000Z" };
      return json({ planId: "plan-2026", created: true });
    }
    return json({ error: "not in this test" }, 500);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

test("the registry holds every step, holidays included, in interview order, and only the household is required", () => {
  expect(SETUP_REGISTRY.map((s) => s.id)).toEqual([...SETUP_STEPS]);
  expect(SETUP_REGISTRY.filter((s) => s.required).map((s) => s.id)).toEqual(["household"]);
});

test("with no household the interview is all there is; after the last step the app opens on Set up budget", async () => {
  const user = userEvent.setup();
  render(<AppShell />);
  await user.type(await screen.findByLabelText(/your name/i), demoHousehold().youName);
  expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
  // The household step is required: no skip.
  expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
  await user.click(screen.getByRole("button", { name: /next/i }));

  for (const title of ["How you are paid", "Your tax estimate", "Charity", "Holidays", "Link your banks", "Your accounts", "How to start filing"]) {
    await screen.findByRole("heading", { name: title });
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
  }
  await user.click(await screen.findByRole("button", { name: /make this year's budget/i }));

  expect(await screen.findByRole("link", { name: "Dashboard" })).toBeTruthy();
  expect(window.location.hash).toBe("#/budget/month?setup=1");
  expect(household).toEqual({ youName: demoHousehold().youName, partnerName: null });
  expect(progress).toMatchObject({ household: "done", pay: "skipped", tax: "skipped", charity: "skipped", holidays: "skipped", banks: "skipped", accounts: "skipped", filing: "skipped" });
  // Skipping the filing step is choice b: the standard categories are still added.
  expect(calls.find((c) => c.url === "/api/setup/starter")?.body).toEqual({ choice: "categories-only" });
  expect(calls.filter((c) => c.url === "/api/setup/finish")).toHaveLength(1);
});

test("a household whose interview is finished opens straight into the app", async () => {
  household = demoHousehold();
  progress = { ...Object.fromEntries(SETUP_STEPS.map((s) => [s, "done"])), finishedAt: "2026-01-02T00:00:00.000Z" };
  render(<AppShell />);
  expect(await screen.findByRole("link", { name: "Dashboard" })).toBeTruthy();
  expect(screen.queryByLabelText(/your name/i)).toBeNull();
});

test("a household that stopped part way picks up at its next unanswered step", async () => {
  household = demoHousehold();
  progress = { household: "done", pay: "skipped" };
  render(<AppShell />);
  expect(await screen.findByRole("heading", { name: "Your tax estimate" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
});

test("a set-up link opens one step, and finishing it goes back to Settings, Household", async () => {
  const user = userEvent.setup();
  household = demoHousehold();
  progress = { ...Object.fromEntries(SETUP_STEPS.map((s) => [s, "done"])), tax: "skipped", finishedAt: "2026-01-02T00:00:00.000Z" };
  window.location.hash = "#/setup/tax";
  render(<AppShell />);
  await screen.findByRole("heading", { name: "Your tax estimate" });
  await user.click(screen.getByRole("button", { name: "Skip for now" }));
  await waitFor(() => expect(window.location.hash).toBe("#/settings/household"));
  expect(await screen.findByRole("link", { name: "Dashboard" })).toBeTruthy();
  expect(calls.some((c) => c.url === "/api/setup/finish")).toBe(false);
});

test("the About tab shows the app name, version, and source link", async () => {
  household = demoHousehold();
  progress = { ...Object.fromEntries(SETUP_STEPS.map((s) => [s, "done"])), finishedAt: "2026-01-02T00:00:00.000Z" };
  window.location.hash = "#/settings/about";
  render(<AppShell />);

  expect(await screen.findByRole("heading", { name: "Skallary" })).toBeTruthy();
  expect(screen.getByText(`Version ${version}`)).toBeTruthy();
  const source = screen.getByRole("link", { name: "See the source code" });
  expect(source.getAttribute("href")).toBe("https://github.com/m-mcohen/skallary");
  expect(source.getAttribute("target")).toBe("_blank");
});
