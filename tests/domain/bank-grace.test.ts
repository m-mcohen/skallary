import { expect, test } from "vitest";
import { bankProblems } from "../../src/domain/bank-problems";

test("a bank given grace waits its own days, matched by name ignoring case and spaces; others wait the usual days", () => {
  const accounts = [
    { institution: " Lakeshore Example Credit Union ", balanceDate: "2026-03-10", archived: false },
    { institution: "Harbor Example Bank", balanceDate: "2026-03-10", archived: false },
  ];
  const p = bankProblems({ errors: [], accounts, today: "2026-03-20", graceDays: { "lakeshore example credit union": 30 } });
  expect(p.filter((x) => x.kind === "quiet").map((x) => x.bank)).toEqual(["Harbor Example Bank"]);
});
