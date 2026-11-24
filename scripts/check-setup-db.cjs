"use strict";

try {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  db.close();
} catch {
  console.error("Skallary could not load its database. Use 64-bit (x64) Node.js 22 or newer on Windows, then run npm run setup again.");
  process.exitCode = 1;
}
