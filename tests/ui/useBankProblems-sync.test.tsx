// @vitest-environment jsdom
// tests/ui/useBankProblems-sync.test.tsx
//
// If the start-up sync ran and brought every bank up to date, a banner that still
// says "banks need you" is wrong: the page had read the banks once, before the sync
// finished. So while a sync runs the banner says "Syncing", the page asks again,
// and once the sync is done it reloads once.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useBankProblems, type BankProblemsState } from "../../src/ui/lib/useBankProblems";
import BankProblemsBanner from "../../src/ui/shell/BankProblemsBanner";

const stale = (syncing: boolean): BankProblemsState => ({
  problems: [{ kind: "quiet", bank: "Pinecrest Example Bank", lastDataDate: "2026-03-05" }],
  lastSyncedAt: "2026-03-05T19:00:00.000Z",
  today: "2026-03-19",
  syncing,
});
const fresh: BankProblemsState = { problems: [], lastSyncedAt: "2026-03-20T01:00:00.000Z", today: "2026-03-19", syncing: false };

function Probe({ read, onDone }: { read: () => Promise<BankProblemsState>; onDone: () => void }) {
  const s = useBankProblems(read, onDone, 20);
  return (
    <>
      <input aria-label="draft" />
      <button type="button">Entire balance</button>
      {s ? <BankProblemsBanner problems={s.problems} lastSyncedAt={s.lastSyncedAt} today={s.today} syncing={s.syncing} refreshReady={s.refreshReady} onRefresh={onDone} /> : null}
    </>
  );
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const tick = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("the banner while the start-up sync runs", () => {
  test("says Syncing, not a red count, then reloads once the sync is done", async () => {
    const answers = [stale(true), stale(true), fresh, fresh];
    const read = vi.fn(async () => answers.shift() ?? fresh);
    const onDone = vi.fn();
    render(<Probe read={read} onDone={onDone} />);

    expect((await screen.findByTestId("bank-sync-running")).textContent).toMatch(/Syncing with your banks/);
    expect(screen.queryByTestId("bank-problems-banner")).toBeNull();
    expect(onDone).not.toHaveBeenCalled();

    await tick(120);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("bank-sync-running")).toBeNull();
    // It stops asking once the sync is done.
    const calls = read.mock.calls.length;
    await tick(100);
    expect(read.mock.calls.length).toBe(calls);
  });

  test("no sync running: no reload, no repeat reads, and real problems still show in red", async () => {
    const read = vi.fn(async () => stale(false));
    const onDone = vi.fn();
    render(<Probe read={read} onDone={onDone} />);
    expect((await screen.findByTestId("bank-problems-banner")).textContent).toMatch(/1 bank needs you/);
    await tick(100);
    expect(read).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  // A reload would throw away an unsaved edit.
  test("something typed during the sync: no reload; a Refresh button instead, which reloads when pressed", async () => {
    const answers = [stale(true), stale(true), fresh];
    const read = vi.fn(async () => answers.shift() ?? fresh);
    const onDone = vi.fn();
    render(<Probe read={read} onDone={onDone} />);
    await screen.findByTestId("bank-sync-running");
    fireEvent.input(screen.getByLabelText("draft"), { target: { value: "half a goal name" } });

    await tick(120);
    expect(onDone).not.toHaveBeenCalled();
    const done = screen.getByTestId("bank-sync-done");
    expect(done.textContent).toMatch(/Your banks are synced/);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // One dropped read used to end the wait for good.
  test("a failed read while the sync runs is tried again, and the reload still comes", async () => {
    let n = 0;
    const read = vi.fn(async () => {
      n += 1;
      if (n === 1) return stale(true);
      if (n === 2) throw new Error("server busy");
      return fresh;
    });
    const onDone = vi.fn();
    render(<Probe read={read} onDone={onDone} />);
    await screen.findByTestId("bank-sync-running");
    await tick(150);
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // A click-only edit (a toggle in a dialog) is unsaved work too.
  test("a click during the sync, with nothing typed, also gets the Refresh button, not a reload", async () => {
    const answers = [stale(true), fresh];
    const read = vi.fn(async () => answers.shift() ?? fresh);
    const onDone = vi.fn();
    render(<Probe read={read} onDone={onDone} />);
    await screen.findByTestId("bank-sync-running");
    fireEvent.click(screen.getByRole("button", { name: "Entire balance" }));
    await tick(80);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId("bank-sync-done")).toBeTruthy();
  });

  // Typing before the first status answer counts.
  test("typing before the first status answer arrives counts as using the page", async () => {
    let letFirstAnswer!: () => void;
    const first = new Promise<void>((r) => (letFirstAnswer = r));
    let n = 0;
    const read = vi.fn(async () => {
      n += 1;
      if (n === 1) { await first; return stale(true); }
      return fresh;
    });
    const onDone = vi.fn();
    render(<Probe read={read} onDone={onDone} />);
    fireEvent.input(screen.getByLabelText("draft"), { target: { value: "x" } });
    await act(async () => { letFirstAnswer(); });
    await tick(80);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId("bank-sync-done")).toBeTruthy();
  });
});
