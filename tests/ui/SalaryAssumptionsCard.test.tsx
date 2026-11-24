// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import SalaryAssumptionsCard from "../../src/ui/SalaryAssumptionsCard";
import type { Db } from "../../src/ui/lib/db";
import type { SalaryAssumptions } from "../../src/domain/salary";
import { demoSalary } from "../demo";

afterEach(cleanup);

// The premium moved to Current salary, typed a paycheck, and the charity percent to the Charity
// card, so this card loads and saves the tax profile only: filing status and children, together.
test("loads the saved tax profile, saves a change, and says what is estimated", async () => {
  const stored: SalaryAssumptions = { ...demoSalary(), tax: { filingStatus: "single", children: 1 } };
  const setTaxProfile = vi.fn(async () => {});
  const dataLayer = { loadDb: async () => ({}) as Db, getSalarySettings: async () => stored, setTaxProfile };
  const onChanged = vi.fn();
  const { findByLabelText, getByText } = render(<SalaryAssumptionsCard dataLayer={dataLayer} onChanged={onChanged} />);
  const count = (await findByLabelText("Number of children")) as HTMLInputElement;
  await waitFor(() => expect(count.value).toBe("1"));
  expect((await findByLabelText("Filing status") as HTMLSelectElement).value).toBe("single");
  fireEvent.change(count, { target: { value: "2" } });
  fireEvent.change(await findByLabelText("Filing status"), { target: { value: "hoh" } });
  fireEvent.click(getByText("Save"));
  await waitFor(() => expect(setTaxProfile).toHaveBeenCalledWith({ filingStatus: "hoh", children: 2 }));
  expect(onChanged).toHaveBeenCalled();
  getByText(/State and local taxes are not estimated/);
});

test("a non-numeric child count is caught before the data layer, plain message, no save", async () => {
  const setTaxProfile = vi.fn(async () => {});
  const dataLayer = { loadDb: async () => ({}) as Db, getSalarySettings: async () => ({ ...demoSalary(), tax: { filingStatus: "mfj" as const, children: 1 } }), setTaxProfile };
  const onChanged = vi.fn();
  const { findByLabelText, getByText, findByText } = render(<SalaryAssumptionsCard dataLayer={dataLayer} onChanged={onChanged} />);
  fireEvent.change(await findByLabelText("Number of children"), { target: { value: "two" } });
  fireEvent.click(getByText("Save"));
  await findByText("Enter the number of children as a whole number.");
  expect(setTaxProfile).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
});
