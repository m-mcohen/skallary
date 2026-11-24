import { expect, test } from "vitest";
import { browserCommands } from "../../server/launch";
import { cleanLaunchBrowser } from "../../src/domain/setup-progress";

test("the browser setting picks the first browser tried, and a profile flag only when one is set", () => {
  expect(browserCommands({ browser: "chrome", profile: null }, "http://localhost:1")[0]).toEqual({ command: "cmd", args: ["/c", "start", "", "chrome", "--app=http://localhost:1"] });
  expect(browserCommands({ browser: "edge", profile: "Work" }, "u")[0].args).toContain("--profile-directory=Work");
  // Edge is started by its registered name through `start`, as the launcher script does, never by a bare spawn.
  expect(browserCommands({ browser: "edge", profile: null }, "u")[0]).toEqual({ command: "cmd", args: ["/c", "start", "", "msedge", "--app=u"] });
  expect(browserCommands(null, "u").some((c) => c.args.some((a) => a.startsWith("--profile-directory")))).toBe(false);
});

test("a saved profile is the first command only; the fallbacks and the default browser carry none", () => {
  const cmds = browserCommands({ browser: "edge", profile: "Work" }, "u");
  expect(cmds.slice(1).some((c) => c.args.some((a) => a.startsWith("--profile-directory")))).toBe(false);
  expect(browserCommands({ browser: "default", profile: "Work" }, "u")).toEqual([{ command: "cmd", args: ["/c", "start", "", "u"] }]);
});

test("a profile that could carry a command is refused when saved and never reaches the command line", () => {
  expect(typeof cleanLaunchBrowser({ browser: "edge", profile: "x&calc" })).toBe("string");
  expect(cleanLaunchBrowser({ browser: "edge", profile: "Profile 1" })).toEqual({ browser: "edge", profile: "Profile 1" });
  const cmds = browserCommands({ browser: "edge", profile: "x&calc" }, "u");
  expect(cmds.flatMap((c) => c.args).some((a) => a.includes("calc"))).toBe(false);
});
