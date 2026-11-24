// @vitest-environment jsdom
// tests/ui/MaaserMarkCell.test.tsx -- the two per-row charity marks on the Transactions screen.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MaaserMarkCell from "../../src/ui/transactions/MaaserMarkCell";
import type { MaaserMark } from "../../src/domain/maaser-marks";

afterEach(cleanup);

const giftMark: MaaserMark = { sourceTransactionId: "g", kind: "not_maaser", countedCents: null, updatedAt: "" };

describe("a gift row", () => {
  test("the switch is on with no mark; off saves not counted; on again removes the mark", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});
    const { rerender } = render(<MaaserMarkCell role="gift" mark={null} amountCents={-60000} onSave={onSave} />);
    const sw = screen.getByRole("switch", { name: "Counts toward Charity" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await user.click(sw);
    expect(onSave).toHaveBeenLastCalledWith({ kind: "not_maaser", countedCents: null });
    rerender(<MaaserMarkCell role="gift" mark={giftMark} amountCents={-60000} onSave={onSave} />);
    expect(screen.getByText("Not counted")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Counts toward Charity" }).getAttribute("aria-checked")).toBe("false");
    await user.click(screen.getByRole("switch", { name: "Counts toward Charity" }));
    expect(onSave).toHaveBeenLastCalledWith(null);
  });
});

describe("an income row", () => {
  test("none saves a mark with no amount; part saves the dollars typed as cents; all removes the mark", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});
    render(<MaaserMarkCell role="income" mark={null} amountCents={200000} onSave={onSave} />);
    await user.click(screen.getByRole("combobox", { name: "Income for Charity" }));
    await user.click(await screen.findByRole("option", { name: "None" }));
    expect(onSave).toHaveBeenLastCalledWith({ kind: "income", countedCents: null });
    await user.click(screen.getByRole("combobox", { name: "Income for Charity" }));
    await user.click(await screen.findByRole("option", { name: "Part" }));
    await user.type(screen.getByRole("textbox", { name: "Part that counts" }), "1600");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({ kind: "income", countedCents: 160000 });
    await user.click(screen.getByRole("combobox", { name: "Income for Charity" }));
    await user.click(await screen.findByRole("option", { name: "All" }));
    expect(onSave).toHaveBeenLastCalledWith(null);
  });

  test("a part above the row's amount, or not a number, is refused in words and saves nothing", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});
    render(<MaaserMarkCell role="income" mark={{ sourceTransactionId: "i", kind: "income", countedCents: 160000, updatedAt: "" }} amountCents={200000} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Change the part that counts" }));
    const box = screen.getByRole("textbox", { name: "Part that counts" });
    await user.clear(box);
    await user.type(box, "16000");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The part that counts can be at most the row's amount.");
    await user.clear(box);
    await user.type(box, "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((screen.getByRole("alert")).textContent).toContain("Enter the part that counts, in dollars.");
    expect(onSave).not.toHaveBeenCalled();
  });

  test("a marked row shows its tag; a save error shows in plain words", async () => {
    const user = userEvent.setup();
    render(
      <MaaserMarkCell
        role="income"
        mark={{ sourceTransactionId: "i", kind: "income", countedCents: 160000, updatedAt: "" }}
        amountCents={200000}
        onSave={vi.fn(async () => {
          throw new Error("Could not save the mark (500).");
        })}
      />,
    );
    expect(screen.getByText("Counts $1,600.00")).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "Income for Charity" }));
    await user.click(await screen.findByRole("option", { name: "None" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not save the mark (500).");
  });
});

describe("the Part entry does not grow the grid row", () => {
  test("choosing Part opens a small box with the dollar field and Save, outside the row's own cell", async () => {
    const user = userEvent.setup();
    const { container } = render(<MaaserMarkCell role="income" mark={null} amountCents={200000} onSave={vi.fn(async () => {})} />);
    await user.click(screen.getByRole("combobox", { name: "Income for Charity" }));
    await user.click(await screen.findByRole("option", { name: "Part" }));
    const box = screen.getByRole("textbox", { name: "Part that counts" });
    expect(screen.getByRole("dialog").contains(box)).toBe(true);
    expect(container.contains(box)).toBe(false);
  });
});
