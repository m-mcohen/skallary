// tests/server/wishlist-order.test.ts
// PUT /api/wishlist/order saves the whole Wish List order at once.
// Harness as tests/server/what-if.test.ts: a temp LOCALAPPDATA, buildApp(), listen(0).
import { afterAll, beforeAll, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WishlistItem } from "../../src/domain/plan-types.js";

let server: Server;
let baseUrl: string;
const json = { "Content-Type": "application/json" };

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-wish-order-test-"));
  const { buildApp } = await import("../../server/app.js");
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const [id, p] of [["a", 2], ["b", 3], ["c", 4]] as const) {
    const w: WishlistItem = { id, name: id, costCents: 100, kind: "wish", targetDate: null, priority: p, planningCategory: null };
    expect((await fetch(`${baseUrl}/api/wishlist`, { method: "POST", headers: json, body: JSON.stringify(w) })).status).toBe(204);
  }
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

const order = (ids: unknown) => fetch(`${baseUrl}/api/wishlist/order`, { method: "PUT", headers: json, body: JSON.stringify({ ids }) });
const read = async () => ((await (await fetch(`${baseUrl}/api/wishlist`)).json()) as WishlistItem[]).map((w) => [w.id, w.priority]);

test("the new order is saved and read back, numbered from 1", async () => {
  expect((await order(["b", "c", "a"])).status).toBe(204);
  expect(await read()).toEqual([["b", 1], ["c", 2], ["a", 3]]);
});

test("an order that leaves an item out, repeats one, or names a stranger is refused in plain words", async () => {
  const before = await read();
  for (const ids of [["b", "c"], ["b", "c", "c"], ["b", "c", "zzz"], "b,c,a"]) {
    const res = await order(ids);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("The Wish List changed since this screen loaded. Reload and try again.");
  }
  expect(await read()).toEqual(before);
});
