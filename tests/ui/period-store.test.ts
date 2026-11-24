// @vitest-environment jsdom
// tests/ui/period-store.test.ts
//
// The period the history screens share. Three promises: the link is the source
// of truth, only a period picked by hand is remembered, and a click-through
// ledger (which carries its own dates) never overwrites that memory.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  configurePeriodStore,
  getCompare,
  getPeriod,
  getReportCategories,
  pickCompare,
  pickReportCategories,
  periodQueryString,
  periodApplies,
  pickPeriod,
  subscribePeriod,
  syncPeriodFromHash,
} from "../../src/ui/lib/period-store";
import { customPeriod, resolvePeriod } from "../../src/domain/period";

const AS_OF = "2026-09-20";
const go = (hash: string) => {
  window.location.hash = hash;
  syncPeriodFromHash();
};

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
  configurePeriodStore({ asOf: () => AS_OF });
});
afterEach(() => vi.restoreAllMocks());

test("repeated reads return the same snapshot without notifying during render", () => {
  window.history.replaceState(null, "", "#/reports?period=ytd");
  const first = getPeriod();
  expect(getPeriod()).toBe(first);
  const heard = vi.fn();
  const stop = subscribePeriod(heard);
  try {
    window.history.replaceState(null, "", "#/transactions?ledger=1&from=2026-08-01&to=2026-08-31");
    const next = getPeriod();
    expect(next).toEqual(customPeriod("2026-08-01", "2026-08-31"));
    expect(getPeriod()).toBe(next);
    expect(heard).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

test("presets with identical dates still change the selected preset", () => {
  go("#/reports?period=this-quarter");
  const heard = vi.fn();
  const stop = subscribePeriod(heard);
  try {
    pickPeriod(resolvePeriod("last-3", AS_OF));
    expect(getPeriod()).toEqual({ preset: "last-3", from: "2026-07-01", to: "2026-09-20" });
    expect(heard).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

describe("reading the link", () => {
  test("with no period in the link, the default applies and is written into the link", () => {
    go("#/reports");
    expect(getPeriod()).toEqual(resolvePeriod("last-12", AS_OF));
    expect(window.location.hash).toBe("#/reports?period=last-12");
  });

  test("a preset in the link wins, and other keys such as the tab are left alone", () => {
    go("#/reports?tab=income&period=ytd");
    expect(getPeriod()).toEqual(resolvePeriod("ytd", AS_OF));
    expect(window.location.hash).toBe("#/reports?tab=income&period=ytd");
  });

  test("a typed range in the link wins", () => {
    go("#/accounts/networth?from=2026-02-10&to=2026-03-05");
    expect(getPeriod()).toEqual(customPeriod("2026-02-10", "2026-03-05"));
  });

  test("a malformed period falls back to the remembered one rather than a guess", () => {
    go("#/reports");
    pickPeriod(resolvePeriod("last-3", AS_OF));
    go("#/reports?period=fortnight");
    expect(getPeriod()).toEqual(resolvePeriod("last-3", AS_OF));
  });

  // Accounts is one page, and its net worth line takes the period.
  test("the period applies to Accounts, including an old tab link", () => {
    expect(periodApplies("accounts", null)).toBe(true);
    expect(periodApplies("accounts", "networth")).toBe(true);
    expect(periodApplies("accounts", "balances")).toBe(true);
    expect(periodApplies("reports", null)).toBe(true);
    expect(periodApplies("transactions", "needs-category")).toBe(true);
    expect(periodApplies("dashboard", null)).toBe(false);
  });

  test("Accounts reads the period a link carries", () => {
    go("#/reports?period=ytd");
    go("#/accounts?period=last-12");
    expect(getPeriod()).toEqual(resolvePeriod("last-12", AS_OF));
  });

  test("an old Net worth bookmark keeps its period (the screen moved under Accounts)", () => {
    go("#/networth?period=last-12");
    expect(getPeriod()).toEqual(resolvePeriod("last-12", AS_OF));
    expect(periodApplies("networth", null)).toBe(true);
  });

  test("a screen the period does not apply to leaves both the period and the link alone", () => {
    go("#/reports?period=ytd");
    go("#/runway");
    expect(getPeriod()).toEqual(resolvePeriod("ytd", AS_OF));
    expect(window.location.hash).toBe("#/runway");
  });
});

describe("picking a period by hand", () => {
  test("updates the period and the link, keeps the tab, and is remembered on the next screen", () => {
    go("#/reports?tab=cashflow");
    pickPeriod(resolvePeriod("last-month", AS_OF));
    expect(getPeriod()).toEqual(resolvePeriod("last-month", AS_OF));
    expect(window.location.hash).toBe("#/reports?tab=cashflow&period=last-month");

    go("#/accounts/networth"); // the sidebar link carries no period
    expect(getPeriod()).toEqual(resolvePeriod("last-month", AS_OF));
    expect(window.location.hash).toBe("#/accounts/networth?period=last-month");
  });

  test("a typed range replaces a preset in the link, and the other way round", () => {
    go("#/reports?period=ytd");
    pickPeriod(customPeriod("2026-02-10", "2026-03-05"));
    expect(window.location.hash).toBe("#/reports?from=2026-02-10&to=2026-03-05");
    pickPeriod(resolvePeriod("all", AS_OF));
    expect(window.location.hash).toBe("#/reports?period=all");
  });

  test("tells subscribers once per real change, and not at all when nothing changed", () => {
    go("#/reports?period=ytd");
    const heard = vi.fn();
    const stop = subscribePeriod(heard);
    pickPeriod(resolvePeriod("ytd", AS_OF));
    expect(heard).not.toHaveBeenCalled();
    pickPeriod(resolvePeriod("last-3", AS_OF));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  test("periodQueryString is what a Back link carries", () => {
    go("#/reports?period=last-3");
    expect(periodQueryString()).toBe("period=last-3");
    pickPeriod(customPeriod("2026-02-10", "2026-03-05"));
    expect(periodQueryString()).toBe("from=2026-02-10&to=2026-03-05");
  });
});

describe("a click-through ledger", () => {
  test("its dates become the period on screen but are NOT remembered", () => {
    go("#/reports");
    pickPeriod(resolvePeriod("last-3", AS_OF));

    go("#/transactions?ledger=1&label=Groceries&cat=Groceries&kind=expense&from=2026-08-01&to=2026-08-31&counted=1&back=%23%2Freports");
    expect(getPeriod()).toEqual(customPeriod("2026-08-01", "2026-08-31"));

    go("#/reports"); // by the sidebar, not Back
    expect(getPeriod()).toEqual(resolvePeriod("last-3", AS_OF));
  });

  test("a ledger with no dates means all dates, never the remembered period", () => {
    go("#/reports");
    pickPeriod(resolvePeriod("last-3", AS_OF));
    const ledger = "#/transactions?ledger=1&label=Groceries&cat=Groceries&kind=expense&counted=1&back=%23%2Freports";
    go(ledger);
    expect(getPeriod()).toEqual(resolvePeriod("all", AS_OF));
    // And the link is left exactly as built: writing a period into it would change what it means.
    expect(window.location.hash).toBe(ledger);
  });

  test("changing the period while on a ledger is a pick by hand: it is remembered, and the ledger follows", () => {
    go("#/transactions?ledger=1&label=Groceries&cat=Groceries&kind=expense&from=2026-08-01&to=2026-08-31&counted=1&back=%23%2Freports");
    pickPeriod(resolvePeriod("ytd", AS_OF));
    expect(getPeriod()).toEqual(resolvePeriod("ytd", AS_OF));
    const q = new URLSearchParams(window.location.hash.split("?")[1]);
    expect(q.get("ledger")).toBe("1");
    expect(q.get("cat")).toBe("Groceries");
    expect(q.get("period")).toBe("ytd");
    expect(q.get("from")).toBeNull();
    go("#/reports");
    expect(getPeriod()).toEqual(resolvePeriod("ytd", AS_OF));
  });
});

describe("local storage that misbehaves", () => {
  test("hand picks stay in memory across screens when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    go("#/reports");
    pickPeriod(resolvePeriod("last-3", AS_OF));
    pickCompare("avg-3");
    go("#/transactions?ledger=1&from=2026-08-01&to=2026-08-31");
    go("#/reports");
    expect(getPeriod()).toEqual({ preset: "last-3", from: "2026-07-01", to: "2026-09-20" });
    expect(getCompare()).toBe("avg-3");
  });

  test("junk in storage falls back to the default", () => {
    window.localStorage.setItem("financial-future.period", "{not json");
    configurePeriodStore({ asOf: () => AS_OF });
    go("#/reports");
    expect(getPeriod()).toEqual(resolvePeriod("last-12", AS_OF));
  });

  test("storage that throws does not take the screen down", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    configurePeriodStore({ asOf: () => AS_OF });
    go("#/reports");
    expect(getPeriod()).toEqual(resolvePeriod("last-12", AS_OF));
    expect(() => pickPeriod(resolvePeriod("ytd", AS_OF))).not.toThrow();
    expect(getPeriod()).toEqual(resolvePeriod("ytd", AS_OF));
  });

  test("a remembered preset is re-resolved against today, not frozen on the day it was picked", () => {
    go("#/reports");
    pickPeriod(resolvePeriod("this-month", AS_OF));
    configurePeriodStore({ asOf: () => "2026-11-03" });
    go("#/reports");
    expect(getPeriod()).toEqual({ preset: "this-month", from: "2026-11-01", to: "2026-11-03" });
  });
});

describe("the comparison choice", () => {
  test("defaults to none and leaves the link clean", () => {
    go("#/reports");
    expect(getCompare()).toBe("none");
    expect(window.location.hash).toBe("#/reports?period=last-12");
  });

  test("a choice in the link wins; junk falls back to the remembered choice", () => {
    go("#/reports?period=ytd&compare=last-year");
    expect(getCompare()).toBe("last-year");
    pickCompare("avg-12");
    go("#/reports?period=ytd&compare=sideways");
    expect(getCompare()).toBe("avg-12");
  });

  test("picking one updates the link, keeps the tab and the period, and is remembered", () => {
    go("#/reports?tab=income");
    pickPeriod(resolvePeriod("last-month", AS_OF)); // by hand, so it is remembered
    pickCompare("previous");
    expect(getCompare()).toBe("previous");
    expect(window.location.hash).toBe("#/reports?tab=income&period=last-month&compare=previous");

    go("#/reports"); // by the sidebar
    expect(getCompare()).toBe("previous");
    expect(window.location.hash).toBe("#/reports?period=last-month&compare=previous");

    pickCompare("none");
    expect(window.location.hash).toBe("#/reports?period=last-month");
  });

  test("picking a new period keeps the comparison in the link, after the period", () => {
    go("#/reports?period=ytd&compare=last-year");
    pickPeriod(resolvePeriod("last-3", AS_OF));
    expect(window.location.hash).toBe("#/reports?period=last-3&compare=last-year");
    expect(getCompare()).toBe("last-year");
  });

  test("applies to Reports only: other screens neither read it nor have it written into their link", () => {
    go("#/reports");
    pickCompare("previous");
    go("#/accounts/networth");
    expect(window.location.hash).toBe("#/accounts/networth?period=last-12");
    go("#/transactions");
    expect(window.location.hash).toBe("#/transactions?period=last-12");
  });

  test("tells subscribers when it changes", () => {
    go("#/reports");
    const heard = vi.fn();
    const stop = subscribePeriod(heard);
    pickCompare("avg-3");
    expect(heard).toHaveBeenCalledTimes(1);
    pickCompare("avg-3");
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });
});

// Found by a browser pass, not by a unit test: clicking through from
// a screen with NO period picker (Budget, Dashboard). Nothing is subscribed there,
// so no one hears the link change, and the ledger opened under the PREVIOUS period
// instead of its own dates. Its total then did not match the figure clicked.
describe("reading the period when nobody was listening for the link change", () => {
  const LEDGER = "#/transactions?ledger=1&label=Dining&cat=Dining&kind=expense&from=2026-08-01&to=2026-08-31&counted=1&back=%23%2Fbudget%2Ftable";

  test("a ledger opened from a screen with no picker shows the ledger's own dates at once", () => {
    go("#/reports?period=last-12");
    window.location.hash = "#/budget/table"; // no sync: nothing on that screen subscribes
    window.location.hash = LEDGER; // and none here yet either: the screen is only now rendering
    expect(getPeriod()).toEqual(customPeriod("2026-08-01", "2026-08-31"));
  });

  test("reading does not notify, write the link, or remember: it is safe during a render", () => {
    go("#/reports");
    pickPeriod(resolvePeriod("last-3", AS_OF));
    const heard = vi.fn();
    const stop = subscribePeriod(heard);
    heard.mockClear();
    window.location.hash = LEDGER;
    getPeriod();
    expect(heard).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(LEDGER);
    stop();
    go("#/reports");
    expect(getPeriod()).toEqual(resolvePeriod("last-3", AS_OF)); // still what was picked by hand
  });

  test("the comparison is read the same way", () => {
    go("#/reports?period=ytd&compare=last-year");
    window.location.hash = "#/reports?period=ytd&compare=avg-3";
    expect(getCompare()).toBe("avg-3");
  });

  test("subscribing brings the store up to date with the link, including writing the period into it", () => {
    go("#/reports?period=ytd");
    window.location.hash = "#/accounts/networth";
    const stop = subscribePeriod(() => {});
    expect(window.location.hash).toBe("#/accounts/networth?period=last-12");
    stop();
  });
});

describe("a remembered period that does not parse", () => {
  test("falls back to the default instead of a null period, in memory as in storage", () => {
    go("#/reports");
    // Only reachable by code, not by the picker (Apply needs two dates), but a
    // null period here would take the next screen down.
    pickPeriod(customPeriod(null, null));
    expect(() => go("#/accounts/networth")).not.toThrow();
    expect(getPeriod()).toEqual(resolvePeriod("last-12", AS_OF));
  });
});

// The categories Reports is narrowed to are
// remembered the way the comparison is: the link wins, the last choice made by
// hand is remembered, and only Reports reads or writes it.
describe("the categories Reports is narrowed to", () => {
  test("default is every category, and the link stays clean", () => {
    go("#/reports");
    expect(getReportCategories()).toEqual([]);
    expect(window.location.hash).toBe("#/reports?period=last-12");
  });

  test("a choice in the link wins", () => {
    go("#/reports?period=ytd&cat=Groceries&cat=Dining");
    expect(getReportCategories()).toEqual(["Groceries", "Dining"]);
  });

  test("picking updates the link, keeps the tab and the period, and is remembered for the next visit", () => {
    go("#/reports?tab=spending&period=ytd");
    pickReportCategories(["Rent", "Groceries"]);
    expect(getReportCategories()).toEqual(["Rent", "Groceries"]);
    expect(window.location.hash).toBe("#/reports?tab=spending&period=ytd&cat=Rent&cat=Groceries");
    expect(JSON.parse(window.localStorage.getItem("financial-future.report-categories")!)).toEqual(["Rent", "Groceries"]);

    configurePeriodStore({ asOf: () => AS_OF }); // a fresh visit: memory gone, storage kept
    go("#/reports?period=ytd");
    expect(getReportCategories()).toEqual(["Rent", "Groceries"]);
    expect(window.location.hash).toBe("#/reports?period=ytd&cat=Rent&cat=Groceries");
  });

  test("All categories clears the link and the memory", () => {
    go("#/reports?period=ytd&cat=Rent");
    pickReportCategories([]);
    expect(getReportCategories()).toEqual([]);
    expect(window.location.hash).toBe("#/reports?period=ytd");
    go("#/reports?period=ytd");
    expect(getReportCategories()).toEqual([]);
  });

  test("a link marked every category shows every category, whatever was picked last, and leaves the memory alone", () => {
    go("#/reports?period=ytd");
    pickReportCategories(["Rent"]);
    go("#/reports?period=this-month&compare=avg-3&allcat=1");
    expect(getReportCategories()).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("financial-future.report-categories")!)).toEqual(["Rent"]);
  });

  test("applies to Reports only: other screens never have it written into their link", () => {
    go("#/reports");
    pickReportCategories(["Rent"]);
    go("#/transactions");
    expect(window.location.hash).toBe("#/transactions?period=last-12");
  });

  test("junk in storage is ignored", () => {
    window.localStorage.setItem("financial-future.report-categories", "{not json");
    go("#/reports");
    expect(getReportCategories()).toEqual([]);
    window.localStorage.setItem("financial-future.report-categories", JSON.stringify([1, 2]));
    configurePeriodStore({ asOf: () => AS_OF });
    go("#/reports");
    expect(getReportCategories()).toEqual([]);
  });

  test("tells subscribers once per real change, and keeps the same list between reads", () => {
    go("#/reports");
    const heard = vi.fn();
    const stop = subscribePeriod(heard);
    pickReportCategories(["Rent"]);
    expect(heard).toHaveBeenCalledTimes(1);
    const first = getReportCategories();
    pickReportCategories(["Rent"]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(getReportCategories()).toBe(first);
    stop();
  });
});
