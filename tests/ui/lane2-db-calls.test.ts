// tests/ui/lane2-db-calls.test.ts
// The client calls for notes, filing and Undo. A refused write
// throws the server's own words, so the screen can show them.
import { afterEach, expect, test, vi } from "vitest";
import {
  fileCategorizationUI,
  getRecentCategorizationsUI,
  getTransactionNotesUI,
  saveTransactionNoteUI,
  undoCategorizationUI,
} from "../../src/ui/lib/db";

const db = { base: "/api" } as never;
const reply = (status: number, body?: unknown) =>
  ({ ok: status < 300, status, json: async () => body }) as unknown as Response;

afterEach(() => vi.unstubAllGlobals());

test("filing posts once and returns the log id", async () => {
  const fetchMock = vi.fn(async () => reply(200, { id: 41 }));
  vi.stubGlobal("fetch", fetchMock);
  const filing = { sourceTransactionId: "t1", label: "Shell", fromCategory: "Fuel", toCategory: "Gas", rule: null, adjustment: null };
  expect(await fileCategorizationUI(db, filing)).toEqual({ id: 41 });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/categorizations");
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual(filing);
});

test("a refused filing, note or undo throws the server's own words", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply(400, { ok: false, error: "Pick a category first." })));
  await expect(fileCategorizationUI(db, {} as never)).rejects.toThrow("Pick a category first.");
  await expect(saveTransactionNoteUI(db, "t1", "x")).rejects.toThrow("Pick a category first.");
  await expect(undoCategorizationUI(db, 3)).rejects.toThrow("Pick a category first.");
});

test("a note id with colons is sent encoded", async () => {
  const fetchMock = vi.fn(async () => reply(204));
  vi.stubGlobal("fetch", fetchMock);
  await saveTransactionNoteUI(db, "simplefin:ACT-1:TRN-2", "Paid back");
  expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/transaction-notes/simplefin%3AACT-1%3ATRN-2");
});

test("notes and the recent list read as empty before the server has the routes", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply(404)));
  expect(await getTransactionNotesUI(db)).toEqual([]);
  expect(await getRecentCategorizationsUI(db)).toEqual([]);
});
