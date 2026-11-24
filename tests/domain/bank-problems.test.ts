// tests/domain/bank-problems.test.ts
//
// Two kinds of bank problem, one list, each bank once:
//   sign-in: the Bridge said con.auth for that connection (a connection asking again).
//   quiet:   no error at all, but the bank's newest balance date is more than 3 days
//            old (a card with nothing new, and SimpleFIN said nothing).
import { describe, expect, it } from "vitest";
import {
  QUIET_AFTER_DAYS,
  bankProblems,
  bankProblemShort,
  bankProblemStep,
  banksNeedYou,
  BRIDGE_URL,
} from "../../src/domain/bank-problems";

const TODAY = "2026-10-05";

const acct = (institution: string | null, balanceDate: string | null, archived = false) => ({
  institution, balanceDate, archived,
});
const signIn = (name: string) => ({
  code: "con.auth", message: `Connection to ${name} may need attention. Auth required`, connectionName: null,
});

describe("bankProblems: a quiet bank", () => {
  it("waits more than 3 days: 3 days old is not flagged, 4 days old is", () => {
    expect(QUIET_AFTER_DAYS).toBe(3);
    // 2026-10-05 less 3 days is 2026-10-02; less 4 days is 2026-10-01.
    expect(bankProblems({ errors: [], accounts: [acct("Pinecrest Example Bank", "2026-10-02")], today: TODAY, graceDays: {} })).toEqual([]);
    expect(bankProblems({ errors: [], accounts: [acct("Pinecrest Example Bank", "2026-10-01")], today: TODAY, graceDays: {} })).toEqual([
      { kind: "quiet", bank: "Pinecrest Example Bank", lastDataDate: "2026-10-01" },
    ]);
  });

  it("counts calendar days across a month end", () => {
    // Sep 30 to Oct 3 is 3 days; Sep 29 to Oct 3 is 4.
    expect(bankProblems({ errors: [], accounts: [acct("A", "2026-09-30")], today: "2026-10-03", graceDays: {} })).toEqual([]);
    expect(bankProblems({ errors: [], accounts: [acct("A", "2026-09-29")], today: "2026-10-03", graceDays: {} })).toHaveLength(1);
  });

  it("groups by bank and goes by the bank's NEWEST balance date", () => {
    // Ridgeline has one old account and one fresh one: the bank is still sending data.
    const accounts = [
      acct("Ridgeline", "2026-09-01"),
      acct("Ridgeline", "2026-10-05"),
      acct("Lakeshore Card Services", "2026-09-22"),
      acct("Lakeshore Card Services", "2026-09-20"),
    ];
    expect(bankProblems({ errors: [], accounts, today: TODAY, graceDays: {} })).toEqual([
      { kind: "quiet", bank: "Lakeshore Card Services", lastDataDate: "2026-09-22" },
    ]);
  });

  it("skips archived accounts and accounts with no balance date", () => {
    const accounts = [
      acct("Pinecrest", "2026-08-01", true), // a superseded record, archived
      acct("Cedar Pay", null), // never had a balance from the feed
      acct("Pinecrest Example Bank", "2026-10-05"),
    ];
    expect(bankProblems({ errors: [], accounts, today: TODAY, graceDays: {} })).toEqual([]);
  });

  it("an archived account cannot make a live bank look fresh", () => {
    const accounts = [acct("Cedar Example Card", "2026-10-05", true), acct("Cedar Example Card", "2026-09-25")];
    expect(bankProblems({ errors: [], accounts, today: TODAY, graceDays: {} })).toEqual([
      { kind: "quiet", bank: "Cedar Example Card", lastDataDate: "2026-09-25" },
    ]);
  });

  it("lists the oldest first", () => {
    const accounts = [acct("B", "2026-09-28"), acct("A", "2026-09-20")];
    expect(bankProblems({ errors: [], accounts, today: TODAY, graceDays: {} }).map((p) => p.bank)).toEqual(["A", "B"]);
  });
});

describe("bankProblems: a sign-in", () => {
  it("lists each connection the Bridge says needs a sign-in, once, with its last data date", () => {
    const accounts = [acct("Ridgeline Example Investments", "2026-10-03"), acct("Ridgeline Example Investments", "2026-10-02")];
    expect(bankProblems({ errors: [signIn("Ridgeline Example Investments"), signIn("Ridgeline Example Investments")], accounts, today: TODAY, graceDays: {} })).toEqual([
      { kind: "sign-in", bank: "Ridgeline Example Investments", lastDataDate: "2026-10-03" },
    ]);
  });

  it("ignores other warnings: they are not a sign-in", () => {
    const errors = [{ code: "act.failed", message: "bank timeout", connectionName: "Pinecrest" }];
    expect(bankProblems({ errors, accounts: [acct("Pinecrest", "2026-10-05")], today: TODAY, graceDays: {} })).toEqual([]);
  });

  it("a bank that is both is listed once, as sign-in, with its last data date", () => {
    const accounts = [acct("Ridgeline Example Investments", "2026-09-20"), acct("Lakeshore Card Services", "2026-09-22")];
    expect(bankProblems({ errors: [signIn("Ridgeline Example Investments")], accounts, today: TODAY, graceDays: {} })).toEqual([
      { kind: "sign-in", bank: "Ridgeline Example Investments", lastDataDate: "2026-09-20" },
      { kind: "quiet", bank: "Lakeshore Card Services", lastDataDate: "2026-09-22" },
    ]);
  });

  it("matches the connection to the bank without minding case or spaces", () => {
    const accounts = [acct("Ridgeline Example Investments", "2026-09-20")];
    const errors = [{ code: "con.auth", message: "Auth required", connectionName: " ridgeline example investments " }];
    expect(bankProblems({ errors, accounts, today: TODAY, graceDays: {} })).toEqual([
      { kind: "sign-in", bank: "ridgeline example investments", lastDataDate: "2026-09-20" },
    ]);
  });

  it("a sign-in for a bank with no dated account still shows, with no date", () => {
    expect(bankProblems({ errors: [signIn("Lakeshore Example Credit Union")], accounts: [], today: TODAY, graceDays: {} })).toEqual([
      { kind: "sign-in", bank: "Lakeshore Example Credit Union", lastDataDate: null },
    ]);
  });

  it("nothing wrong, nothing listed", () => {
    expect(bankProblems({ errors: [], accounts: [acct("Pinecrest Example Bank", "2026-10-05")], today: TODAY, graceDays: {} })).toEqual([]);
  });
});

