// @vitest-environment jsdom
// tests/ui/CategoryPicker.test.tsx
//
// The one control for choosing a category: type to filter, or add
// a new category. It never writes; it tells the host what was chosen and
// whether it is new.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CategoryPicker, { TRANSFER_CHOICE, matchCategory } from "../../src/ui/CategoryPicker";

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

const categories = ["Groceries", "Rent", "Restaurants & Bars", "Gifts"];
const options = () => screen.queryAllByRole("option").map((o) => o.textContent);

describe("matchCategory", () => {
  test("finds the exact category ignoring case and spaces, and nothing for a partial", () => {
    expect(matchCategory(categories, "groceries")).toBe("Groceries");
    expect(matchCategory(categories, "  RENT ")).toBe("Rent");
    expect(matchCategory(categories, "Groc")).toBeNull();
    expect(matchCategory(categories, "")).toBeNull();
  });
});

describe("CategoryPicker", () => {
  test("typing filters the list; the match is picked with created false", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<CategoryPicker categories={categories} label="Category" onPick={onPick} />);
    const box = screen.getByRole("combobox", { name: "Category" });
    await user.type(box, "re");
    await waitFor(() => expect(options()).toEqual(["Rent", "Restaurants & Bars", 'Create "re"']));
    await user.click(screen.getByRole("option", { name: "Rent" }));
    expect(onPick).toHaveBeenCalledWith("Rent", { created: false });
  });

  test("a name that matches no category can be created; an exact match, in any case, cannot", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<CategoryPicker categories={categories} label="Category" onPick={onPick} />);
    const box = screen.getByRole("combobox", { name: "Category" });
    await user.type(box, "Kids");
    await waitFor(() => expect(options()).toEqual(['Create "Kids"']));
    await user.click(screen.getByRole("option", { name: 'Create "Kids"' }));
    expect(onPick).toHaveBeenCalledWith("Kids", { created: true });

    cleanup();
    const again = vi.fn();
    render(<CategoryPicker categories={categories} label="Category" onPick={again} />);
    await user.type(screen.getByRole("combobox", { name: "Category" }), "groceries");
    await waitFor(() => expect(options()).toEqual(["Groceries"]));
    expect(options().some((o) => o?.startsWith("Create"))).toBe(false);
  });

  test("Enter picks the match that starts with the typed text, and creates when no name starts with it", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<CategoryPicker categories={categories} label="Category" onPick={onPick} />);
    const box = screen.getByRole("combobox", { name: "Category" });
    await user.type(box, "gif{Enter}");
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("Gifts", { created: false }));

    cleanup();
    const create = vi.fn();
    render(<CategoryPicker categories={categories} label="Category" onPick={create} />);
    await user.type(screen.getByRole("combobox", { name: "Category" }), "Pets{Enter}");
    await waitFor(() => expect(create).toHaveBeenCalledWith("Pets", { created: true }));

    // "ent" is inside Rent but starts no name: the Create row comes first, Rent is one arrow away.
    cleanup();
    const inside = vi.fn();
    render(<CategoryPicker categories={categories} label="Category" onPick={inside} />);
    await user.type(screen.getByRole("combobox", { name: "Category" }), "ent");
    await waitFor(() => expect(options()).toEqual(['Create "ent"', "Rent"]));
  });

  test("an exact name comes first even when a longer name also contains it", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<CategoryPicker categories={["Renter's Insurance", "Rent"]} label="Category" onPick={onPick} />);
    await user.type(screen.getByRole("combobox", { name: "Category" }), "rent");
    await waitFor(() => expect(options()).toEqual(["Rent", "Renter's Insurance"]));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("Rent", { created: false }));
  });

  test("after a pick the box shows what was picked, and typing again reports the change", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onInputChange = vi.fn();
    render(<CategoryPicker categories={categories} label="Category" onPick={onPick} onInputChange={onInputChange} />);
    const box = screen.getByRole("combobox", { name: "Category" }) as HTMLInputElement;
    await user.type(box, "gro");
    await user.click(await screen.findByRole("option", { name: "Groceries" }));
    await waitFor(() => expect(box.value).toBe("Groceries"));
    await user.type(box, "x");
    await waitFor(() => expect(box.value).toBe("Groceriesx"));
    expect(onInputChange).toHaveBeenLastCalledWith("Groceriesx");
  });

  test("a created name stays in the box too", async () => {
    const user = userEvent.setup();
    render(<CategoryPicker categories={categories} label="Category" onPick={vi.fn()} />);
    const box = screen.getByRole("combobox", { name: "Category" }) as HTMLInputElement;
    await user.type(box, "Kids");
    await user.click(await screen.findByRole("option", { name: 'Create "Kids"' }));
    await waitFor(() => expect(box.value).toBe("Kids"));
  });

  test("blank or space-only text never offers Create", async () => {
    const user = userEvent.setup();
    render(<CategoryPicker categories={categories} label="Category" onPick={vi.fn()} />);
    const box = screen.getByRole("combobox", { name: "Category" });
    await user.type(box, "   ");
    await waitFor(() => expect(options()).toEqual(categories));
  });

  test("the transfer choice is offered only when asked for, and creation can be switched off", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<CategoryPicker categories={categories} label="Category" allowTransfer onPick={onPick} />);
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await waitFor(() => expect(options()).toEqual([...categories, "Transfer (not spending)"]));
    await user.click(screen.getByRole("option", { name: "Transfer (not spending)" }));
    expect(onPick).toHaveBeenCalledWith(TRANSFER_CHOICE, { created: false });

    cleanup();
    render(<CategoryPicker categories={categories} label="Category" allowCreate={false} onPick={vi.fn()} />);
    await user.type(screen.getByRole("combobox", { name: "Category" }), "Nothing here");
    await waitFor(() => expect(screen.getByText("No category matches. Keep typing to add one.")).toBeTruthy());
    expect(options()).toEqual([]);
  });

  test("a pick is never reported as a cancel, and a later Escape still is", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onCancel = vi.fn();
    render(<CategoryPicker categories={categories} label="Category" autoFocus onPick={onPick} onCancel={onCancel} />);
    await user.click(await screen.findByRole("option", { name: "Rent" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    // Open again (the box still reads "Rent", so the list is filtered to it) and leave without choosing.
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await screen.findByRole("option", { name: "Rent" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  test("Escape closes with nothing chosen and tells the host", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onCancel = vi.fn();
    render(<CategoryPicker categories={categories} label="Category" autoFocus onPick={onPick} onCancel={onCancel} />);
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("CategoryPicker footer", () => {
  test("a footer renders inside the list, and using it does not close the list or count as a pick", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onCancel = vi.fn();
    render(
      <CategoryPicker
        categories={categories}
        label="Category"
        autoFocus
        onPick={onPick}
        onCancel={onCancel}
        footer={<label><input type="checkbox" /> and everything like it</label>}
      />
    );
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    const box = screen.getByLabelText(/everything like it/i) as HTMLInputElement;
    await user.click(box);
    expect(box.checked).toBe(true);
    expect(options().length).toBeGreaterThan(0);
    expect(onCancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("option", { name: "Rent" }));
    expect(onPick).toHaveBeenCalledWith("Rent", { created: false });
  });
});
