// tests/server/transaction-notes.test.ts
// Transaction notes can be read, saved, and deleted through the API.
// Harness as tests/server/recurring-choices.test.ts: a temp LOCALAPPDATA, buildApp(), listen(0).
import { afterAll, beforeAll, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: Server;
let baseUrl: string;
const json = { "Content-Type": "application/json" };

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-notes-test-"));
  const { buildApp } = await import("../../server/app.js");
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

const put = (id: string, body: unknown) =>
  fetch(`${baseUrl}/api/transaction-notes/${encodeURIComponent(id)}`, { method: "PUT", headers: json, body: JSON.stringify(body) });
const read = async () =>
  (await (await fetch(`${baseUrl}/api/transaction-notes`)).json()) as { sourceTransactionId: string; note: string }[];

test("a note is saved trimmed, with an id that has colons in it", async () => {
  expect((await put("simplefin:ACT-1:TRN-2", { note: "  Save the receipt  " })).status).toBe(204);
  expect((await read()).map((n) => [n.sourceTransactionId, n.note])).toEqual([["simplefin:ACT-1:TRN-2", "Save the receipt"]]);
});

test("an empty note deletes it", async () => {
  expect((await put("simplefin:ACT-1:TRN-2", { note: "" })).status).toBe(204);
  expect(await read()).toEqual([]);
});

test("a note that is too long or not text is refused in plain words and nothing is written", async () => {
  const long = await put("t9", { note: "x".repeat(1001) });
  expect(long.status).toBe(400);
  expect((await long.json()).error).toBe("A note can be at most 1,000 characters.");
  const notText = await put("t9", { note: 5 });
  expect(notText.status).toBe(400);
  expect((await notText.json()).error).toBe("A note must be text.");
  expect(await read()).toEqual([]);
});

test("exactly 1,000 characters is kept", async () => {
  expect((await put("t10", { note: "y".repeat(1000) })).status).toBe(204);
  expect((await read()).find((n) => n.sourceTransactionId === "t10")?.note).toHaveLength(1000);
});
