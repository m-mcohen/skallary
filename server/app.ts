// server/app.ts
// Express app assembly: UI (Vite/React, proxied) -> API (this) -> Services -> Repository.
import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { routes } from "./api/routes.js";
import { originGuard } from "./security.js";

// server/app.ts -> repo root is one level up.
const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");

export function buildApp(): express.Express {
  const app = express();
  app.use(originGuard);
  app.use(express.json());
  app.use("/api", routes());

  // Production mode: serve the built frontend from the same Node server, so
  // `node --import tsx server/index.ts` alone serves UI + API on one port
  // with no Vite involved. Mounted AFTER /api so API routes always win.
  // If dist/ doesn't exist yet (e.g. dev, before a build), express.static
  // simply never matches and the server still boots and serves /api fine.
  app.use(express.static(DIST));

  // SPA fallback for client-side routing/deep links: any non-/api GET that
  // didn't match a static file returns index.html. The regex excludes /api
  // so API 404s never get swallowed into the SPA shell.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(join(DIST, "index.html"), (err) => {
      if (err) {
        res.status(err instanceof Error && "status" in err ? (err as { status?: number }).status ?? 404 : 404).end();
      }
    });
  });

  return app;
}
