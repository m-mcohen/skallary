// @vitest-environment jsdom
// tests/ui/CharityPotSettings.test.tsx -- the charity card saves the percent as whole basis points,
// and refuses a percent it cannot read instead of saving 0. Values invented.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import CharityPotSettings from "../../src/ui/CharityPotSettings";
import type { CharityPotSetting } from "../../src/domain/charity-pot";
import type { Db } from "../../src/ui/lib/db";

afterEach(cleanup);

const stored: CharityPotSetting = {
  on: true, name: "Giving", kind: "percent", fixedCents: null, fixedFrom: null,
  counts: { me: true, partner: true, joint: true }, rateBps: 500,
};

function layer() {
  return {
    loadDb: async () => ({}) as Db,
    getPot: async () => stored,
    setPot: vi.fn(async () => {}),
    getFloor: async () => 0,
    setFloor: vi.fn(async () => {}),
    getHousehold: async () => ({ youName: "Alex", partnerName: "Sam" }),
  };
}

test("a percent typed with a decimal saves as whole basis points", async () => {
  const l = layer();
  const r = render(<CharityPotSettings dataLayer={l} />);
  const box = (await r.findByLabelText("Percent of pay into the bank")) as HTMLInputElement;
  await waitFor(() => expect(box.value).toBe("5"), { timeout: 5000 });
  fireEvent.change(box, { target: { value: "2.5" } });
  fireEvent.click(r.getByText("Save"));
  await waitFor(() => expect(l.setPot).toHaveBeenCalledWith({ ...stored, rateBps: 250 }), { timeout: 5000 });
});

test("a percent sign in the percent box is caught before the data layer, no save", async () => {
  const l = layer();
  const r = render(<CharityPotSettings dataLayer={l} />);
  const box = (await r.findByLabelText("Percent of pay into the bank")) as HTMLInputElement;
  await waitFor(() => expect(box.value).toBe("5"), { timeout: 5000 });
  fireEvent.change(box, { target: { value: "10%" } });
  fireEvent.click(r.getByText("Save"));
  await r.findByText("Type the share as a percent from 0 to 100, like 5 or 2.5.", undefined, { timeout: 5000 });
  expect(l.setPot).not.toHaveBeenCalled();
});
