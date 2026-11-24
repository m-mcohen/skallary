import { expect, test } from "vitest";
import { monthsBetween } from "../../src/domain/period";

// One month range for the Forecast, the what-ifs and the runway (Outstanding 24: the same
// month stepping was written out in several files).
test("lists every month from start to end, both included, across a year line", () => {
  expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
});

test("one month when start and end are the same; none when end is earlier", () => {
  expect(monthsBetween("2026-01", "2026-01")).toEqual(["2026-01"]);
  expect(monthsBetween("2026-03", "2026-02")).toEqual([]);
});
