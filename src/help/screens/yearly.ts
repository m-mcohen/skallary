// Help for Budget, Yearly costs: bills that come once or a few times a year, raises, and holiday calendars.
import type { HelpScreen } from "../types";

export const YEARLY_HELP: HelpScreen[] = [
  {
    key: "budget.yearly",
    title: "Budget: Yearly costs",
    depth: "short",
    purpose: "The bills that come once or a few times a year, and the raises you plan for a month or a holiday, so the budget sets money aside before they arrive.",
    answers: "Which yearly bills and raises is the budget planning for, and does any need an answer from you?",
    termIds: ["yearly-bill", "raise", "holiday-calendar", "big-month"],
    howTo: [
      {
        title: "Planning for a yearly bill",
        steps: [
          "Add a yearly bill with its name, who it is paid to, the budget line, the months it is due and what it costs. Leave the amount blank if you do not know it yet.",
          "Suggestions from your history lists bills that came about once a year in the spending you have recorded. Each shows the line's every-month amount before and after, and nothing joins the budget until you press Add.",
          "Take it out of the line lowers the line's usual monthly amount by the bill's share, so the bill is not counted twice. It is off for you when the share is larger than the line.",
          "Each due date shows where it stands in words. When a payment arrives the app matches it by the payee's name. Tick as paid and Pick the payment fix a match by hand.",
          "When a bill cost a different amount than planned, Accept the new amount plans next year with it.",
        ],
      },
      {
        title: "Raises and holidays",
        steps: [
          "A raise adds money to a line in one month, in the same month every year, or in the month of a holiday.",
          "Holidays come from the calendars switched on under Holiday calendars: the built-in US national holidays, or a calendar file (.ics) you import. A holiday that runs into a second month asks which month to count it in.",
          "When a calendar's dates run out, a raise tied to it keeps the last month it knew until you import a newer file.",
        ],
      },
    ],
    limits: [
      "The Hebrew calendar is not built in. To follow Jewish holidays, export them from a calendar app as an .ics file and import it.",
      "Yearly bills and raises show on the Month and Year tabs as their own rows. They can only be changed here.",
    ],
  },
];
