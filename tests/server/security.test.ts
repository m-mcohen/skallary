import type { Request, Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { originGuard, resolvePort } from "../../server/security.js";

describe("resolvePort", () => {
  test("defaults to 4321 and honors FINANCE_PORT", () => {
    expect(resolvePort({})).toBe(4321);
    expect(resolvePort({ FINANCE_PORT: "4399" })).toBe(4399);
  });

  test("invalid and privileged ports fall back to the default", () => {
    for (const bad of ["", "abc", "0", "80", "70000", "43.5", "-4399"]) {
      expect(resolvePort({ FINANCE_PORT: bad })).toBe(4321);
    }
  });
});

const port = 4330;
const localHost = `127.0.0.1:${port}`;

function guard(method: string, headers: Request["headers"]) {
  const req = { method, headers, socket: { localPort: port } } as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn();
  originGuard(req, res as unknown as Response, next);
  return { status: res.status, next };
}

function expectForbidden(method: string, headers: Request["headers"]) {
  const { status, next } = guard(method, headers);
  expect(status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
}

test("every method requires a loopback Host on the listening port", () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]) {
    for (const host of [undefined, "example.invalid:4330", "localhost", "localhost:4321"]) {
      expectForbidden(method, { host });
    }
  }
});

test("writes with Origin require the matching HTTP loopback origin and port", () => {
  for (const origin of ["http://127.0.0.1", "http://localhost", "http://127.0.0.1:4321", "http://localhost:4330", "https://127.0.0.1:4330", "null"]) {
    expectForbidden("POST", { host: localHost, origin });
  }
  expect(guard("POST", { host: localHost, origin: `http://${localHost}` }).next).toHaveBeenCalledOnce();
});

test("cross-site browser reads and writes are refused even without Origin", () => {
  for (const method of ["GET", "POST"]) {
    expectForbidden(method, { host: localHost, "sec-fetch-site": "cross-site" });
  }
});

test("launcher probes and commands work without Origin on the listening port", () => {
  for (const host of [localHost, `localhost:${port}`]) {
    expect(guard("GET", { host }).next).toHaveBeenCalledOnce();
    expect(guard("POST", { host }).next).toHaveBeenCalledOnce();
  }
});

describe("Express app", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { buildApp } = await import("../../server/app.js");
    await new Promise<void>((resolve) => {
      server = buildApp().listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  test("serves the health probe on the actual listening port", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
