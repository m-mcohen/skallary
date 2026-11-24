// tests/help/content.test.ts -- the help content's contract.
//
// Help is data (src/help), so its promises can be checked: every screen in the
// navigation has an article, every term an article or an info point names is
// defined exactly once, the number-heavy screens carry the full treatment, and
// the words follow the house rules (plain language, no em dashes, no developer
// field names). Adding a screen to nav.ts without writing its help fails here.
import { describe, expect, test } from "vitest";

import { NAV, SUB_PAGES } from "../../src/ui/shell/nav";
import { GLOSSARY, findTerm } from "../../src/help/glossary";
import { FULL_DEPTH_KEYS, HELP_SCREENS, GETTING_STARTED_KEY, helpByKey, helpFor, helpKey } from "../../src/help";
import type { HelpScreen } from "../../src/help/types";
import { rememberHouseholdForHelp } from "../../src/help/household-words";

/** Every screen the navigation can land on: one per tab, or one per tabless section. */
function navScreenKeys(): string[] {
  return NAV.filter((i) => i.id !== "help").flatMap((i) =>
    i.tabs && i.tabs.length > 0 ? i.tabs.map((t) => helpKey(i.id, t.id)) : [helpKey(i.id, null)]
  );
}

function allStrings(s: HelpScreen): string[] {
  return [
    s.title,
    s.purpose,
    s.answers ?? "",
    ...(s.numbers ?? []).flatMap((n) => [n.label, n.meaning, n.how]),
    ...(s.howTo ?? []).flatMap((h) => [h.title, ...h.steps]),
    s.dataFrom ?? "",
    ...(s.limits ?? []),
  ];
}

