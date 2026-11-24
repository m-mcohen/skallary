// tests/server/recurring-choices.test.ts
// The user's recurring choices, stored in
// recurring_choices behind GET, PUT and DELETE /api/recurring-choices.
// Harness as tests/server/wishlist-order.test.ts: a temp LOCALAPPDATA, buildApp(), listen(0).
import { afterAll, beforeAll, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecurringChoice } from "../../src/domain/recurring-choices.js";

let server: Server;
let baseUrl: string;
const json = { "Content-Type": "application/json" };

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-recurring-choices-test-"));
  const { buildApp } = await import("../../server/app.js");
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

const put = (body: unknown) => fetch(`${baseUrl}/api/recurring-choices`, { method: "PUT", headers: json, body: JSON.stringify(body) });
const read = async () => (await (await fetch(`${baseUrl}/api/recurring-choices`)).json()) as RecurringChoice[];
const remove = (payeeKey: string, accountId: string) =>
  fetch(`${baseUrl}/api/recurring-choices?${new URLSearchParams({ payeeKey, accountId })}`, { method: "DELETE" });

const insurance = { payeeKey: "example insurance", accountId: "acct-0303", choice: "recurring", cadence: "monthly", label: "Example Insurance", amountCents: null };

test("nothing is stored at first", async () => {
  expect(await read()).toEqual([]);
});

test("a choice is saved and read back, with the time it was made", async () => {
  expect((await put(insurance)).status).toBe(204);
  const [saved] = await read();
  expect({ ...saved, createdAt: "x" }).toEqual({ ...insurance, createdAt: "x" });
  expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false);
});

test("saving again for the same merchant and account replaces it, and Not recurring carries no rhythm", async () => {
  expect((await put({ ...insurance, choice: "not_recurring", cadence: "monthly" })).status).toBe(204);
  const rows = await read();
  expect(rows).toHaveLength(1);
  expect(rows[0].choice).toBe("not_recurring");
  expect(rows[0].cadence).toBeNull();
});

test("bad input is refused in plain words and nothing is written", async () => {
  const before = await read();
  for (const [body, error] of [
    [{ ...insurance, cadence: "fortnightly" }, "Pick how often it repeats."],
    [{ ...insurance, payeeKey: "" }, "This charge has no merchant name, so it cannot be recurring."],
    [{ ...insurance, choice: "maybe" }, "Unknown choice."],
  ] as const) {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(error);
  }
  expect(await read()).toEqual(before);
});

test("Show again deletes the choice; deleting one that is not there changes nothing", async () => {
  expect((await remove("example insurance", "acct-0303")).status).toBe(204);
  expect(await read()).toEqual([]);
  expect((await remove("example insurance", "acct-0303")).status).toBe(204);
});

test("a mark may carry an amount: one merchant holds several, and Show again with the amount removes just that one ", async () => {
  const landlord = { payeeKey: "zelle transfer to sample landlord", accountId: "acct-chk", choice: "recurring", cadence: "monthly" };
  expect((await put({ ...landlord, label: "Sample rent", amountCents: 90000 })).status).toBe(204);
  expect((await put({ ...landlord, label: "Sample wifi", amountCents: 3000 })).status).toBe(204);
  expect((await put({ ...landlord, label: "Sample, all of it" })).status).toBe(204);
  const rows = (await read()).filter((c) => c.payeeKey === landlord.payeeKey);
  expect(rows.map((c) => [c.label, c.amountCents]).sort()).toEqual([["Sample rent", 90000], ["Sample wifi", 3000], ["Sample, all of it", null]].sort());
  expect((await put({ ...landlord, label: "Sample wifi", amountCents: 12.5 })).status).toBe(400);
  const res = await fetch(`${baseUrl}/api/recurring-choices?${new URLSearchParams({ payeeKey: landlord.payeeKey, accountId: landlord.accountId, amountCents: "3000" })}`, { method: "DELETE" });
  expect(res.status).toBe(204);
  expect((await read()).filter((c) => c.payeeKey === landlord.payeeKey).map((c) => c.amountCents).sort()).toEqual([90000, null].sort());
  expect((await remove(landlord.payeeKey, landlord.accountId)).status).toBe(204);
  expect((await read()).filter((c) => c.payeeKey === landlord.payeeKey).map((c) => c.amountCents)).toEqual([90000]);
});
