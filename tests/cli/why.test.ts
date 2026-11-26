import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";

// The show runs only in a live terminal. Piped, as here, it prints the card in plain text.
function runCli(args: string[]): string {
  try {
    return execFileSync(process.execPath, ["--import", "tsx", "cli/finance.ts", ...args], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ""}${err.stderr ?? ""}`; // the help text goes to stderr

  }
}

test("why prints the plain card when not a terminal: the name in big letters, no explanation", () => {
  const out = runCli(["why"]);
  expect(out).toContain("████  █   █");
  expect(out).not.toContain("Why");
  expect(/\x1b\[/.test(out)).toBe(false);
});

test("why is not listed in the help", () => {
  const out = runCli([]);
  expect(out).toContain("finance accounts");
  expect(out).not.toMatch(/finance why|skallary why/);
});

test("the show fits a maximized terminal on a 1280 x 800 laptop (about 24 lines)", async () => {
  const { fitsShow } = await import("../../cli/why.js");
  expect(fitsShow(80, 22)).toBe(true);
  expect(fitsShow(91, 24)).toBe(true);
  expect(fitsShow(79, 30)).toBe(false);
  expect(fitsShow(120, 21)).toBe(false);
});
