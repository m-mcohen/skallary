// Help for the Dashboard. Drafted from what the code computes
// (src/ui/DashboardSection.tsx, NowSection.tsx, dashboard/ThisMonthCard.tsx, dashboard/GoalsCard.tsx,
// src/ui/lib/instrument.ts, src/domain/runway.ts, runway-projection.ts,
// server/services/trailingService.ts, src/domain/seed.ts). The user edits the
// words; if the behavior changes, change the matching sentence here with it.
// the month bar, a past month, and what stays today's.
// both same-days comparisons at once, both chart lines,
// no dropdown, and each top category by the same day last month.
// the new order (chart, spending and income side by side, Waiting on
// you, tiles, Recurring, Goals, budget cards), Top categories folds, and filings can be undone.
import type { HelpScreen } from "../types";
import { partner, partners } from "../household-words";

export const DASHBOARD_HELP: HelpScreen[] = [
  {
    key: "dashboard",
    title: "Dashboard",
    depth: "full",
    purpose:
      "How is this month going, how did an earlier month end, and how close am I to my goals? Spending so far this month against last month, what is left over, where the money went, what came in and from whom, each goal's progress, anything waiting on a decision from you, and the figures the budget rests on. The month bar at the top switches to an earlier month to see how it ended, with its budget against what you spent. How long the money lasts is on the Forecast screen.",
    answers: "How is this month going, how did an earlier month end, and how close am I to my goals?",
    termIds: ["month-bar", "budget-against-actual", "drawable", "burn", "held-back", "trailing-spending", "spent-this-month", "same-days", "baseline", "net-cash-flow", "money-put-away", "ledger", "recurring-mark", "re-seed", "fully-saved", "mark-complete", "needs-sign-in", "no-new-data"],
    numbers: [
      {
        label: "Month bar",
        meaning: "Which month the Dashboard shows: this month, or an earlier month to see how it ended.",
        how:
          "Previous month and Next month step one month at a time; This month comes back to today's month and shows only on an earlier month. Previous month stops at the first month with transactions, and Next month stops at this month: there are no future months. The month you pick goes into the link, so the back button and a refresh keep it. On an earlier month, the spending, income and recurring cards show that whole month, and the spending card adds Budget against actual. Goals, Waiting on you and the tiles below them stay today's figures and say As of today, because a balance or a goal's progress has no earlier value here.",
      },
      {
        label: "Spending by day",
        meaning: "This month's spending as a running total, day by day, against last month and the average month, or whatever you tick in Compare with.",
        how:
          "Each point is spending from the 1st through that day, counted the same way as Spent this month, so this month's line ends on that figure. Compare with, on this card and on This month so far, picks the lines; both cards share one choice, remembered in this browser. At first it shows three lines, each named in the legend under the chart: this month (solid, in the main color), last month (solid, in a second color, named by the month) and the average month of the last 12 months (dashed blue). You can also tick the same month last year (solid orange, named by the month and year) and the average month of the last 3 months (dashed purple). Last month runs from its 1st through each day; a day it did not have carries its total. The average month is the 12 full months before this one, each from the 1st through that day (or its last day, if shorter), added up and divided by 12, so on today's day it equals 12-month average, same days and on Day 31 it equals Average spent, last 12 months. The 3-month average is worked the same way over the 3 full months before this one. A line is left off when the history does not reach back far enough. The dot marks today. On the month's last day this month's line carries its total to Day 31, so it ends level with the whole comparison months. On an earlier month the line runs the whole month and the dot marks its last day.",
      },
      {
        label: "Spent this month",
        meaning: "What you have spent from the 1st through today, and how that compares with the same days of last month and of the average month, or of whatever you tick in Compare with.",
        how:
          "Spending dated the 1st through today, counted the same way as Average spent, last 12 months. A line beneath compares it with each comparison ticked in Compare with; at first, last month and the 12-month average. Last month, same days is spending from the 1st through the same day of last month (a day last month did not have counts as its last day), with its dates. The same month last year, same days, is that month a year ago from its 1st through the same day, with its dates. 12-month average, same days is the 12 full months before this one, each from the 1st through that day, added up and divided by 12; 3-month average, same days is the same over the 3 full months before. Each shows the figure, the change in dollars and the change in percent; more spending is marked unfavorable. Spent this month, last month's figure and last year's figure open their ledgers. The averages are not links, because each is several separate stretches of days; Average spent, last 12 months opens its months. When the history does not reach back far enough, a line says so instead of comparing against nothing. On the month's last day the month is whole, so every line compares whole months: Last month, whole month and 12-month average, whole month. See by category in Reports opens Reports on the same days, compared with the 3-month average category by category. On an earlier month it reads Spent in that month: the whole month, compared with the whole month before it and the whole average month.",
      },
      {
        label: "Left over so far",
        meaning: "What came in this month, less what was spent, so far.",
        how:
          "Income plus investment income, less spending, for the 1st through today. Money moved into or out of savings is not part of it: the line under it names that move (Put into investments, or Taken from investments) and opens those rows. It is the Left over figure the Reports cash flow table shows for this month. On an earlier month it reads Left over: the whole month.",
      },
      {
        label: "Top categories",
        meaning: "The five categories you have spent the most on so far this month, and what each had by the same day last month.",
        how:
          "It starts folded to one line: the three biggest with their amounts, and how many more. Press Top categories to open the full list; open or folded is remembered in this browser. Spending only, largest first, from the same rows as Spent this month. A category whose refunds outweigh its spending is left out. Under each amount, Last month is that category's spending from the 1st through the same day of last month, the same days as Last month, same days. A category with nothing on those days reads $0.00. Each amount opens its ledger, and so does Last month, listing that category's rows on those days. On an earlier month the smaller line is the whole month before, named by the month, for example July for August.",
      },
      {
        label: "Budget against actual",
        meaning: "On an earlier month: what the budget allowed for that month, what you spent, and whether you were under or over.",
        how:
          "The budget for the month is every cost line's amount for that month, the same lines Monthly budget adds up, with a one-month amount in place of the usual one where you set one; income lines are left out. Spent is the month's Spent figure. Under budget is the budget less what you spent; Over budget is shown in red. It uses the budget as it is saved today: the app keeps no record of what a line said in an earlier month, apart from one-month amounts. A what-if never changes it.",
      },
      {
        label: "Income this month",
        meaning: "What has come in from the 1st through today, how that compares with last month, and who it came from.",
        how:
          "Income dated the 1st through today, counted the same way as Reports. The line beneath compares it with the same days of last month, or with all of last month on the last day of a month; more income is marked favorable. Top sources are your biggest payers so far, named as your bank names them. What your investments paid, such as interest and dividends, is its own line and is not part of the income figure. Every amount opens its ledger. On an earlier month it reads Income in that month: the whole month, compared with the whole month before it.",
      },
      {
        label: "Waiting on you",
        meaning: "Things that need a decision: transactions with no category, and a budget that is due to be refreshed. Review all uncategorized transactions, right under it, opens the full list on Transactions.",
        how:
          "The count is every uncategorized transaction, plus one when the budget was last built from spending more than 90 days ago or never. A transaction is uncategorized when no rule, transfer match, or correction of yours has given it a category. The list shows the first 20; the count covers all of them.",
      },
      {
        label: "Drawable",
        meaning: "The money you could actually spend from today.",
        get how() {
          return `Add the latest synced balance of every account that counts, and subtract every credit card balance. An account is left out if it is switched off under Settings, Accounts, archived, has no type, or belongs to ${partner()} alone while ${partners()} accounts are left out. Retirement accounts, loans and mortgages start out not counted; the Drawable switch under Settings, Accounts can change that for anything except a card. An account with no synced balance counts as zero. Accounts shows the accounts that make it up.`;
        },
      },
      {
        label: "Monthly budget",
        meaning: "What the budget says a normal month costs. It is the plan, not what you actually spent. The bar at the top shows the same number.",
        how:
          "The sum of the usual monthly amount of every cost line in the budget. One-month changes are left out, because a one-month amount replaces the usual one rather than adding to it. While a what-if is on, this number includes it.",
      },
      {
        label: "Held back",
        meaning: "Retirement money, shown so you can see it while it stays out of Drawable.",
        how:
          "The sum of balances for retirement accounts that are not counted toward Drawable. An account is a retirement account by its type, or by a whole word in its name such as IRA, Roth, 401k or pension. A retirement account you switched on as drawable is counted in Drawable instead, never in both. The Held back group on Accounts uses the same rule.",
      },
      {
        label: "Average spent, last 12 months",
        meaning: "What you actually spent in an average month over the last 12 complete months.",
        how:
          "Total spending in the 12 calendar months before this one, divided by 12. Transfers between your own accounts and all income are left out. Refunds reduce the category they belong to. Transactions on accounts switched off for spending are left out. Pending transactions are included. Uncategorized transactions still count as spending. Click the figure to open the ledger of those 12 months; it shows the total and the division.",
      },
      {
        label: "Recurring",
        meaning: "What recurring charges still have to take this month (or next), and what they already took.",
        how:
          "The same recurring charges the Recurring screen lists, for the month you pick. Remaining due adds each date still to come and each date already passed with no charge seen, at the usual amount; Paid rows are the real charges already made this month. A charge that missed a date before this month is not counted. Card payments and transfers are never recurring charges. Each name opens its payments. At most 8 rows; See all recurring opens the Recurring screen. On an earlier month it lists what recurring charges were paid in that month, with their total; nothing is still to come in a month that is over.",
      },
      {
        label: "Goals",
        meaning: "Each active goal's savings target and date, its progress, and what it needs a month to finish by its date.",
        how:
          "The same figures the Goals screen shows. Each goal leads with its savings target and date; the smaller line is what it needs a month. Progress is what the goal has saved, from its linked accounts plus anything saved outside them, divided by its target. The monthly figure is what is left to save, spread over the months from this one through the target month. A goal whose savings reached the target reads Fully saved; one you marked complete reads Completed; a goal with no date reads Needs a target date.",
      },
      {
        label: "Fixed costs (budget)",
        meaning: "The part of the monthly budget that is fixed costs.",
        how:
          "The sum of the usual monthly amounts of budget lines marked as a fixed cost. A line is marked automatically when it had spending in more than half the months of the period the budget was last built from. You can set the mark yourself in the Fixed cost column of the Budget table, and your choice is never overwritten.",
      },
      {
        label: "Variable costs (budget)",
        meaning: "Everything in the monthly budget that is not a fixed cost.",
        how: "The sum of the usual monthly amounts of lines not marked as a fixed cost. Fixed costs plus Variable costs equals Monthly budget.",
      },
      {
        label: "Synced, rules, Reviewed, accounts",
        meaning: "The line at the bottom says how fresh everything is.",
        how:
          "Synced is the last successful bank sync. Rules is how many categorization rules exist. Reviewed is the last time you applied Set up budget, and turns red and reads Review due after 90 days. Accounts is how many accounts are not archived.",
      },
    ],
    howTo: [
      {
        title: "See how an earlier month ended",
        steps: [
          "Press Previous month beside the month name at the top. Each press goes back one month, as far as the first month with transactions.",
          "Read the spending card: the whole month's spending, what was left over, the top categories, and Budget against actual.",
          "Press This month, or Next month until you reach it, to come back. Figures marked As of today did not change while you looked.",
        ],
      },
      {
        title: "Check the month",
        steps: [
          "Read Spending by day: this month against last month and the average month, day by day; Compare with adds last year or the 3-month average.",
          "Read This month so far beside Income this month: what you have spent against the same days of last month and of the average month, and what is left over.",
          "Open Top categories (it starts folded to one line) and compare each amount with its Last month line: what that category had by the same day last month.",
          "Click a category's amount, or its Last month figure, to see the transactions behind it.",
          "Click Left over so far to see every row that made it up.",
        ],
      },
      {
        title: "Give a waiting transaction a home",
        steps: [
          "In Waiting on you, find the transaction.",
          "Click File as and type to narrow the list. Before you pick, you can type a Note for this transaction, and tick This repeats (with How often) if the charge comes back regularly.",
          "Pick a category; type a new name and choose Create if none fits; or pick Transfer (not spending) if the money only moved between your own accounts.",
          "The app saves a rule for that payee. Every uncategorized transaction from that payee, past and future, now files the same way.",
          "A message at the bottom says what was filed. Press Undo within about 10 seconds to put everything back as it was. Later, use Recent categorizations on Transactions, which keeps the last 30 days. Undo leaves your note in place.",
        ],
      },
      {
        title: "Review the budget against recent spending",
        steps: [
          "In Waiting on you, press Review your budget. It opens Set up budget on the Budget screen.",
          "Each line shows its suggested amount beside its current one; changes start ticked, and lines you set yourself start unticked. Nothing changes until you apply.",
          "Apply, or Keep as is with nothing ticked, counts as the review. Forecast, Monthly budget, Fixed costs, Variable costs and Salary needed move with any change.",
        ],
      },
      {
        title: "Find out why Drawable moved",
        steps: [
          "Open Accounts and compare the group totals with what you expect.",
          "Look under Not counted for an account that should count. If it is there, fix its type under Settings, Bank connection or its switches under Settings, Accounts.",
          "Press Sync in the top bar if the balances look old. The Synced date at the bottom tells you how old they are.",
        ],
      },
    ],
    dataFrom:
      "Balances come from the SimpleFIN bank sync. It runs by itself when you open the app if the last sync is more than 12 hours old, and whenever you press Sync. A bank that needs a sign-in or has sent no new data for more than 3 days is named in red beside Synced at the bottom. Older transaction history comes from an earlier import, and recent history from the SimpleFIN bank sync. The budget is the first plan in the app. Goals come from the Goals screen. Everything on this screen is read fresh when the screen opens and after each action you take on it.",
    limits: [
      "Top categories counts spending only; income, saving and transfers are left out.",
      "Goals are for tracking. Nothing on the Goals card changes the budget or the runway.",
      "While a what-if is on, only Monthly budget includes it; Fixed costs and Variable costs stay the budget before the what-if, and every other figure reads the real numbers.",
      "Today and this month follow your computer's own calendar date, so the month changes at midnight where you are.",
      "A what-if never changes a past month: an earlier month shows what happened, and its budget is the budget as saved, never a what-if.",
      "On an earlier month, Goals, Waiting on you, Drawable, Monthly budget, Held back, Average spent, last 12 months, Fixed costs and Variable costs are today's figures, marked As of today.",
      "An earlier month's recurring charges are the ones the app recognizes as recurring today; a charge you have since marked Not recurring is left out.",
    ],
  },
];
