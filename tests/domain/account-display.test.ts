process.env.TZ = "America/New_York";
import { expect, test } from "vitest";
import { accountTypeLabel, displayAccountName, formatSnapshotDate, plainFlagResolution, plainSnapshotNote } from "../../src/domain/account-display";

test("account types read as words", () => {
  expect(accountTypeLabel("depository")).toBe("Cash");
  expect(accountTypeLabel("credit")).toBe("Card");
  expect(accountTypeLabel("brokerage")).toBe("Brokerage");
  expect(accountTypeLabel(null)).toBe("No type");
  expect(accountTypeLabel("hsa")).toBe("hsa");
});

// Short names: the household's names dropped, two owners read
// "Joint", NFS and doubled spaces dropped, the doubled bracket fixed anywhere,
// and a name written all in capitals title-cased. Anything else as written.
test.each([
  ["JOINT CHECKING (0101)", "Joint Checking (0101)"],
  ["MC SAPPHIRE PREF (1234)", "MC Sapphire Pref (1234)"],
  ["PERSONAL CHECKING (0101)", "Personal Checking (0101)"],
  ["Alex Rivera - Brokerage Account (1234)", "Brokerage Account (1234)"],
  ["Alex Rivera - Roth IRA Brokerage Account (1234)", "Roth IRA Brokerage Account (1234)"],
  ["Alex Rivera, Sam Rivera - Cash Plus Account (1234)", "Joint Cash Plus Account (1234)"],
  ["Alex Rivera & Sam Rivera Joint w/Survivor NFS  UMA Program (1234))", "Joint UMA Program (1234)"],
  ["Alex Rivera IRA NFS  UMA Program (968))", "IRA UMA Program (968)"],
  ["Alex Rivera Roth IRA NFS  UMA Program (969))", "Roth IRA UMA Program (969)"],
  ["Lakeshore Cash Back Card (1234)", "Lakeshore Cash Back Card (1234)"],
  ["Card (969)) extra", "Card (969) extra"],
])("account %s shows as %s", (raw, shown) => {
  expect(displayAccountName(raw, ["Alex Rivera", "Sam Rivera"])).toBe(shown);
});

test("only the stored name drops: a first name alone leaves the next word", () => {
  expect(displayAccountName("Alex Roth IRA", ["Alex"])).toBe("Roth IRA");
});

test("a snapshot shows its local date, with no clock time", () => {
  // 02:33 UTC on Sep 22 is the evening of Sep 21 in New York.
  expect(formatSnapshotDate("2026-09-22T02:33:52.854Z")).toBe("Sep 21, 2026");
  expect(formatSnapshotDate("2026-08-12")).toBe("Aug 12, 2026");
});

test("a flag's stored resolution is shown as written", () => {
  expect(plainFlagResolution("flag-a", "Fixed in the app: the transfer no longer counts as income."))
    .toBe("Fixed in the app: the transfer no longer counts as income.");
  expect(plainFlagResolution("flag-b", null)).toBeNull();
});

test("snapshot notes read in plain words; a note typed by hand is kept as written", () => {
  expect(plainSnapshotNote("auto (post-sync)")).toBe("After a sync");
  expect(plainSnapshotNote("Ported from BUDGET_LOG (pre-app baseline)")).toBe("Starting point, before the app");
  expect(plainSnapshotNote("Before the move")).toBe("Before the move");
  expect(plainSnapshotNote(null)).toBe("");
});
