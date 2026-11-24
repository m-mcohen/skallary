// Help for the Forecast screen, drafted from what the code
// computes: the screen runs real income from Settings, Salary against the
// budget's costs (src/domain/cash-forecast.ts), and the old no-income runway stays as a small
// safety line. Runway is still the name of the months figure on it. Keep the words in step with the behavior.
import type { HelpScreen } from "../types";
import { partners } from "../household-words";

export const FORECAST_HELP: HelpScreen[] = [
  {
    key: "forecast",
    title: "Forecast",
    depth: "full",
    purpose:
      "Starting from the money you can draw on today, your income from Settings, Salary and the budget's costs month by month, where is your cash heading over the next 24 months? A what-if moves it: its salary, its additional salary and its costs.",
    answers: "Where is my cash heading, with my real income and costs?",
    termIds: ["runway", "drawable", "current-salary", "additional-salary", "budget-of-record", "what-if-cost"],
    numbers: [
      {
        label: "Drawable",
        meaning: "The money you could spend from today. It is the same number the Dashboard calls Drawable.",
        get how() {
          return `Add the latest synced balance of every account that counts and subtract every credit card balance. Archived accounts, accounts with no type, retirement accounts, loans, and ${partners()} own accounts while the switch to include them is off are all left out, and the Drawable switch under Settings, Accounts can override the starting choice for anything except a card.`;
        },
      },
      {
        label: "Income in the forecast",
        meaning: "The line under the heading: what comes in each month once every salary has started, and where it comes from.",
        how:
          "Your current salary from Settings, Salary, from its start month. A yearly base salary is worked the way the salary ladder works it: federal income tax and Social Security and Medicare come out, and your benefits; what is left is what lands in the bank. Tax figures from your paycheck, typed under Settings, Salary with how often you are paid, take the place of the estimates for your current salary only; state and local taxes are not estimated, so type them from a pay stub. Monthly pay into the bank is counted as you typed it. An additional salary joins from its own month: a W-2 salary is taxed with yours (on one return when married filing jointly, otherwise on its own single return), and a monthly amount is counted as it is. Any income line on the budget itself is added too. With no salary set it says so, and nothing comes in.",
      },
      {
        label: "Runway",
        meaning: "Whole months until the balance crosses zero, counted from next month.",
        how:
          "Project the next 24 months, beginning with next month. Each month, the income above comes in and the budget's costs go out. A charity pot's month raises the Charity line when it is more than the line. The number is how many of those months pass up to and including the month the balance reaches zero.",
      },
      {
        label: "Crosses zero in",
        meaning: "The month the balance reaches zero.",
        how: "The first projected month whose ending balance is zero or less.",
      },
      {
        label: "Cash-flow positive, or Lasts past 24 months",
        meaning: "No month in the projection reaches zero.",
        how:
          "Cash-flow positive is shown when the balance never reaches zero and ends the 24 months no lower than it began, so more comes in than goes out. Lasts past 24 months is shown when the balance never reaches zero but is still falling.",
      },
      {
        label: "If no money came in",
        meaning: "The small safety line under the heading: how long the money would last with no income at all.",
        how:
          "The same 24 months and the same costs, with every salary and income line left out and the Charity line as budgeted. It counts whole months from next month, like Runway, or says more than 24 months when the money outlasts the projection.",
      },
      {
        label: "Average monthly change",
        meaning: "How much drawable cash changes in an average future month: money in less money out.",
        how:
          "The balance at the end of month 24 minus today's Drawable, divided by 24. It always covers the 24-month window, whatever dates the plan itself has.",
      },
      {
        label: "Drawable over time",
        meaning: "The projected balance at the end of each month.",
        how:
          "Twenty-four points, one per month beginning with next month. Unlike the Dashboard curve, it does not start at today's balance and it keeps going below zero, so you can see how deep a shortfall gets. The red dashed line is zero.",
      },
    ],
    howTo: [
      {
        title: "Put your real income in",
        steps: [
          "Go to Settings, Salary.",
          "Under Current salary, pick Yearly base salary and type it with the month it starts, or pick Monthly pay into the bank and type the amount that hits the bank.",
          "If another salary comes in, add it under Additional salary: a W-2 salary, taxed with yours (on one return when married filing jointly, otherwise on its own single return), or a monthly amount.",
          "Press Save salary and come back here.",
        ],
      },
      {
        title: "See what a what-if does to your cash",
        steps: [
          "On What if, give the what-if a different salary, an additional salary, or costs.",
          "Turn it on in the top bar. This screen then uses its salary from its start month, or from your current salary's month when it has none of its own.",
          "Its costs count from the month its salary starts, or from next month when it has no salary of its own. A car or a mortgage takes its down payment out in that month, and its payments run for the loan's years. A one-time cost comes out once, in its own month.",
        ],
      },
    ],
    dataFrom:
      "The same accounts and synced balances as the Dashboard, the budget lines of the selected plan, and Settings, Salary. Balances are read once when the screen opens, so they are as fresh as the last bank sync. No transactions are read here: a projection of the future needs only balances, income and the budget.",
    limits: [
      "Saving for a goal is never in the forecast; a goal's ongoing cost is, under a what-if, when its row is switched on.",
      "A row switched off on What if is not in the forecast.",
      "A what-if's monthly costs carry no dates: each starts in the month described above and keeps going. A one-time cost is the exception: it names its month and comes out once, then. A month outside the 24 is not shown.",
      "Monthly pay into the bank and a monthly additional amount have no tax and no charity share worked on them; the Charity line stays as budgeted for them.",
      "With a scenario laid over the plan, this screen follows it, the same as the bar above, and says so under the heading.",
      "The projection looks 24 months ahead and no further, and it treats the rest of the current month as already paid for.",
    ],
  },
];
