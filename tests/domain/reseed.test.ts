import { describe, it, expect } from "vitest";
import { RESEED_INTERVAL_DAYS, reseedDueAt, reseedDue } from "../../src/domain/reseed";

// The live seed of record, stamped from the owner's clock (EDT).
const SEEDED = "2026-09-02T14:07:00-04:00";

describe("reseedDueAt", () => {
  it("is null when the budget has never been seeded", () => {
    expect(reseedDueAt(null)).toBeNull();
  });

  it("is the calendar date 90 days after the seed, in UTC", () => {
    expect(RESEED_INTERVAL_DAYS).toBe(90);
    // 2026-09-02T18:07Z + 90 days = 2026-12-01.
    expect(reseedDueAt(SEEDED)).toBe("2026-12-01");
  });

  it("treats an unparseable stamp as never seeded rather than guessing a date", () => {
    expect(reseedDueAt("not a date")).toBeNull();
  });
});

describe("reseedDue", () => {
  it("is due when never seeded -- the nudge is how a fresh install learns to seed", () => {
    expect(reseedDue(null, Date.parse("2026-09-02T00:00:00Z"))).toBe(true);
  });

  it("is not due before the due date and due from the due date onward", () => {
    expect(reseedDue(SEEDED, Date.parse("2026-09-03T00:00:00Z"))).toBe(false);
    expect(reseedDue(SEEDED, Date.parse("2026-11-30T23:59:59Z"))).toBe(false);
    expect(reseedDue(SEEDED, Date.parse("2026-12-01T00:00:00Z"))).toBe(true);
    expect(reseedDue(SEEDED, Date.parse("2027-03-01T00:00:00Z"))).toBe(true);
  });

  it("agrees with reseedDueAt on the boundary, so the UI's date and flag never disagree", () => {
    const dueAt = reseedDueAt(SEEDED)!;
    expect(reseedDue(SEEDED, Date.parse(`${dueAt}T00:00:00Z`) - 1)).toBe(false);
    expect(reseedDue(SEEDED, Date.parse(`${dueAt}T00:00:00Z`))).toBe(true);
  });

  it("is due when the stamp is unparseable", () => {
    expect(reseedDue("garbage", Date.parse("2026-09-02T00:00:00Z"))).toBe(true);
  });
});
