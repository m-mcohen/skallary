// @vitest-environment jsdom
// tests/ui/MerchantSettings.test.tsx
//
// Suggestions can be accepted, dismissed, or shown again. Saved renames can also
// be added manually or removed after confirmation.
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MerchantSettings from "../../src/ui/MerchantSettings";
import type { NormalizedTxn } from "../../src/domain/types";
import type { MerchantRename, MerchantRenameInput, SuggestionDismissal } from "../../src/domain/merchants";

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

let seq = 0;
const t = (payee: string) =>
  ({ sourceTransactionId: `t${++seq}`, accountId: "a1", date: "2026-08-01", amountCents: -1000, sourceCategory: "Shopping", merchant: payee, payee, isTransfer: false, sourceUpdatedAt: null }) as NormalizedTxn;
const txns = [t("Netflix"), t("Netflix"), t("NETFLIX"), t("Amazon"), t("Amazon Prime"), t("Lakeshore Credit Card"), t("Lakeshore Credit Card Payment")];

function layer(initial: { renames?: MerchantRename[]; dismissals?: SuggestionDismissal[] } = {}) {
  let renames = [...(initial.renames ?? [])];
  let dismissals = [...(initial.dismissals ?? [])];
  const calls = { saved: [] as MerchantRenameInput[], removed: [] as string[], dismissed: [] as unknown[], shownAgain: [] as string[] };
  return {
    calls,
    loadDb: async () => ({ base: "" }),
    getTransactions: async () => txns,
    getMerchantRenames: async () => renames,
    saveMerchantRename: async (_db: unknown, r: MerchantRenameInput) => {
      calls.saved.push(r);
      renames = [...renames.filter((x) => x.sourceName.toLowerCase() !== r.sourceName.toLowerCase()), { ...r, createdAt: "2026-10-02T12:00:00.000Z" }];
    },
    deleteMerchantRename: async (_db: unknown, sourceName: string) => {
      calls.removed.push(sourceName);
      renames = renames.filter((x) => x.sourceName.toLowerCase() !== sourceName.toLowerCase());
    },
    getSuggestionDismissals: async () => dismissals,
    dismissSuggestion: async (_db: unknown, d: { kind: SuggestionDismissal["kind"]; fromName: string; intoName: string }) => {
      calls.dismissed.push(d);
      const id = `${d.kind}|${[d.fromName, d.intoName].sort().join("|")}`;
      dismissals = [...dismissals, { id, ...d, createdAt: "2026-10-02T12:00:00.000Z" }];
    },
    showSuggestionAgain: async (_db: unknown, id: string) => {
      calls.shownAgain.push(id);
      dismissals = dismissals.filter((d) => d.id !== id);
    },
  };
}

const suggestionRow = (from: string) => screen.getByTestId(`suggestion-${from}`);

describe("Suggested merges", () => {
  test("listed one pair at a time; nothing is saved until a button is pressed", async () => {
    const data = layer();
    render(<MerchantSettings dataLayer={data} />);
    await screen.findByTestId("suggestion-NETFLIX");
    expect(within(suggestionRow("NETFLIX")).getByText(/Netflix/)).toBeTruthy();
    expect(screen.getByTestId("suggestion-Lakeshore Credit Card Payment")).toBeTruthy();
    // Amazon and Amazon Prime are two different things.
    expect(screen.queryByTestId("suggestion-Amazon Prime")).toBeNull();
    expect(data.calls.saved).toEqual([]);
    expect(data.calls.dismissed).toEqual([]);
  });

  test("Accept writes one rename, from into, and the pair leaves the list and joins the renames", async () => {
    const data = layer();
    render(<MerchantSettings dataLayer={data} />);
    const user = userEvent.setup();
    await user.click(within(await screen.findByTestId("suggestion-NETFLIX")).getByRole("button", { name: /Accept/ }));
    expect(data.calls.saved).toEqual([{ sourceName: "NETFLIX", displayName: "Netflix" }]);
    await waitFor(() => expect(screen.queryByTestId("suggestion-NETFLIX")).toBeNull());
    expect(within(screen.getByTestId("rename-list")).getByText("NETFLIX")).toBeTruthy();
    // The other suggestion is untouched.
    expect(screen.getByTestId("suggestion-Lakeshore Credit Card Payment")).toBeTruthy();
  });

  test("Dismiss is stored, the pair leaves the list, and it stays gone on the next visit", async () => {
    const data = layer();
    render(<MerchantSettings dataLayer={data} />);
    const user = userEvent.setup();
    await user.click(within(await screen.findByTestId("suggestion-NETFLIX")).getByRole("button", { name: /Dismiss/ }));
    expect(data.calls.dismissed).toEqual([{ kind: "same-letters", fromName: "NETFLIX", intoName: "Netflix" }]);
    expect(data.calls.saved).toEqual([]);
    await waitFor(() => expect(screen.queryByTestId("suggestion-NETFLIX")).toBeNull());
    cleanup();
    render(<MerchantSettings dataLayer={data} />);
    await screen.findByTestId("suggestion-Lakeshore Credit Card Payment");
    expect(screen.queryByTestId("suggestion-NETFLIX")).toBeNull();
    // Listed under Dismissed, with Show again.
    const dismissed = screen.getByTestId("dismissed-list");
    await user.click(within(dismissed).getByRole("button", { name: /Show again/ }));
    expect(data.calls.shownAgain).toEqual(["same-letters|NETFLIX|Netflix"]);
    expect(await screen.findByTestId("suggestion-NETFLIX")).toBeTruthy();
  });
});

describe("Your renames", () => {
  const amazon: MerchantRename = { sourceName: "AMZN Mktp US", displayName: "Amazon", createdAt: "2026-10-01T12:00:00.000Z" };

  test("Remove asks first, then deletes; Cancel keeps it", async () => {
    const data = layer({ renames: [amazon] });
    render(<MerchantSettings dataLayer={data} />);
    const user = userEvent.setup();
    const list = await screen.findByTestId("rename-list");
    await user.click(within(list).getByRole("button", { name: "Remove AMZN Mktp US" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(data.calls.removed).toEqual([]);
    await user.click(within(list).getByRole("button", { name: "Remove AMZN Mktp US" }));
    await user.click(await screen.findByRole("button", { name: "Remove rename" }));
    expect(data.calls.removed).toEqual(["AMZN Mktp US"]);
    await waitFor(() => expect(within(screen.getByTestId("rename-list")).queryByText("AMZN Mktp US")).toBeNull());
  });

  test("a rename can be added by hand: pick a name, type what to show, Save", async () => {
    const data = layer();
    render(<MerchantSettings dataLayer={data} />);
    const user = userEvent.setup();
    const box = await screen.findByRole("combobox", { name: "Bank name" });
    await user.type(box, "Lakeshore Credit Card P");
    await user.click(await screen.findByRole("option", { name: "Lakeshore Credit Card Payment" }));
    await user.type(screen.getByRole("textbox", { name: "Show as" }), "Lakeshore");
    await user.click(screen.getByRole("button", { name: "Save rename" }));
    expect(data.calls.saved).toEqual([{ sourceName: "Lakeshore Credit Card Payment", displayName: "Lakeshore" }]);
  });
});
