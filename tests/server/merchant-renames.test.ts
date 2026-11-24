// tests/server/merchant-renames.test.ts
// The rename list and the dismissed suggestions behind
// GET, PUT and DELETE /api/merchant-renames and /api/merchant-suggestion-dismissals.
// Harness as tests/server/recurring-choices.test.ts: a temp LOCALAPPDATA, buildApp(), listen(0).
import { afterAll, beforeAll, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MerchantRename, SuggestionDismissal } from "../../src/domain/merchants.js";

let server: Server;
let baseUrl: string;
const json = { "Content-Type": "application/json" };

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-merchant-renames-test-"));
  const { buildApp } = await import("../../server/app.js");
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

const putRename = (body: unknown) => fetch(`${baseUrl}/api/merchant-renames`, { method: "PUT", headers: json, body: JSON.stringify(body) });
const renames = async () => (await (await fetch(`${baseUrl}/api/merchant-renames`)).json()) as MerchantRename[];
const removeRename = (sourceName: string) =>
  fetch(`${baseUrl}/api/merchant-renames?${new URLSearchParams({ sourceName })}`, { method: "DELETE" });
const putDismissal = (body: unknown) =>
  fetch(`${baseUrl}/api/merchant-suggestion-dismissals`, { method: "PUT", headers: json, body: JSON.stringify(body) });
const dismissals = async () => (await (await fetch(`${baseUrl}/api/merchant-suggestion-dismissals`)).json()) as SuggestionDismissal[];
const removeDismissal = (id: string) =>
  fetch(`${baseUrl}/api/merchant-suggestion-dismissals?${new URLSearchParams({ id })}`, { method: "DELETE" });

test("nothing is stored at first", async () => {
  expect(await renames()).toEqual([]);
  expect(await dismissals()).toEqual([]);
});

test("a rename is saved trimmed, with the time it was made, and saving the same bank name again replaces it", async () => {
  expect((await putRename({ sourceName: " AMZN Mktp US ", displayName: " Amazon " })).status).toBe(204);
  const [saved] = await renames();
  expect({ ...saved, createdAt: "x" }).toEqual({ sourceName: "AMZN Mktp US", displayName: "Amazon", createdAt: "x" });
  expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false);
  expect((await putRename({ sourceName: "amzn mktp us", displayName: "Amazon.com" })).status).toBe(204);
  const rows = await renames();
  expect(rows).toHaveLength(1);
  expect(rows[0].displayName).toBe("Amazon.com");
});

test("a bad rename is refused in plain words and nothing is written", async () => {
  const before = await renames();
  for (const [body, error] of [
    [{ sourceName: "", displayName: "Amazon" }, "Pick the bank's name to rename."],
    [{ sourceName: "AMZN", displayName: "" }, "Type the name to show."],
  ] as const) {
    const res = await putRename(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(error);
  }
  expect(await renames()).toEqual(before);
});

test("removing a rename undoes it; removing one that is not there changes nothing", async () => {
  expect((await removeRename("AMZN MKTP US")).status).toBe(204);
  expect(await renames()).toEqual([]);
  expect((await removeRename("AMZN MKTP US")).status).toBe(204);
});

test("a dismissal is stored with its id worked out by the server, and Show again removes it", async () => {
  expect((await putDismissal({ kind: "same-letters", fromName: "NETFLIX", intoName: "Netflix" })).status).toBe(204);
  const [saved] = await dismissals();
  expect(saved.id).toBe("same-letters|NETFLIX|Netflix");
  expect(saved.fromName).toBe("NETFLIX");
  const bad = await putDismissal({ kind: "guess", fromName: "A", intoName: "B" });
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { error: string }).error).toBe("Unknown suggestion.");
  expect((await removeDismissal(saved.id)).status).toBe(204);
  expect(await dismissals()).toEqual([]);
});
