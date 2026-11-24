# Contributing to Skallary

Skallary is a Windows budgeting app. The React interface talks to a
local Node.js server, which stores data in SQLite.

## Build and run

Use 64-bit Node.js 22 or newer. From the repository root in PowerShell:

1. Run `npm ci` to install the locked dependencies.
2. Run `npm run build` to type-check and build the interface.
3. Run `.\scripts\start-sample.cmd` to open the app with invented data. To stop
   it, close the sample's minimized console window.

Use the sample for manual checks. Keep sample data and test fixtures invented.
Keep personal information and credentials out of code, fixtures, logs, and
pull requests.

## Check changes

Run these commands from the repository root. The Node option keeps Node 26's
built-in storage from interfering with tests that simulate a browser.

```powershell
$env:NODE_OPTIONS = "--no-experimental-webstorage"
npm run typecheck
npm test
```

Test the changed behavior at the simplest level that proves it. For a new test,
temporarily undo the corresponding fix, check that the test fails for the
expected reason, and restore the fix.

## Code and database conventions

- Keep calculation and validation in the shared domain code when possible.
- Write interface labels and help in plain language that explains what users
  can do and what will happen.
- Add schema changes in a new, uniquely numbered migration in `migrations/`.
  Keep migrations additive and schema-only. Use application code for data changes.
  Keep existing migrations and their numbers intact.
- Test that a new migration applies to a fresh database and that applying the
  migrations again makes no further changes.