// A bank given its own grace (the saved list, matched by name) is named only once it has sent
// nothing new for more than that many days, whether it asked for a sign-in or went quiet.
// Every other bank keeps the 3-day rule.
describe("bankProblems: a bank given grace", () => {
  const NOV = "2026-11-19";
  const GRACE = { "lakeshore example credit union": 30 };
  const LAKE = "Lakeshore Example Credit Union";

  it("a sign-in with data 30 days old is not named; 31 days old is", () => {
    // 2026-11-19 less 30 days is 2026-10-20; less 31 is 2026-10-19.
    expect(bankProblems({ errors: [signIn(LAKE)], accounts: [acct(LAKE, "2026-10-20")], today: NOV, graceDays: GRACE })).toEqual([]);
    expect(bankProblems({ errors: [signIn(LAKE)], accounts: [acct(LAKE, "2026-10-19")], today: NOV, graceDays: GRACE })).toEqual([
      { kind: "sign-in", bank: LAKE, lastDataDate: "2026-10-19" },
    ]);
  });

  it("quiet with no error: 30 days is not named, 31 is", () => {
    expect(bankProblems({ errors: [], accounts: [acct(LAKE, "2026-10-20")], today: NOV, graceDays: GRACE })).toEqual([]);
    expect(bankProblems({ errors: [], accounts: [acct(LAKE, "2026-10-19")], today: NOV, graceDays: GRACE })).toEqual([
      { kind: "quiet", bank: LAKE, lastDataDate: "2026-10-19" },
    ]);
  });

  it("with no grace saved, the same bank is named by the usual 3-day rule", () => {
    expect(bankProblems({ errors: [], accounts: [acct(LAKE, "2026-11-08")], today: NOV, graceDays: {} })).toHaveLength(1);
  });

  it("matches the connection to the grace without minding case or spaces", () => {
    const errors = [{ code: "con.auth", message: "Auth required", connectionName: " LAKESHORE EXAMPLE CREDIT UNION " }];
    expect(bankProblems({ errors, accounts: [acct("lakeshore example credit union ", "2026-11-08")], today: NOV, graceDays: GRACE })).toEqual([]);
  });

  it("other banks keep the 3-day rule beside it", () => {
    expect(bankProblems({ errors: [], accounts: [acct(LAKE, "2026-11-08"), acct("Pinecrest Example Bank", "2026-11-15")], today: NOV, graceDays: GRACE })).toEqual([
      { kind: "quiet", bank: "Pinecrest Example Bank", lastDataDate: "2026-11-15" },
    ]);
  });
});

describe("the words", () => {
  it("say what is wrong in plain words, with the date", () => {
    expect(bankProblemShort({ kind: "sign-in", bank: "Lakeshore Example Credit Union", lastDataDate: "2026-10-03" }, TODAY))
      .toBe("Lakeshore Example Credit Union needs a sign-in (no new data since Oct 3)");
    expect(bankProblemShort({ kind: "sign-in", bank: "Lakeshore Example Credit Union", lastDataDate: null }, TODAY))
      .toBe("Lakeshore Example Credit Union needs a sign-in");
    expect(bankProblemShort({ kind: "quiet", bank: "Lakeshore Card", lastDataDate: "2026-09-22" }, TODAY))
      .toBe("No new data from Lakeshore Card since Sep 22");
  });

  it("say what to do", () => {
    expect(bankProblemStep({ kind: "sign-in", bank: "Lakeshore Example Credit Union", lastDataDate: null }))
      .toBe("Sign in to Lakeshore Example Credit Union on the SimpleFIN Bridge site.");
    expect(bankProblemStep({ kind: "quiet", bank: "Lakeshore Card", lastDataDate: "2026-09-22" }))
      .toBe("Check its sign-in on the SimpleFIN Bridge site.");
  });

  it("count banks, not problems", () => {
    expect(banksNeedYou(1)).toBe("1 bank needs you");
    expect(banksNeedYou(2)).toBe("2 banks need you");
  });

  it("point at the Bridge", () => {
    expect(BRIDGE_URL).toBe("https://beta-bridge.simplefin.org/auth/login");
  });
});
