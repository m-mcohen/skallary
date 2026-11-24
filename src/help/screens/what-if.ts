// Help for the What if screen, drafted from what the code computes
// (src/ui/what-if/*, src/domain/what-if.ts). Keep the words in step with the behavior.
// The ladder in the user's order,
// firm taxes and the premium, the bridge line and "with goals", and
// the One-time cost row. Salary needed, Take-home
// needed and the ladder price a usual month.
import type { HelpScreen } from "../types";

export const WHAT_IF_HELP: HelpScreen[] = [
  {
    key: "whatif",
    title: "What if",
    depth: "full",
    purpose:
      "What salary do I need for the costs and goals I switch on, what comes out of it on the way, and does my salary cover them? Each what-if keeps one list, in your order: its own changes, each goal's saving, and each goal's ongoing cost. Every row has a switch. The verdict at the top answers first; the salary ladder under it explains it, each total as an income statement, a month or a year: gross pay, what comes out of it, take-home, then your expenses and the rows switched on.",
    answers: "What salary do I need for the costs and goals I switch on, what comes out of it on the way, and does my salary cover them?",
    termIds: ["verdict", "switched-on", "goal-saving-row", "overlay", "real-numbers", "salary-ladder", "salary-to-live", "salary-to-live-and-hit-goals", "price-month", "salary-needed", "take-home", "take-home-needed", "maaser", "ongoing-cost", "one-time-cost"],
    numbers: [
      {
        label: "The verdict",
        meaning: "Whether the salary covers everything switched on, with what is left a month, or how much a month it falls short and which rows it does not cover. Red only when it falls short.",
        how:
          "The salary is the what-if's own, or your current yearly salary from Settings, Salary when it has none. Check a salary's walk decides what it covers. The shortfall is today's costs plus every cost and goal saving switched on, less what the salary leaves to spend each month after tax, benefits and charity. It changes as you switch rows. On your current salary its taxes are your firm figures from Settings, Salary when you typed them; on a what-if's own salary they are estimated.",
      },
      {
        label: "Salary needed (What if)",
        meaning: "With Real numbers on, the salary a normal month needs. With a what-if on, that what-if's Salary to live and hit goals: every cost and goal saving switched on. Its label says with goals while a goal saving is switched on.",
        how:
          "The yearly base salary, gross, whose take-home, after federal income tax, Social Security and Medicare, benefits and charity, equals the month's costs plus the goal savings switched on. Charity is the larger of the Charity line and the charity pot's month. It prices a usual month: each budget line's every-month amount. A one-month budget amount never moves Salary needed; a one-off belongs in a One-time cost row. The assumptions are the ones under Settings, Salary. Its taxes are always estimated, even when you typed firm figures for your current salary, because it is a salary you would need, not the one you have.",
      },
      {
        label: "Take-home needed (What if)",
        meaning: "What Salary needed has to leave once tax, benefits and any charity pot are out: the month's costs, charity aside, and any goal savings switched on. Shown a month and a year.",
        how: "Monthly budget, less the Charity line (the pot line covers it), plus any goal savings switched on, always, as the last line of its i panel says: both price a usual month. The i panel also shows each line from Gross pay to Take-home, a year: the same lines, from the same figures, as the ladder's income statement for that salary. Salary needed is rounded to the whole dollar, so that Take-home can be a few cents more than Take-home needed.",
      },
      {
        label: "Your income",
        meaning: "The ladder's first statement: your salary, the one the verdict uses (this what-if's own, or your current yearly salary), from gross pay to what is left over once your expenses and every row switched on are paid. Take-home, less Expenses and the what-if rows, is Left over.",
        how: "The same lines and the same figures as the verdict, so the two agree; Left over here and the verdict's are within a cent of each other. With no yearly salary set, and none on the what-if, it says what to type instead. On your current salary its taxes are your firm figures from Settings, Salary when you typed them.",
      },
      {
        label: "Salary you would need",
        meaning: "Below Your income, collapsed at first: the two break-even totals, Salary to live and Salary to live and hit goals, each the yearly base salary that just covers its costs, as the same income statement. Shut, it names both salaries in one line.",
        how: "Each salary is found to cover its expenses and rows, so its Left over is about zero. Open it with its arrow; this computer remembers whether it is open.",
      },
      {
        label: "Folding lines away",
        meaning: "Expenses and the Benefits line fold open and shut with their arrows, and so does Income while this is on. Shut, Expenses shows their sum on its heading.",
        how: "Expenses fold on every statement at once. Each starts open, and this computer remembers your choice.",
      },
      {
        label: "The income statement",
        meaning: "Each statement, read from the top down: Gross pay; Federal income tax; Social Security and Medicare; Benefits, with each benefit you list under it; the charity pot; Take-home; Expenses, one line per budget line; What-if rows switched on, one line per row; Expenses and what-if rows, in all; Left over or short.",
        how:
          "Only the lines the salary math works out. Federal income tax is estimated for your filing status. State and local taxes are not estimated: their line shows only when typed from a pay stub under Settings, Salary, and a note says so otherwise. Until your filing status and children are set, a Set this up card stands in for every estimate. Money that comes out carries a minus. Each tax line and the Benefits line say estimated or from Settings. An additional salary from Settings, Salary or the what-if is its own line: a W-2 salary is taxed with yours, filed jointly when that is your filing status and otherwise on its own single return, so the tax lines are for both salaries and a note says so; a typed monthly amount lands in the bank as it is, with no tax lines and no charity share of its own. Every line adds up to the cent.",
      },
      {
        label: "Take-home",
        meaning: "The only take-home: what the salary leaves once federal income tax, Social Security and Medicare, benefits and any charity pot are out, plus any additional monthly amount.",
        how: "A month, it is the paycheck the Forecast and Check a salary use, less the charity pot (or the Charity line, when it is more).",
      },
      {
        label: "The charity pot",
        meaning: "The pot's month: its share of the pay that lands in the bank (after tax and benefits), or its set amount. When the budget's Charity line is more, the line shows the Charity line instead and says so, since the salary math has always counted the larger of the two.",
        how: "Gross pay less the tax lines, Benefits and this line is Take-home.",
      },
      {
        label: "Expenses",
        meaning: "Your budget's lines for a normal month, each on its own line. The Charity line is left out of Expenses: the pot line covers it.",
        how: "Each budget line's every-month amount, a month or 12 times it a year. A one-month amount on the Budget is left out: the statement prices a usual month.",
      },
      {
        label: "What-if rows switched on",
        meaning: "Each cost row switched on in the list, by what it moves your costs: a new cost or a raise comes out, a cut adds back. On the second total, each goal saving switched on too.",
        how: "Switch rows on and off, and move them, in the list beside the ladder; the ladder follows. A row that changes the Charity line moves the line above Take-home instead, so it reads $0.00 here. One-time costs and down payments never appear here.",
      },
      {
        label: "Left over or short",
        meaning: "Take-home, less Expenses and what-if rows, in all. Red only when it is short by a dollar a month or more.",
        how: "On Your income it is what your salary truly leaves. Under Salary you would need, each total's salary is found to cover its expenses and rows and then rounded to the whole dollar, so there it is a few cents either way, and the salary each step needs is one click away under each statement.",
      },
      {
        label: "Monthly or Yearly",
        meaning: "The switch above the ladder flips every line of every statement between a month and a year. It opens on Monthly, and this computer remembers your choice.",
        how: "A year is the salary's own yearly figures. A month is a twelfth of each running total, rounded to the cent, so a yearly line can be a few cents off 12 months of it; Expenses and the what-if rows are exactly 12 months.",
      },
      {
        label: "Today's costs, charity aside",
        meaning: "The first step of the ladder: a normal month from your budget, with no changes. This is not the same figure as Budget before these changes on the list, which includes Charity; the two are named apart on purpose.",
        how: "The sum of every budget line's every-month amount, leaving out Charity, which the salary calculation handles on its own. A one-month amount is left out.",
      },
      {
        label: "A goal's saving",
        meaning: "What a goal saves a month while its saving row is switched on: its Planned per month when you typed one on the Goals screen, otherwise its Needed per month, worked out from the target date.",
        how:
          "Set up once on the Goals screen; each goal card's On What if line says which it is. A fully saved or completed goal saves nothing more and says so; a goal with neither a target date nor a planned amount saves nothing and says so. It counts toward Salary needed and Take-home needed only, never Monthly budget or the Forecast.",
      },
      {
        label: "A goal's ongoing cost",
        meaning: "What a goal costs a month once you have it, such as the mortgage that comes with a house. Its own row, apart from saving for the goal; only goals that have one show it.",
        how:
          "Switched on, it is a step inside Salary to live, priced in full like any cost, and it joins this what-if's runway, the Forecast and the Dashboard's Monthly budget when this what-if is on. Nothing ties it to the goal's saving row: switch on either, both or neither. A goal whose cost has started is already in your budget, so it moves to Completed goals and is not on the list.",
      },
      {
        label: "Salary to live",
        meaning: "The salary that pays for a normal month plus every cost switched on: the what-if's changes and goals' ongoing costs.",
        how:
          "Walk the cost rows that are switched on, in the list's order. Each step adds its cost (a cut subtracts) and shows the salary needed (gross) and take-home needed (net) once it is added, and how much that step added. The last cost step's salary is Salary to live; its income statement shows where that salary goes. The steps sit under its statement: press Show the salary each step needs. A down payment or a one-time cost is paid once, so it never enters a salary.",
      },
      {
        label: "Salary to live and hit goals",
        meaning: "Salary to live, plus every goal saving switched on.",
        how: "Each goal saving switched on adds its saving a month, in the list's order; its statement shows each as a what-if row, with the salary each needs one click away. When none is on, it equals Salary to live and says No goals included.",
      },
      {
        label: "Priced for",
        meaning: "What the ladder prices: a usual month, each budget line's every-month amount, with every row switched on in full.",
        how: "A one-month budget amount never moves Salary needed; a one-off belongs in a One-time cost row. Costs on What if carry no start or end month, so every row switched on counts in full. A loan counts its full payment, as it stands next month.",
      },
      {
        label: "Check a salary",
        meaning: "Which rows a salary you type would cover.",
        how:
          "Work out what the salary leaves to spend each month after tax, benefits and charity. Apply every cut first, since a cut always fits and can bring today's costs back into what the salary covers even when they would not have fit on their own. Then take today's costs out, and walk the rows switched on, top to bottom in the list's order, costs and goal savings mixed: a row is covered when it fits in what is left, and one that does not fit is marked not covered and skipped while the next is tried. What remains is Left over each month. On your current salary, when the what-if keeps it, the taxes are your firm figures from Settings, Salary if you typed them, and the box says so; any other salary is estimated.",
      },
      {
        label: "Runway with this what-if",
        meaning: "How long the money lasts with this what-if on: the Forecast screen's own figure.",
        how:
          "The Forecast screen's own projection: 24 months from next month, starting from today's Drawable. The what-if's salary comes in from its start month, or your current salary's month when it has none of its own; with no salary of its own, your current salary from Settings, Salary stays. Its additional salary, or the one in Settings, comes in from its month. The costs switched on count from the month its salary starts, or from next month when it has none, with the charity pot's raise of Charity, each down payment once in that month, each one-time cost once in its own month, and each loan's payments for its years. Saving for a goal is never in it.",
      },
      {
        label: "One-time cost",
        meaning: "A cost paid once, in one month, such as a wedding: a row of its own in the list, with its amount and month.",
        how: "While it is switched on, the Forecast and this what-if's runway count it once, in its month. It never counts toward Salary needed, Take-home needed, Monthly budget, the ladder or Check a salary, like a down payment.",
      },
    ],
    howTo: [
      {
        title: "Price a new car",
        steps: [
          "Pick a what-if, or press New what-if and name it.",
          "Press Car, and type the price, the down payment, the rate and the years. The payment a month shows as you type.",
          "Press Use this. The car joins the bottom of the list, switched on, and the verdict and the ladder take it in.",
          "Switch on Saving for Second vehicle too if you are also saving for it, to see both together.",
        ],
      },
      {
        title: "Try a different mix",
        steps: [
          "Switch rows off and on. The verdict, the ladder and Check a salary change as you do; each switch is saved at once, for this what-if only.",
          "Rows switched off count nowhere while this what-if is on: not the figures across the top, not the Forecast.",
        ],
      },
      {
        title: "See the app as it would be with the what-if",
        steps: [
          "Open the menu in the top bar that reads Real numbers, and pick the what-if.",
          "A banner says it is on, on every screen. Monthly budget, Salary needed and the Forecast follow what is switched on; Drawable stays today's cash.",
          "Press Turn off in the banner, or pick Real numbers, to go back.",
        ],
      },
      {
        title: "Read the ladder a month or a year",
        steps: [
          "Press Monthly or Yearly above the ladder. Every line of both statements flips.",
          "Press Show the salary each step needs to see the salary each cost needs once it is added.",
        ],
      },
      {
        title: "Add a one-time cost",
        steps: [
          "Press One-time cost under the list.",
          "Type its name, its amount and the month it is paid, and press Add cost.",
          "It joins the bottom of the list, switched on, and the Forecast takes it out in that month. Switch it off to leave it out.",
        ],
      },
      {
        title: "Put the list in order",
        steps: [
          "Use the up and down arrows beside any row, a change or a goal's row.",
          "The ladder and Check a salary take the rows in that order, so put what matters most first.",
        ],
      },
    ],
    dataFrom:
      "The budget lines of the selected plan, Settings, Salary, your goals and the accounts that fund them, and today's balances. The what-ifs themselves, with each list's order and switches, are saved in the app's own database; each change you finish and each switch you flip is saved at once.",
    limits: [
      "A bonus is never counted.",
      "Salary needed, Take-home needed, the ladder, Check a salary and the verdict price a usual month. A one-month budget amount never moves Salary needed; a one-off belongs in a One-time cost row. The Forecast counts each month as budgeted, one-month amounts included.",
      "Salary needed is always what you would need, not what the what-if pays you. The what-if's salary moves the runway and the verdict, and its charity pot share raises Monthly budget while the what-if is on; it never changes Salary needed. An additional salary does change it: Salary needed is then your salary given that one.",
      "Costs here carry no start or end month. An older change keeps the months it had, but nothing reads them.",
      "A one-time cost and a car's or a mortgage's down payment are paid once: they reach the Forecast and the runway in their month, never a salary.",
      "Salary needed and the ladder always estimate taxes, even when you typed your paycheck tax figures for your current salary under Settings, Salary; the verdict and Check a salary use them only on that same salary.",
      "A car's payment ends when the loan is paid off, in the Forecast. A mortgage's property tax and insurance keep going after that; only the principal and interest part stops.",
      "A new goal arrives switched off in every what-if, and a new what-if starts with every goal switched off.",
      "Editing a what-if here never turns it on. Only the menu in the top bar does that.",
    ],
  },
];
