// tests/domain/repeat-state.test.ts
// "This repeats" in the category picker, and what ticking or unticking it changes.
import { expect, test } from "vitest";
import { recurringChange, repeatStateFor, type RepeatState } from "../../src/domain/repeat-state";
import type { RecurringSeries } from "../../src/domain/recurring";
import type { NormalizedTxn } from "../../src/domain/types";

const row = (id: string, date: string): NormalizedTxn => ({
  sourceTransactionId: id, accountId: "a1", date, amountCents: -1599,
  sourceCategory: "Streaming", merchant: "Netflix", payee: "Netflix", isTransfer: false, sourceUpdatedAt: null,
});
const history = [row("n1", "2026-07-03"), row("n2", "2026-08-03"), row("n3", "2026-09-03")];

test("money coming in is never offered This repeats", () => {
  const pay = { ...row("p", "2026-09-30"), amountCents: 500000 };
  expect(repeatStateFor(pay, "Payroll", { prepared: [pay], mapping: {}, series: [], choices: [] })).toBeNull();
});

test("a transfer is never offered This repeats", () => {
  const moved = { ...row("x", "2026-09-30"), isTransfer: true };
  expect(repeatStateFor(moved, "Netflix", { prepared: [moved], mapping: {}, series: [], choices: [] })).toBeNull();
});

test("an unmarked merchant guesses how often from its dates on that account", () => {
  const s = repeatStateFor(history[2], "Netflix", { prepared: history, mapping: {}, series: [], choices: [] });
  expect(s).toEqual({ payeeKey: "netflix", accountId: "a1", label: "Netflix", current: null, source: null, guess: "monthly", amountCents: 1599, markAmountCents: null });
});

test("a merchant the app found reads as found; one you marked reads as yours", () => {
  const series = [{ key: "netflix", accountIds: ["a1"], cadence: "monthly" } as unknown as RecurringSeries];
  const found = repeatStateFor(history[2], "Netflix", { prepared: history, mapping: {}, series, choices: [] });
  expect(found).toMatchObject({ current: "monthly", source: "found" });
  const choices = [{ payeeKey: "netflix", accountId: "a1", choice: "recurring" as const, cadence: "monthly" as const, label: "Netflix", createdAt: "x" }];
  expect(repeatStateFor(history[2], "Netflix", { prepared: history, mapping: {}, series, choices })).toMatchObject({ source: "mine" });
});

const found: RepeatState = { payeeKey: "netflix", accountId: "a1", label: "Netflix", current: "monthly", source: "found", guess: "monthly" };
const mine: RepeatState = { ...found, source: "mine" };
const none: RepeatState = { ...found, current: null, source: null };

test("recurringChange: ticking an unmarked merchant marks it", () => {
  expect(recurringChange(none, true, "monthly")).toEqual({
    action: "save",
    choice: { payeeKey: "netflix", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Netflix" },
  });
});

test("recurringChange: leaving it as it was changes nothing", () => {
  expect(recurringChange(found, true, "monthly")).toBeUndefined();
  expect(recurringChange(none, false, "monthly")).toBeUndefined();
  expect(recurringChange(null, true, "monthly")).toBeUndefined();
});

test("recurringChange: a new rhythm is saved", () => {
  expect(recurringChange(found, true, "annual")).toMatchObject({ action: "save", choice: { choice: "recurring", cadence: "annual" } });
});

test("recurringChange: unticking your own mark removes it; unticking one the app found says Not recurring", () => {
  expect(recurringChange(mine, false, "monthly")).toEqual({ action: "remove", payeeKey: "netflix", accountId: "a1" });
  expect(recurringChange(found, false, "monthly")).toEqual({
    action: "save",
    choice: { payeeKey: "netflix", accountId: "a1", choice: "not_recurring", cadence: null, label: "Netflix" },
  });
});

test("an amount mark reads as yours for the charges near its amount only, and ticking Only this amount saves the amount", () => {
  const series = [{ key: "netflix", accountIds: ["a1"], cadence: "monthly", markAmountCents: 1599 } as unknown as RecurringSeries];
  const choices = [{ payeeKey: "netflix", accountId: "a1", choice: "recurring" as const, cadence: "monthly" as const, label: "Netflix", amountCents: 1599, createdAt: "x" }];
  const s = repeatStateFor(history[2], "Netflix", { prepared: history, mapping: {}, series, choices })!;
  expect(s).toMatchObject({ current: "monthly", source: "mine", amountCents: 1599, markAmountCents: 1599 });
  const other = { ...history[2], sourceTransactionId: "big", amountCents: -9900 };
  expect(repeatStateFor(other, "Netflix", { prepared: [...history, other], mapping: {}, series, choices })).toMatchObject({ current: null, source: null, markAmountCents: null });
  expect(recurringChange({ ...s, current: null, source: null, markAmountCents: null }, true, "monthly", true)).toEqual({
    action: "save",
    choice: { payeeKey: "netflix", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Netflix", amountCents: 1599 },
  });
  expect((recurringChange({ ...s, current: null, source: null, markAmountCents: null }, true, "monthly", false)?.choice as { amountCents?: number | null }).amountCents ?? null).toBeNull();
  expect(recurringChange(s, true, "monthly", true)).toBeUndefined();
  expect(recurringChange(s, false, "monthly", true)).toEqual({ action: "remove", payeeKey: "netflix", accountId: "a1", amountCents: 1599 });
});