describe("help coverage", () => {
  // Settings gained a Guide tab for the guide
  // line's switch, so 20 screens became 21.
  // Long-term's two tabs became one Wealth screen, so 21 became 20.
  // Wealth retired and Runway became Forecast, so 20 became 19.
  // Settings gained a Merchants tab, so 19 became 20.
  // The Budget gained a Year tab, so 20 became 21.
  // Ui-look: Accounts' two tabs became one page, so 21 screens became 20.
  // C6: Settings gained an Appearance tab, so 20 became 21.
  // A6: Settings gained a Household tab, so 21 screens became 22.
  // Budget gained a Yearly costs tab, so 22 screens became 23.
  test("the app has 24 screens and every one has a help article", () => {
    const keys = navScreenKeys();
    expect(keys).toHaveLength(24);
    const missing = keys.filter((k) => !HELP_SCREENS.some((s) => s.key === k));
    expect(missing).toEqual([]);
  });

  test("Acquisition is gone from the manual: no article and no glossary terms", () => {
    expect(HELP_SCREENS.some((s) => s.key.startsWith("long-term"))).toBe(false);
    for (const id of ["sde", "cash-to-close", "debt-service", "dscr", "equity-ready"]) expect(findTerm(id), id).toBeUndefined();
    const text = JSON.stringify([HELP_SCREENS, GLOSSARY]);
    expect(text).not.toMatch(/Acquisition|SBA|cash to close|equity-ready/i);
  });

  // Wealth is retired with its four terms, and
  // the Runway screen is Forecast now. The runway figure (months the money lasts) keeps its name.
  test("Wealth is gone from the manual, and the Runway screen is Forecast everywhere", () => {
    expect(helpByKey("wealth")).toBeNull();
    expect(helpByKey("runway")).toBeNull();
    for (const id of ["emergency-fund", "wealth-building", "general-savings", "model-net-worth"]) expect(findTerm(id), id).toBeUndefined();
    const forecast = helpByKey("forecast")!;
    expect(forecast.title).toBe("Forecast");
    // The question was rewritten: real income against real costs.
    expect(forecast.answers).toBe("Where is my cash heading, with my real income and costs?");
    expect(forecast.numbers!.map((n) => n.label)).toContain("Runway");
    expect(findTerm("runway")!.definition).toMatch(/The Forecast screen counts whole months/);
    const text = JSON.stringify([HELP_SCREENS, GLOSSARY]);
    expect(text).not.toMatch(/Wealth|wealth model|Runway screen|Runway has its own screen/);
  });

  test("no article is orphaned: each key is a real screen or the getting-started page", () => {
    // a page under a screen (the merchant page under Reports) has its own article.
    const valid = new Set([...navScreenKeys(), ...SUB_PAGES.map((p) => helpKey(p.section, p.page)), GETTING_STARTED_KEY]);
    expect(HELP_SCREENS.map((s) => s.key).filter((k) => !valid.has(k))).toEqual([]);
    const keys = HELP_SCREENS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("help follows the current layout", () => {
    const keys = HELP_SCREENS.map((s) => s.key);
    // Ui-look: Accounts is one page with one article.
    expect(keys).toEqual(expect.arrayContaining(["accounts", "settings.accounts"]));
    expect(keys).not.toContain("networth");
    expect(keys).not.toContain("accounts.balances");
    expect(keys).not.toContain("accounts.networth");
    const dashboard = JSON.stringify(HELP_SCREENS.find((s) => s.key === "dashboard"));
    expect(dashboard).not.toMatch(/Runs out|Below 12-month floor|The curve|Position/);
    expect(dashboard).toMatch(/This month so far/);
    expect(dashboard).toMatch(/Left over so far/);
    // The switches live under Settings, Accounts, and net worth is part of Accounts.
    expect(JSON.stringify([GLOSSARY, HELP_SCREENS])).not.toMatch(/Accounts screen|Net worth screen|Position card/);
    const getting = JSON.stringify(HELP_SCREENS.find((s) => s.key === GETTING_STARTED_KEY));
    expect(getting).not.toMatch(/Runway, Drawable, Monthly budget and Salary needed/);
  });

  test("helpFor resolves a section and tab, and the Help section itself opens on getting started", () => {
    expect(helpFor("budget", "charts")?.key).toBe("budget.charts");
    expect(helpFor("forecast", null)?.key).toBe("forecast");
    expect(helpFor("help", null)?.key).toBe(GETTING_STARTED_KEY);
    expect(helpFor("no-such-screen", null)).toBeNull();
  });
});

describe("glossary", () => {
  test("term ids are unique and every definition is a real sentence", () => {
    const ids = GLOSSARY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of GLOSSARY) {
      expect(t.term.trim().length).toBeGreaterThan(0);
      expect(t.definition.trim().length).toBeGreaterThan(20);
      expect(t.definition.trim()).toMatch(/[.]$/);
    }
  });

  test("every term an article names is defined", () => {
    const unknown = HELP_SCREENS.flatMap((s) => s.termIds.filter((id) => !findTerm(id)).map((id) => `${s.key}: ${id}`));
    expect(unknown).toEqual([]);
  });

  test("every defined term is used by at least one article", () => {
    const used = new Set(HELP_SCREENS.flatMap((s) => s.termIds));
    expect(GLOSSARY.map((t) => t.id).filter((id) => !used.has(id))).toEqual([]);
  });
});

describe("depth (full for the number-heavy screens, short for the rest)", () => {
  // Wealth retired and Runway became Forecast, so four became three.
  test("exactly the three number-heavy screens are full depth", () => {
    expect([...FULL_DEPTH_KEYS].sort()).toEqual(["dashboard", "forecast", "whatif"].sort());
    const full = HELP_SCREENS.filter((s) => s.depth === "full").map((s) => s.key).sort();
    expect(full).toEqual([...FULL_DEPTH_KEYS].sort());
  });

  test("a full article defines its numbers, gives steps, says where the data comes from and what its limits are", () => {
    for (const s of HELP_SCREENS.filter((x) => x.depth === "full")) {
      expect(s.numbers?.length ?? 0, `${s.key} numbers`).toBeGreaterThanOrEqual(3);
      expect(s.howTo?.length ?? 0, `${s.key} how-to`).toBeGreaterThanOrEqual(1);
      for (const h of s.howTo ?? []) expect(h.steps.length, `${s.key}: ${h.title}`).toBeGreaterThanOrEqual(2);
      expect((s.dataFrom ?? "").length, `${s.key} data`).toBeGreaterThan(20);
      expect(s.limits?.length ?? 0, `${s.key} limits`).toBeGreaterThanOrEqual(1);
    }
  });

  test("a short article is the purpose plus three to five key terms", () => {
    for (const s of HELP_SCREENS.filter((x) => x.depth === "short" && x.key !== GETTING_STARTED_KEY)) {
      expect(s.purpose.length, `${s.key} purpose`).toBeGreaterThan(30);
      expect(s.termIds.length, `${s.key} terms`).toBeGreaterThanOrEqual(3);
      expect(s.termIds.length, `${s.key} terms`).toBeLessThanOrEqual(5);
    }
  });
});

// the guide. A "This page
// answers" line, from a new `answers` field, on every real screen; getting
// started has none, because it is not a screen you land on. And every
// non-getting-started article gets 2 to 5 numbered "how to" steps.
describe("the guide", () => {
  test("every screen except getting started has an answers line", () => {
    const missing = HELP_SCREENS.filter((s) => s.key !== GETTING_STARTED_KEY && !s.answers?.trim()).map((s) => s.key);
    expect(missing).toEqual([]);
  });

  test("getting started needs no answers line", () => {
    expect(helpFor("help", null)?.answers).toBeUndefined();
  });

  test("every non-getting-started article has at least one how-to, with 2 to 5 steps each", () => {
    for (const s of HELP_SCREENS.filter((x) => x.key !== GETTING_STARTED_KEY)) {
      expect(s.howTo?.length ?? 0, `${s.key} how-to`).toBeGreaterThanOrEqual(1);
      for (const h of s.howTo ?? []) {
        expect(h.steps.length, `${s.key}: ${h.title}`).toBeGreaterThanOrEqual(2);
        expect(h.steps.length, `${s.key}: ${h.title}`).toBeLessThanOrEqual(5);
      }
    }
  });

  test("Settings gains a Guide tab, with its own answers line and how-to", () => {
    const guide = HELP_SCREENS.find((s) => s.key === "settings.guide")!;
    expect(guide).toBeDefined();
    expect(guide.answers).toBe("Should every page say what it answers?");
    expect(guide.howTo?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe("house rules for the words", () => {
  const SNAKE = /\b[a-z]+_[a-z_]+\b/;
  const CAMEL = /\b[a-z]+[A-Z][A-Za-z]*\b/;
  const ALLOWED = /SimpleFIN/g;

  test("no em or en dashes, no double hyphens, no developer field names", () => {
    const offenders: string[] = [];
    const check = (where: string, text: string) => {
      if (/[—–]|--/.test(text)) offenders.push(`${where}: dash in "${text.slice(0, 60)}"`);
      const stripped = text.replace(ALLOWED, "");
      if (SNAKE.test(stripped) || CAMEL.test(stripped)) offenders.push(`${where}: field name in "${text.slice(0, 60)}"`);
    };
    for (const s of HELP_SCREENS) for (const text of allStrings(s)) check(s.key, text);
    for (const t of GLOSSARY) {
      check(`glossary ${t.id}`, t.term);
      check(`glossary ${t.id}`, t.definition);
    }
    expect(offenders).toEqual([]);
  });
});

describe("help uses the approved names", () => {
  const allText = JSON.stringify([GLOSSARY, HELP_SCREENS]);
  test.each(["Budget / month", "Trailing 12mo", "Avg. monthly net", "Drawable liquid", "Some screens call it", "Burn", "Plan cell", "Cumulative maaser", "universal time", "Liquid cash over time"])(
    "no help text says %s",
    (old) => expect(allText).not.toContain(old)
  );
  test("no help text says drawable liquid in any case", () => {
    expect(allText).not.toMatch(/drawable liquid/i);
  });
  test("no help text abbreviates the emergency fund to EF", () => {
    expect(allText).not.toMatch(/\bEF\b/);
  });
  test("the renamed terms carry the new words", () => {
    const term = (id: string) => GLOSSARY.find((g) => g.id === id)!.term;
    expect(term("burn")).toBe("Monthly budget");
    expect(term("overlay")).toBe("What-if");
    expect(term("trailing-spending")).toBe("Average spent, last 12 months");
    expect(term("net-cash-flow")).toBe("Left over");
    expect(term("cumulative-surplus")).toBe("Running total, left over");
  });
  test("Reports explains Saved and Investment income", () => {
    const reports = HELP_SCREENS.find((s) => s.key === "reports")!;
    expect(reports.termIds).toEqual(expect.arrayContaining(["net-cash-flow", "saved", "investment-income"]));
  });
});

// one What if screen replaces Scenarios and Lifestyle.
describe("What if help", () => {
  const whatIf = () => HELP_SCREENS.find((s) => s.key === "whatif")!;
  test("the article names the numbers the screen shows", () => {
    const labels = whatIf().numbers!.map((n) => n.label);
    for (const label of ["Salary needed", "Salary to live", "Salary to live and hit goals", "Priced for", "Runway with this what-if", "Check a salary"]) {
      expect(labels.some((l) => l.includes(label)), label).toBe(true);
    }
  });
  // the ladder reads as an income statement, Monthly or Yearly.
  // Take-home is after the pot; Take-home pay and Left for the
  // budget are retired; Expenses and the what-if rows follow it.
  test("it explains the income statement, its lines and the Monthly | Yearly switch", () => {
    const labels = whatIf().numbers!.map((n) => n.label);
    for (const label of ["The income statement", "Take-home", "Expenses", "Left over or short", "Monthly or Yearly"]) {
      expect(labels.some((l) => l.includes(label)), label).toBe(true);
    }
    const text = JSON.stringify(whatIf());
    expect(text).toMatch(/State and local taxes are not estimated/);
    expect(text).toMatch(/filed jointly when that is your filing status and otherwise on its own single return/);
    expect(whatIf().answers).toMatch(/what comes out of it/);
    expect(whatIf().termIds).toEqual(expect.arrayContaining(["take-home", "take-home-needed", "maaser"]));
    expect(findTerm("take-home")!.definition).toMatch(/after the pot/);
    expect(findTerm("take-home-needed")!.definition).toMatch(/Monthly budget, less the Charity line/);
    expect(findTerm("salary-ladder")!.definition).toMatch(/income statement/);
  });
  test("it shows how to price a new car, and says a bonus never counts", () => {
    const car = whatIf().howTo!.find((h) => h.title === "Price a new car")!;
    expect(car.steps.length).toBeGreaterThanOrEqual(2);
    expect(whatIf().limits).toContain("A bonus is never counted.");
  });
  test("its terms include the new names", () => {
    expect(whatIf().termIds).toEqual(expect.arrayContaining(["salary-to-live", "salary-to-live-and-hit-goals", "real-numbers", "price-month", "overlay"]));
    expect(findTerm("real-numbers")!.term).toBe("Real numbers");
  });
  // With a salary on, the pot raises Monthly budget too.
  test("the salary's effect is described as it is: the runway and Monthly budget move, Salary needed does not", () => {
    const text = JSON.stringify(whatIf());
    expect(text).not.toMatch(/moves the runway only/);
    expect(whatIf().limits!.some((l) => /Monthly budget/.test(l) && /never changes Salary needed/.test(l))).toBe(true);
  });
  // Runway left the top bar and the Dashboard, and
  // the Dashboard's Monthly budget tile does follow a what-if.
  test("no help text puts Runway on the top bar, or says a what-if never changes the Dashboard", () => {
    const allText = JSON.stringify([GLOSSARY, HELP_SCREENS]);
    expect(allText).not.toMatch(/top bar and the Dashboard count/);
    expect(allText).not.toMatch(/A what-if never changes this/);
    expect(helpFor("dashboard", null)!.limits!.some((l) => /Monthly budget/.test(l) && /what-if/.test(l))).toBe(true);
  });

  test("no help text points at a screen or a control that is gone", () => {
    const allText = JSON.stringify([GLOSSARY, HELP_SCREENS]);
    expect(allText).not.toMatch(/Lifestyle|Scenarios screen|the Scenarios|Set default|scrubber|Scrubber|Save as scenario/);
  });
});

// The Wish List is ordered by dragging, not by a typed priority number.
describe("Wish List help", () => {
  test("it says to drag a row to change the order, and never to type a priority", () => {
    const text = JSON.stringify([HELP_SCREENS.find((s) => s.key === "goals.wishlist"), findTerm("priority")]);
    expect(text).toMatch(/[Dd]rag/);
    expect(text).not.toMatch(/[Ss]et priority|lower number|priority number/);
  });
});

// The Wish List is one-time items: no kind, no date, no horizon, not in the forecast.
describe("Wish List help, one-time items", () => {
  test("the Wish List article describes a list of one-time purchases, not planned or dated ones", () => {
    const text = JSON.stringify(HELP_SCREENS.find((s) => s.key === "goals.wishlist"));
    expect(text).toMatch(/one-time/i);
    expect(text).not.toMatch(/[Pp]lanned|target date|affordable|forecast|horizon|surplus/);
  });
  test("the terms for planned items, wish items and the affordable month are gone", () => {
    for (const id of ["planned-item", "wish-item", "affordable-month"]) expect(findTerm(id)).toBeUndefined();
  });
  test("no other article says the Wish List reaches a projection", () => {
    const text = JSON.stringify(HELP_SCREENS.filter((s) => s.key !== "goals.wishlist"));
    expect(text).not.toMatch(/Wish List purchase|planned purchase|Planned item|Wish List item/i);
  });
});

// the Net worth chart is one line from recorded readings.
// The back-cast and the Drawable line are gone, so are their words.
describe("Net worth help matches the one-line chart", () => {
  test("no article or term describes the back-cast or the Drawable line", () => {
    expect(JSON.stringify([GLOSSARY, HELP_SCREENS])).not.toMatch(/back-cast|Drawable, recorded at each sync/i);
  });

  test("the Net worth article names the reading and the Include switch", () => {
    const nw = HELP_SCREENS.find((s) => s.key === "accounts")!;
    expect(nw.termIds).toContain("balance-reading");
    expect(findTerm("balance-reading")?.definition).toMatch(/each bank sync/i);
    expect(JSON.stringify(nw)).toMatch(/the switch to include them/);
    expect(findTerm("net-worth")?.definition).toMatch(/the switch to include them/);
    // The partner is named from the household, or "your partner" when none is stored.
    rememberHouseholdForHelp({ youName: "Alex", partnerName: "Sam" });
    expect(findTerm("net-worth")?.definition).toMatch(/Sam's own accounts/);
    rememberHouseholdForHelp(null);
    expect(findTerm("net-worth")?.definition).toMatch(/Your partner's own accounts/);
  });
});

// real income lives in Settings, Salary;
// Forecast runs it against the budget's costs; Model income is retired.
describe("real income and the forecast", () => {
  test("Forecast explains real income, the safety line, and what a what-if changes", () => {
    const forecast = helpByKey("forecast")!;
    const labels = forecast.numbers!.map((n) => n.label);
    expect(labels).toEqual(expect.arrayContaining(["Income in the forecast", "If no money came in"]));
    const text = JSON.stringify(forecast);
    expect(text).toMatch(/Settings, Salary/);
    expect(text).toMatch(/goal/i);
    expect(text).toMatch(/down payment/i);
    expect(text).not.toMatch(/modeled income|zero income/i);
    expect(forecast.termIds).toEqual(expect.arrayContaining(["current-salary", "additional-salary"]));
  });

  test("the zero-income-on-purpose limit and Model income are gone everywhere", () => {
    const allText = JSON.stringify([GLOSSARY, HELP_SCREENS]);
    expect(allText).not.toMatch(/zero income on purpose/);
    expect(allText).not.toMatch(/Model income/);
  });

  test("Settings, Salary covers the current and additional salary", () => {
    const salary = helpByKey("settings.salary")!;
    // firm tax figures and the premium say what comes out of it.
    // The tax and premium figures are typed a paycheck, so it says each paycheck.
    expect(salary.answers).toBe("What do I earn now, what comes out of each paycheck, and what does Salary needed assume?");
    const text = JSON.stringify(salary);
    expect(text).toMatch(/Current salary/);
    expect(text).toMatch(/Additional salary/);
    expect(text).toMatch(/otherwise on its own single return/);
    expect(findTerm("current-salary")).toBeDefined();
    expect(findTerm("additional-salary")!.definition).toMatch(/given/);
  });

  test("the Budget month article no longer mentions writing income, and names Change budget", () => {
    const table = JSON.stringify(helpByKey("budget.month"));
    expect(table).not.toMatch(/writes 24 months of income/);
    expect(table).toMatch(/Change budget/);
  });
});

// Reports leads with the total and a ranked list, puts
// refunds on their own line, draws a chart that drills down, and can be narrowed
// to chosen budget lines. The article says all of it, in the same change.
describe("Reports help after the ranked-list redesign", () => {
  const reports = () => HELP_SCREENS.find((s) => s.key === "reports")!;
  const all = () => {
    const r = reports();
    return [r.purpose, r.answers, ...r.howTo.flatMap((h) => h.steps), ...r.limits].join(" ");
  };
  test("the page answers how much went out and where", () => {
    // a click on a month narrows the whole page to it.
    expect(reports().answers).toBe("How much went out, where did it go, over the period or one month of it, and how does it compare?");
  });
  test("it defines the new words", () => {
    // A short article keeps five terms, so Share and Monthly average are explained in its text.
    expect(reports().termIds).toEqual(expect.arrayContaining(["refunds-and-credits"]));
    expect(GLOSSARY.find((t) => t.id === "refunds-and-credits")?.term).toBe("Refunds and credits");
    expect(all()).toContain("Share is");
    // complete months only.
    expect(all()).toContain("Monthly average counts complete months only");
  });
  test("it explains the chart, the drill-down, the columns switch, Other and narrowing", () => {
    const text = all();
    for (const words of ["by day", "by week", "by month", "Back to the whole period", "Stacked", "Regular", "Other", "All categories", "Refunds and credits"]) {
      expect(text, words).toContain(words);
    }
    expect(text).not.toContain("top 8 ranking cover");
  });
});

// the Dashboard switches months. Its article says
// how, what a past month shows, which figures stay today's, and that a what-if
// never changes a past month, in the same change.
describe("Dashboard help after month switching", () => {
  const dash = () => HELP_SCREENS.find((s) => s.key === "dashboard")!;
  const all = () => allStrings(dash()).join(" ");
  test("the page answers how this month is going and how an earlier month ended", () => {
    expect(dash().answers).toBe("How is this month going, how did an earlier month end, and how close am I to my goals?");
  });
  test("it explains the month bar, its limits, and the link", () => {
    const text = all();
    for (const words of ["Previous month", "Next month", "This month", "first month with transactions", "no future months", "link"]) {
      expect(text, words).toContain(words);
    }
    expect(dash().howTo!.some((h) => h.title === "See how an earlier month ended")).toBe(true);
  });
  test("it says what a past month shows and which figures stay today's", () => {
    const text = all();
    expect(text).toContain("Budget against actual");
    expect(text).toContain("As of today");
    expect(dash().numbers!.some((n) => n.label === "Budget against actual")).toBe(true);
    expect(dash().limits!.some((l) => /A what-if never changes a past month/.test(l))).toBe(true);
  });
  test("the glossary names the month bar and a past month's spending", () => {
    expect(GLOSSARY.find((t) => t.id === "month-bar")?.term).toBe("Month bar");
    expect(GLOSSARY.find((t) => t.id === "spent-this-month")!.definition).toMatch(/past month/);
    expect(dash().termIds).toEqual(expect.arrayContaining(["month-bar", "budget-against-actual"]));
    expect(GLOSSARY.find((t) => t.id === "budget-against-actual")?.term).toBe("Budget against actual");
  });
});

// Deferred minor 2: the Month article names every action that changes finished months.
test("the Budget month article says Set up budget and Go back to suggested also reach finished months", () => {
  const month = JSON.stringify(helpByKey("budget.month"));
  expect(month).toMatch(/Months before this month are locked[^"]*Set up budget[^"]*Go back to suggested/);
});
