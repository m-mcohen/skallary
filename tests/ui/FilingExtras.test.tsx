// @vitest-environment jsdom
// tests/ui/FilingExtras.test.tsx
// The Note box and "This repeats" inside the category picker's list.
// Enter belongs to the list (it files the highlighted category); in the Note box it must not.
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import CategoryPicker from "../../src/ui/CategoryPicker";
import FilingExtras from "../../src/ui/FilingExtras";
import type { RepeatState } from "../../src/domain/repeat-state";
import type { Cadence } from "../../src/domain/recurring";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = ResizeObserverStub;
});
afterEach(cleanup);

const netflix: RepeatState = { payeeKey: "netflix", accountId: "a1", label: "Netflix", current: null, source: null, guess: "annual" };

function Host({ onPick, repeat = netflix, showRepeat = true }: { onPick: (c: string) => void; repeat?: RepeatState | null; showRepeat?: boolean }) {
  const [note, setNote] = useState("");
  const [repeats, setRepeats] = useState(false);
  const [cadence, setCadence] = useState<Cadence>(repeat?.guess ?? "monthly");
  return (
    <CategoryPicker
      categories={["Gas", "Groceries"]}
      label="Category"
      autoFocus
      onPick={onPick}
      footer={
        <FilingExtras
          note={note}
          onNote={setNote}
          repeat={repeat}
          showRepeat={showRepeat}
          repeats={repeats}
          onRepeats={setRepeats}
          cadence={cadence}
          onCadence={setCadence}
        />
      }
    />
  );
}

test("typing a note and pressing Enter in it files nothing, and the list stays open", async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Host onPick={onPick} />);
  // A category is highlighted first, so Enter anywhere the list hears it would file it.
  await user.type(screen.getByRole("combobox", { name: "Category" }), "Ga");
  const box = await screen.findByRole("textbox", { name: "Note" });
  await user.click(box);
  await user.type(box, "Road trip");
  await user.keyboard("{ArrowDown}{Enter}");
  expect((box as HTMLInputElement).value).toBe("Road trip");
  expect(onPick).not.toHaveBeenCalled();
  expect(screen.getByRole("option", { name: "Gas" })).toBeTruthy();
});

test("This repeats shows How often only once ticked, preselected with the guess", async () => {
  const user = userEvent.setup();
  render(<Host onPick={vi.fn()} />);
  expect(screen.queryByRole("combobox", { name: "How often" })).toBeNull();
  await user.click(await screen.findByRole("checkbox", { name: "This repeats" }));
  expect((screen.getByRole("combobox", { name: "How often" }) as HTMLSelectElement).value).toBe("annual");
});

test("a row that could not be a bill shows no This repeats", async () => {
  render(<Host onPick={vi.fn()} repeat={null} />);
  await screen.findByRole("textbox", { name: "Note" });
  expect(screen.queryByRole("checkbox", { name: "This repeats" })).toBeNull();
});

test("while Transfer is the choice, This repeats is hidden", async () => {
  render(<Host onPick={vi.fn()} showRepeat={false} />);
  await screen.findByRole("textbox", { name: "Note" });
  expect(screen.queryByRole("checkbox", { name: "This repeats" })).toBeNull();
});

test("after typing a note, a category can still be picked", async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Host onPick={onPick} />);
  await user.type(await screen.findByRole("textbox", { name: "Note" }), "Split");
  await user.click(screen.getByRole("option", { name: "Gas" }));
  expect(onPick).toHaveBeenCalledWith("Gas", { created: false });
});
