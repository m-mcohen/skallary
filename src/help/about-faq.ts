interface AboutFaqEntry {
  question: string;
  answer: string;
  links?: readonly { label: string; href: string }[];
}

export const ABOUT_FAQ: readonly AboutFaqEntry[] = [
  {
    question: "What is SimpleFIN?",
    answer: "SimpleFIN is an open standard for sharing bank data with apps you choose, and access under it is read-only. SimpleFIN Bridge is the service that links your banks and passes your accounts and transactions to those apps. Skallary uses the Bridge. At the time of writing it costs $15 a year or $1.50 a month and covers up to 25 banks and 25 apps; check the Bridge's site for the current price.",
    links: [
      { label: "SimpleFIN Bridge", href: "https://beta-bridge.simplefin.org/" },
    ],
  },
  {
    question: "What is MX, and why does it come up?",
    answer: "The Bridge reaches your banks through MX, a large financial data company that many banks, credit unions and finance apps use to connect accounts. When you link a bank in the Bridge, you sign in on MX's connection screen, not in Skallary and not on SimpleFIN's servers.",
    links: [
      { label: "SimpleFIN security", href: "https://beta-bridge.simplefin.org/info/security" },
    ],
  },
  {
    question: "How does Skallary use it?",
    answer: "You create a setup token in the Bridge and save it in a text file in Skallary's data folder. Skallary trades that token once for a private access address, which it keeps in its database on your computer. After that it only asks the Bridge for your accounts and transactions. It never sees your bank usernames or passwords, and it cannot move money.",
  },
  {
    question: "Is it secure?",
    answer: "Reasonably, with limits worth knowing. You sign in to your banks inside the Bridge, never inside Skallary, so Skallary never holds your bank passwords. Access is read-only, the access address works like a key that stays on your computer, and you can turn it off in the Bridge at any time. The limits: anyone who can use your Windows account can open Skallary's data folder, so use a Windows password and treat backups as private. SimpleFIN and MX see the bank data they pass along. SimpleFIN's security page describes how they handle it, including a past incident.",
    links: [
      { label: "SimpleFIN security", href: "https://beta-bridge.simplefin.org/info/security" },
    ],
  },
  {
    question: "What else uses SimpleFIN?",
    answer: "Other free, open-source budgeting tools read the same data, including Actual Budget and Firefly III. One Bridge subscription can serve several apps at once.",
    links: [
      { label: "Actual Budget", href: "https://actualbudget.org/docs/advanced/bank-sync/simplefin/" },
      { label: "Firefly III", href: "https://docs.firefly-iii.org/tutorials/data-importer/simplefin/" },
    ],
  },
  {
    question: "How do I disconnect a bank or stop sharing?",
    answer: "In Settings, Bank connection, press Disconnect. Then, in SimpleFIN Bridge, turn off Skallary's access. Your budget and past transactions stay in Skallary.",
  },
  {
    question: "Does anyone else see my data?",
    answer: "Skallary has no server and no accounts. Your budget lives in a folder on your computer. The only things that leave it are the requests to the Bridge for your bank data and a request for public mortgage rates from the St. Louis Fed, which sends nothing about you.",
  },
  {
    question: "Does it work outside the United States?",
    answer: "No. Skallary is built for the US: the tax estimate, pay rules and built-in holidays are American.",
  },
  {
    question: "What if a bank stops syncing?",
    answer: "Banks sometimes ask you to sign in again. Open the Bridge and sign in to that bank; your other banks keep syncing. If Skallary says its access was turned off or expired, make a new setup token in the Bridge, save it in the token file, and press Reconnect. Your data is kept.",
  },
];
