import { afterAll, beforeAll, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildApp } from "../../server/app.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

test("GET /api/health returns { ok: true }", async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
