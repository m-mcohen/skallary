// Help for the screens that get the short treatment: what the screen is for,
// plus three to five key terms. A few carry one to three
// limits where the screen has a real trap, such as a delete with no
// confirmation. Drafted from what the code does; keep the words in step with the behavior.
import type { HelpScreen } from "../types";
import { partners } from "../household-words";

export const SHORT_HELP: HelpScreen[] = [
  {
    key: "getting-started",
    title: "Getting started",
    depth: "short",
    purpose:
      "The app answers one question from many angles: how long does the money last, and what would change that? The sidebar is grouped by what each screen is about. Record is what actually happened: balances, transactions, reports and net worth. Plan is what you intend: the budget, recurring charges, goals and the wish list. Model is what would change the picture: What if and Forecast. The bar at the top of every screen is one statement that adds up: what lands in the bank, less the charity pot put away (while one is on), less the budget, equals left over, for this month or the year (switch with Month and Year). Spent so far sits under the budget. Drawable is on the Dashboard; Salary needed and Take-home needed are on What if. How long the money lasts, the runway, has its own screen: Forecast, under Model. Press Help in the top bar on any screen for that screen's article, or press the small i beside a number for its definition.",
    termIds: ["into-the-bank", "maaser-put-away", "spent-so-far", "left-over", "runway", "drawable", "burn", "budget-of-record", "overlay", "real-numbers", "salary-needed", "take-home-needed"],
    limits: [
      "Every projection looks 24 months ahead and begins with next month.",
      "Your income lives in Settings, Salary. The Forecast screen runs it against the budget's costs, and also says how long the money would last if nothing came in.",
      "A what-if never changes the real budget. Only the menu in the top bar turns one on, and the app always opens on Real numbers.",
    ],
  },
  {
    key: "accounts",
    title: "Accounts",
    depth: "short",
    purpose: "Everything you have, on one page. On top, net worth: what all your tracked balances add up to today, and a line of how that total has moved, with the change since the first point drawn. Below, every account in folding groups the way a balance sheet groups them: cash, taxable investments and cards make up Drawable; retirement is held back. The Summary card beside them adds the groups up to Drawable and All holdings. To change which accounts count, use Settings, Accounts.",
    answers: "What do I have, how much of it can I spend, and is it going up or down?",
    termIds: ["net-worth", "drawable", "held-back", "balance-reading", "period"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Read the headline: today's tracked total, and beside it the change since the first point drawn.",
          "Read the line: a point for each day the banks were read. Pick the period in the top bar to choose how far back it draws.",
          "Click a group's name to fold it shut or open it again.",
          "Compare the group totals in the Summary card with what you expect. If an account that should count sits under Not counted, fix it under Settings, Accounts or Settings, Bank connection.",
          "Press Sync in the top bar if a balance looks old.",
        ],
      },
    ],
    get limits() {
      return [
      "Balances are the latest sync, not live. Press Sync in the top bar if they look old.",
      "The line starts on the first day the app kept a reading of every account. Earlier days are left off: working them back from transactions was tried and was not reliable, because investment accounts do not show market gains or every transfer as transactions.",
      "A day's point uses each account's latest reading by that day; an account not read again keeps its last reading. The change beside the headline runs from the first point drawn to the last.",
      `Archived accounts are left out, because a live account already reports the same money. ${partners(true)} own accounts count toward net worth only while the switch to include them is on. Card and loan balances always subtract.`,
      ];
    },
  },
  {
    key: "settings.accounts",
    title: "Settings: Accounts",
    depth: "short",
    purpose: "Which accounts count, and toward what: their transactions toward spending, and their balances toward the cash you can draw on.",
    answers: "Which accounts count toward spending and toward cash I can use?",
    termIds: ["owner", "counted", "drawable-switch", "always-subtracted", "archived-account"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Find the account in the table.",
          "Set its Owner, and switch Counted, Drawable or Money put away as it should be.",
          "Switch Archive on for a superseded record; its transactions still count, its balance stops counting.",
        ],
      },
    ],
    get limits() {
      return [
      `The Drawable switch can show on while the balance still does not count. That happens when Counted is off, when the account has no type, or when it is one of ${partners()} own accounts and those are left out.`,
      "Archiving an account that holds a balance lowers Drawable, because an archived balance never counts.",
      "An account's type is set under Settings, Bank connection. Once a type is confirmed, no screen changes it.",
      ];
    },
  },
  {
    key: "transactions.all",
    title: "Transactions: All",
    depth: "short",
    purpose: "What happened, row by row, and how each row was categorized. The period in the top bar chooses the dates. The line above the table totals only the rows on screen. Opened from a figure on another screen, this list is that figure's ledger, with a header that names it. The Merchant column shows each merchant's name after your renames under Settings, Merchants; click it to open that merchant's page, and point at it to see the bank's own name. To file a row, click its category, type to narrow the list, and pick; a name no category has can be created right there, and the switch under the list decides whether the choice also becomes a rule for that payee. Inside the same list you can type a Note and tick This repeats. The note icon beside the merchant is filled when a row has a note: point at it to read the note, click it to write or change one. The search box searches notes too. The repeat button under the Recurring heading marks a merchant recurring on that account. After each filing a message offers Undo, and Recent categorizations lists the last 30 days of filings, each with Undo.",
    answers: "What exactly did I spend and earn, row by row?",
    termIds: ["planning-category", "transfer", "rule", "correction", "ledger"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Pick the period in the top bar to choose the dates.",
          "Click a row's category, type to narrow the list, and pick, or type a new name and choose Create.",
          "Switch the box under the list on if the choice should also become a rule for that payee.",
          "To keep a note on a row, click its note icon, type, and press Save. An empty note removes it.",
          "Press Undo in the message at the bottom to take a filing back, or open Recent categorizations for anything filed in the last 30 days.",
        ],
      },
    ],
    limits: [
      "Undo takes back a filing made from the category list in the last 30 days, and leaves its note alone. An older correction, or a rule made under Settings, cannot be undone here: correct the same row again and the later correction wins, or delete the rule under Settings.",
      "This list shows transactions from accounts that are not counted, while the budget leaves them out. Its totals can differ from the budget's.",
      "Picking a category on a row with no category files every transaction from that payee the same way, past and future.",
      "While a charity pot is on, its column carries two marks. On a gift row, Counts toward the pot switched off keeps the row in Charity for spending and taxes but leaves it out of the pot's ledger. On an income row of a pot that is a share of pay, Income for the pot can leave the row out of the ledger or count only part of it. The row itself never changes.",
    ],
  },
  {
    key: "transactions.needs-category",
    title: "Transactions: Needs a category",
    depth: "short",
    purpose: "The transactions that still have no category after every rule and correction has run. It is the same list as All with one filter switched on.",
    answers: "Which transactions still need a category?",
    termIds: ["needs-a-category", "rule", "transfer"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Find a row in the list.",
          "Click File as, type to narrow the list, and pick a category, or pick Transfer if the money only moved between your own accounts.",
        ],
      },
    ],
    limits: [
      "A row with no category that was matched as a transfer stays hidden here unless you choose Show transfers.",
      "Uncategorized transactions still count as spending everywhere until you file them.",
    ],
  },
  {
    key: "reports",
    title: "Reports",
    depth: "short",
    purpose: "How much you spent or earned over the period and where it went, what was saved, what was left over, and how the period compares with an earlier one. Four tabs: Spending, Income, Cash flow, and Left over. Spending and Income lead with the period total, then a chart, then every category ranked by its total with its share and its monthly average, then the same categories month by month. Group by Merchant ranks the same figures by who was paid instead, and a merchant's name opens its own page. Click any figure to see the transactions behind it.",
    answers: "How much went out, where did it go, over the period or one month of it, and how does it compare?",
    termIds: ["refunds-and-credits", "net-cash-flow", "saved", "investment-income", "compare-to"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Pick the period in the top bar, and what to compare it with.",
          "Choose a tab: Spending, Income, Cash flow, or Left over.",
          "Read the total at the top, then the ranked list: the biggest categories come first. Click Other to see the categories folded into it.",
          "Press Merchant beside Group by to rank by merchant instead of category. Click a merchant's name to open its page.",
          "Click any figure to open the transactions behind it.",
        ],
      },
      {
        title: "How to use the chart",
        steps: [
          "The chart fits the period: up to 31 days it is drawn by day, up to about 6 months by week, and longer by month. Day, Week and Month above it change that.",
          "Click a month or a week: it narrows the whole page to it. The total, the ranked list, the monthly table and every figure's transactions follow that month, and the chart draws it by day. Back to the whole period undoes it.",
          "Click a day to see that day's transactions.",
          "Stacked splits each column by category. Regular puts the same columns side by side, however many categories are chosen; choose fewer in the Show box to keep it readable.",
        ],
      },
      {
        title: "How to look at only some categories",
        steps: [
          "On Spending, type in the Show box and pick one or more budget lines. The total, the chart, the ranked list and the monthly table all follow.",
          "Press All categories to see everything again. The choice stays in the link and is remembered for your next visit.",
        ],
      },
    ],
    limits: [
      "The period in the top bar chooses the dates. A month the period cuts short shows only the days inside it and is marked with the day it runs through.",
      "On Spending, money that came back on a spending category (a return, a credit) is on its own line, Refunds and credits, so no category reads below zero. The total is the same as before: purchases less refunds.",
      "Share is a category's part of everything bought over the period, before refunds. Monthly average counts complete months only: a month the period cuts short, or the month not over yet, is in the total but not the average, so the average does not change every day. With no complete month yet there is no average, and it says so.",
      "While the page is narrowed to a month or a week, a comparison steps aside, because it is for the whole period; Back to the whole period brings it back. The narrowed month stays in the link, so a bookmark or Back from a ledger returns to it. Cash flow and Left over always show the whole period. A new period starts on the whole period.",
      "Only the 8 biggest categories get their own color; the rest are added together as Other.",
      "The comparison line on the chart shows only when the chart is by month.",
      "Transfers and transactions on accounts that are not counted are left out.",
      "A category is income when its name says so, not by the sign of the amount.",
      "Grouped by merchant, the category box still narrows first, so you can see Groceries by merchant. Money that came back still sits on its own line, Refunds and credits.",
    ],
  },
  // A page per merchant, under Reports, reached by a link.
  {
    key: "reports.merchant",
    title: "Reports: Merchant",
    depth: "short",
    purpose:
      "Everything about one merchant over the period in the top bar: what was spent there, with the purchases and refunds behind it, the monthly average, money received from it if any, the bank names behind it, a chart of spending by month, and its transactions. Open it from a merchant's name on Reports, grouped by merchant, or on Transactions.",
    answers: "How much goes to this merchant, month by month?",
    termIds: ["merchant", "rename", "refunds-and-credits"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Pick the period in the top bar.",
          "Read Spent and the monthly average, then the chart. Click a month to see its transactions.",
          "To change the name shown, or merge it with another name, follow Rename or merge merchants to Settings, Merchants.",
        ],
      },
    ],
    limits: [
      "The monthly average counts complete months only: a month the period cuts short, or the month not over yet, is in the total but not in the average, so the average does not change every day.",
      "Transfers between your own accounts and accounts that are not counted are left out of the figures. A note says how many and links to them.",
    ],
  },
  {
    key: "budget.month",
    title: "Budget: Month",
    depth: "short",
    purpose: "One month of the budget, line by line: what you planned, what you spent, what is left, and how it compares with the average month or any month you pick.",
    answers: "How is this month going against normal, line by line?",
    termIds: ["set-by-you", "suggested-amount", "same-days", "heading-over", "big-month"],
    howTo: [
      {
        title: "Reading a month",
        steps: [
          "Pick the month with the arrows and what to compare it with: the 12-month or 3-month average, last month, the same month last year, or a month you choose.",
          "Each line shows its budget, what you spent with a bar (the tick is the budget), what is left, the comparison and the change. Red means spending up or income down by more than $25 or 10%; blue the other way; grey is a small difference.",
          "Mid-month, every comparison counts the same days in each month, so the 20th is compared with the 20th.",
          "Lines with nothing in them are tucked away under Show lines with nothing in them.",
        ],
      },
      {
        title: "Changing a line",
        steps: [
          "Click a line to open its panel: 12 months of spending, its figures, its note for the month and its changes.",
          "Change budget offers the line's history to fill in, then asks which months: from a month on (something changed) or every month of the year (it was wrong all year). It shows Left over before and after before you save.",
          "Go back to suggested clears your changes on the line and returns it to the app's own amount; goal amounts stay.",
          "Add a big month plans a one-off cost (a trip, holiday gifts) on its line in its month, without raising the usual amount.",
          "Set up budget shows every line's suggested amount beside its current one, ticked where it would change, with the effect on Monthly budget, Left over and Salary needed before anything is applied.",
        ],
      },
    ],
    limits: [
      "Paychecks reads its budget from Settings, Salary. A month before your salary there starts has no Paychecks budget, so Income and Left over have none that month either.",
      "While a charity pot is on, Charity's budget is the larger of its own amount and the pot's month, as the Forecast counts it. What Charity spent is what reached a charity that month: gifts on your own cards and checking, plus gifts paid straight from the pot's account. Money set aside into that account, and money it pays back to you, are never spending, and the line is never red because of the pot. The line's panel shows the pot's ledger since your records begin, and each figure in it opens the transactions behind it.",
      "Months before this month are locked: their budget changes only through Every month of the year in Change budget, or when Set up budget or Go back to suggested sets a line's usual amount, and what you spent never changes.",
      "Saving lines are not on the Budget.",
    ],
  },
  {
    key: "budget.year",
    title: "Budget: Year",
    depth: "short",
    purpose: "The whole year on one screen: what each line spent in the finished months, with unusual months shaded, and the budget for the months still to come.",
    answers: "Which months were unusual this year, and what is planned for the rest of it?",
    termIds: ["unusual-month", "set-by-you", "big-month"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "A line separates the finished months from this month and the months ahead; months ahead show the budget in a lighter style.",
          "A shaded month spent well above or below that line's usual; darker shading means further from usual.",
          "Click a finished month to see the line's history and its note for that month. Click a month ahead to change the budget from that month on.",
          "From December 1, Start next year's budget appears on the Month tab. It opens Set up budget for the new year; nothing is created until you press its button.",
        ],
      },
    ],
    limits: ["The grid is not typed into; changes go through a line's panel.", "Income lines never shade."],
  },
  {
    key: "budget.charts",
    title: "Budget: Charts",
    depth: "short",
    purpose: "Month by month, does income cover spending, and how does the difference add up across the plan?",
    answers: "Where is the budget heading over the year?",
    termIds: ["forecast", "cumulative-surplus", "net-cash-flow"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Read the monthly chart for income against spending.",
          "Read Running total, left over for how the difference adds up across the plan.",
          "Go to Budget, Table to change a line if a month looks wrong.",
        ],
      },
    ],
    limits: [
      "The running total starts at zero in the plan's first month. It does not start from your account balances.",
      "With zero income in the budget, the running total falls in every future month.",
    ],
  },
  {
    key: "recurring.charges",
    title: "Recurring: Charges",
    depth: "short",
    purpose: "Which charges repeat and how often, what this month or next still has to come, what was already paid, and whether the budget plans for them. You can correct the list: Not recurring hides a charge, and Mark as recurring on Transactions adds one the app missed, as does ticking This repeats when you file a charge.",
    answers: "What is charged regularly, and what is still due this month?",
    termIds: ["recurring-series", "cadence", "typical-amount", "remaining-due", "recurring-mark"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Read Remaining due for this month, or pick Next month to look ahead.",
          "Open a charge's name to see every payment behind it.",
          "Press Not recurring on a charge that is not one. It moves to the Not recurring list, where Show again brings it back.",
          "To add a charge the app missed, press the repeat button on one of its payments on Transactions and pick how often it repeats.",
          "Check the two cards at the bottom for a recurring charge the budget does not plan for.",
        ],
      },
    ],
    limits: [
      "A charge drops off once it has gone a whole extra cycle past its next date, so a canceled subscription leaves by itself. A charge you marked comes back if its payments start again.",
      "Only money going out counts. Deposits, card payments and transfers are never recurring charges.",
      "A charge that missed a date before this month is not counted in this month's Remaining due; the list shows it as Missed.",
      "The same merchant on two cards at the same time is two charges. A card replaced by a new account record is joined into one charge when the old one stopped before the new one started.",
      "Remaining due uses each charge's usual amount; the real bill can differ.",
    ],
  },
  {
    key: "goals.goals",
    title: "Goals: Goals",
    depth: "short",
    purpose: "How much is saved toward each goal, whether you are on pace, and how much balance no goal has claimed yet. Each goal leads with its savings target. A goal can also carry an ongoing cost, such as a mortgage: it goes into your budget when you press Start this cost or Mark complete. Each goal's saving a month for What if is set up here, once: the line On What if on each card says what it saves there.",
    answers: "How close am I to each goal, and what does it save a month on What if?",
    termIds: ["entire-balance", "fixed-amount", "available-for-goals", "needed-per-month", "projected-finish"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Add a goal, give it a target amount and a target date.",
          "Link accounts to it, as either the entire balance or a fixed amount.",
          "Read Needed per month and Projected finish for whether you are on pace.",
          "To set what What if saves for the goal, type a Planned per month; leave it blank to save what the target date needs. The card's On What if line says which it is.",
          "To put a goal's ongoing cost in your budget, press Start this cost, or Mark complete when you have done the goal.",
        ],
      },
    ],
    limits: [
      "Archiving a goal releases its account links so other goals can use those balances. Link the accounts again if you unarchive it.",
      "Available for goals counts any cash or brokerage account that is switched on under Counted in Settings, Accounts, less what is owed on cards. Retirement accounts are shown on their own line, since a goal such as a down payment cannot use them without tax and a penalty; a retirement goal can still link one.",
      "A fixed amount keeps counting in full even if the account's balance later falls below it. Only the warning changes.",
      "A new goal arrives switched off in every what-if. Switch its saving or its ongoing cost on from the What if screen.",
    ],
  },
  {
    key: "goals.wishlist",
    title: "Goals: Wish List",
    depth: "short",
    purpose: "A list of one-time things you want to buy, each with its cost, in the order you would buy them, with the total at the bottom.",
    answers: "What do I want to buy, and in what order?",
    termIds: ["priority", "one-time-item", "what-if-cost"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Press Add item, and give the name and the cost.",
          "Drag a row by its handle to change the order: the top wish is served first. From the keyboard, press Space on the handle, move it with the arrow keys, and press Space again.",
        ],
      },
    ],
    limits: [
      "Delete asks first and cannot be undone.",
      "Nothing on this list reaches the Budget, the Forecast screen or the figures across the top.",
    ],
  },
  {
    key: "notes",
    title: "Notes",
    depth: "short",
    purpose: "The decisions and spending cuts you locked in, what Drawable and spending read at past points, and any open problems with the data. Nothing on this screen can be edited.",
    answers: "What have I already decided?",
    termIds: ["locked-decision", "spend-trim", "snapshot", "data-quality-flag"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Scroll the locked decisions and spend trims for what was already decided.",
          "Check snapshots for what Drawable and spending read at an earlier point.",
          "Check data-quality flags for any open problem with the data.",
        ],
      },
    ],
    limits: [
      "Snapshots are listed newest first.",
      "The two Average spent columns are average spending per month over the last 3 and 12 complete months. Rows a sync wrote before this was fixed held totals and were rescaled, so those older figures are approximate.",
    ],
  },
  {
    key: "settings.connection",
    title: "Settings: Bank connection",
    depth: "short",
    purpose: "Is the bank feed connected and current, which banks need you, does every account have a type, and which rules file your transactions? A bank that needs a sign-in, or has sent no new data for more than 3 days, is listed in red under Bank connection with what to do. Transactions no rule covers are filed on Transactions, Needs a category; this screen shows how many are waiting and links there. The rules list has a search box.",
    answers: "Is the bank feed working, which banks need you, and how are transactions sorted?",
    termIds: ["setup-token", "sync", "account-type", "rule", "learned-rule"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Check the connection status and each account's type.",
          "Search the rules list to find or check how a payee is filed.",
          "Follow the link to Transactions, Needs a category for what no rule covers.",
        ],
      },
      {
        title: "Fix a bank that needs you",
        steps: [
          "Read the red list under Bank connection: each bank, what is wrong, and what to do.",
          "Press Open SimpleFIN Bridge. The site opens in a new tab; sign in to that bank there.",
          "Come back and press Sync. The list, the red banner and the Dashboard line go once the bank sends new data.",
        ],
      },
    ],
    limits: [
      "Rebuild learned rules and deleting a rule both ask first, and neither can be undone.",
      "A setup token works once. The bank service also allows only about 24 requests a day.",
      "The bank service refreshes each account about once a day, so syncing more often fetches nothing newer.",
    ],
  },
  {
    key: "settings.mappings",
    title: "Settings: Mappings",
    depth: "short",
    purpose: "Which budget line each incoming category rolls up into. Type to narrow the list of planning categories, or type a new name and choose Create; saving the mapping is what makes a new planning category exist.",
    answers: "Which budget line does each incoming category land on?",
    termIds: ["source-category", "planning-category", "mapping"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Find the incoming category.",
          "Type to narrow the list of planning categories and pick one, or type a new name and choose Create.",
        ],
      },
    ],
    limits: [
      "A mapping cannot be deleted. To undo one, map the category back to its own name.",
      "Mapping several source categories to one name merges them, and a name containing the word income is treated as income.",
    ],
  },
  // The rename list and the suggested merges.
  {
    key: "settings.merchants",
    title: "Settings: Merchants",
    depth: "short",
    purpose:
      "Which bank names are the same merchant, and what each should be called. A rename shows a bank's name as another name on every transaction, past and future, and removing it undoes it. Suggested merges list pairs that may be one merchant; nothing changes until you press Accept or Dismiss. Zelle payments lose the reference code at the end of their name by themselves, so one person reads as one name. Nothing else is merged by itself: Amazon and Amazon Prime stay two merchants unless you merge them.",
    answers: "Which names are the same merchant, and what should each be called?",
    termIds: ["merchant", "rename", "suggested-merge", "old-zelle-payments"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Read Suggested merges. Press Accept to show the first name as the second, or Dismiss to keep the two apart for good.",
          "To rename a merchant yourself, pick the bank's name under Your renames, type the name to show, and press Save rename.",
          "To undo a rename, press Remove beside it and confirm. Show again brings back a dismissed suggestion.",
        ],
      },
      {
        title: "Show who sent or received a Zelle payment",
        steps: [
          "Under Names on Zelle payments, read how many payments are named just Zelle, how many people their notes name, and how many notes could not be read.",
          "Switch on Show names from Zelle payment notes. Reports, Transactions and the merchant pages show each by the person; the same person in the newer bank names is then offered as a suggested merge.",
          "Switch it off to show them all as Zelle again. Nothing in the transactions changes either way.",
        ],
      },
    ],
    limits: [
      "A rename changes only the name shown. Category rules and recurring charges still read the bank's name, so no category and no recurring charge moves.",
      "Some banks label a payment Zelle and put the sender or recipient in the transaction note. Show names from Zelle payment notes starts off. Check the count beside the switch before you turn it on.",
    ],
  },
  {
    key: "settings.salary",
    title: "Settings: Salary",
    depth: "short",
    purpose:
      "What you earn now, any additional salary, and the assumptions that turn a usual month's spending need into the yearly salary shown as Salary needed. The Forecast screen runs your current and additional salary against the budget's costs; Salary needed is your salary given the additional one.",
    answers: "What do I earn now, what comes out of each paycheck, and what does Salary needed assume?",
    termIds: ["current-salary", "additional-salary", "pay-schedule", "benefits", "child-credit"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Under Current salary, pick Yearly base salary and type it with the month it starts, or pick Monthly pay into the bank and type the amount that hits the bank.",
          "Under Additional salary, pick None, a W-2 salary (taxed with yours (on one return when married filing jointly, otherwise on its own single return)), or a monthly amount, with the month it starts.",
          "Under From your pay stub, a paycheck, pick how often you are paid: Weekly, Every two weeks, Twice a month or Monthly. Then type the federal income tax and the Social Security and Medicare from one paycheck, as the pay stub shows them, and any state and local taxes; under each box is what each comes to a month and a year. The tax boxes are there with a yearly base salary. Typed figures replace the estimate for those lines; anything still estimated is labelled as an estimate. Leave a box blank to keep a figure typed earlier, or to estimate when there is none; the grey text in a blank box says which. Press Save salary.",
          "Under Benefits, add one row per benefit you pay for: its name, the amount, a paycheck or a month, and Before tax, ticked unless it is taken after tax. Under the rows is what they come to a month and a year. Remove a row with Remove. Press Save salary.",
          "Under Tax, choose your filing status (single, married filing jointly, or head of household) and type the number of children, and press Save; the charity pot is set on the Charity card below it. Salary needed and Take-home needed, on every screen, use them right away. Until both are set, every estimated tax figure shows a Set this up card instead.",
        ],
      },
    ],
    limits: [
      "Firm tax figures are for your current salary only: the Forecast, the bank line here, and the verdict and Check a salary on that same salary use them. Salary needed, a what-if's own salary and any other salary the app tries keep estimated taxes, because a firm figure belongs to one salary. Every tax line says estimated or from Settings.",
      "Your benefits are used for every salary. With none typed, none come out of pay. A blank paycheck box returns to the estimate and its line says estimated. Clearing the children box is refused.",
      "A paycheck figure comes to a year as the paycheck times 52, 26, 24 or 12 paychecks a year, and to a month as that year divided by 12, to the cent. A year with an extra paycheck (27 every two weeks, or 53 weekly) is not counted.",
      "Benefits are used a month, so the yearly view's Benefits line is that month times 12, which can be a few cents off 26 or 52 paychecks of a benefit typed a paycheck.",
      "A tax figure typed earlier as a yearly amount stays in force and is said under its box until you type the paycheck figure that replaces it. A health premium typed earlier as a monthly amount shows as one row named Benefits, and stays as it was until you change a row and save.",
      "With a W-2 additional salary, the extra tax that salary adds stays estimated on top of your firm figures.",
      "Federal income tax is estimated from the 2026 federal tables for your filing status. State and local taxes are not estimated; type them from a pay stub. There are no deductions or credits beyond the standard deduction and the child credit.",
      "Monthly pay into the bank and a monthly additional amount have no tax and no charity share worked on them.",
      "When your salary is monthly pay into the bank, a W-2 additional salary is taxed as if it were the only wages, because your own wages are not known.",
    ],
  },
  // The household's names and the first-run interview's steps still to do.
  {
    key: "settings.household",
    title: "Settings: Household",
    depth: "short",
    purpose: "Who is in the household, and what is still to set up? Change your name or your partner's here, and pick up any step of the first-run interview you skipped.",
    answers: "Who is in the household, and what is still to set up?",
    termIds: ["owner", "counted", "setup-token"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Change a name and press Save. Leave the partner's name blank if it is just you.",
          "Under Still to set up, press Set this up beside a step to open it. When it is done you come back here.",
        ],
      },
    ],
    limits: ["Skipping a step never fills in a guess. Each screen that needs a skipped step says so, with a link to it."],
  },
  // The switch that hides the "This page
  // answers" line everywhere. Its own screen, so it
  // gets its own article and answers line like every other destination.
  {
    key: "settings.guide",
    title: "Settings: Guide",
    depth: "short",
    purpose: "Should every page say what it answers? A switch here turns the \"This page answers\" line on or off for every screen at once. The Help button and the Help section keep explaining each screen either way.",
    answers: "Should every page say what it answers?",
    termIds: ["page-answers", "help-panel", "info-point", "help-section"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Switch Show the guide line on or off. It applies to every screen right away.",
          "Open the Help button, or the Help section in the sidebar, any time for the full article, switch or no switch.",
        ],
      },
    ],
    limits: ["The switch only hides the one-sentence line at the top of a screen. It never removes an article from Help."],
  },
  // C6 (2026-11-21): the theme switch.
  {
    key: "settings.appearance",
    title: "Settings: Appearance",
    depth: "short",
    purpose: "Should the app use light or dark colors? Choose Light, Dark, or Match my computer, which follows your computer's setting as it changes.",
    answers: "Should the app use light or dark colors?",
    termIds: ["page-answers", "help-panel", "help-section"],
    howTo: [
      {
        title: "How to use this page",
        steps: [
          "Pick Light, Dark or Match my computer. The change applies to every screen and chart right away.",
          "Your pick is remembered. Match my computer is used until you pick one.",
        ],
      },
    ],
    limits: ["Match my computer is the default until you pick one."],
  },
  {
    key: "settings.about",
    title: "Settings: About",
    depth: "short",
    purpose: "Find the version of Skallary you are running, its software license, and the link to its source code.",
    answers: "Which version of Skallary am I running, and where is its source code?",
    termIds: ["software-license", "source-code", "setup-token"],
    howTo: [
      {
        title: "Find your version and the source code",
        steps: [
          "Read the version number under Skallary.",
          "Select See the source code to open the project in your browser.",
        ],
      },
    ],
  },
];
