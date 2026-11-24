import type { NextFunction, Request, Response } from "express";


export const DEFAULT_PORT = 4321;

/**
 * FINANCE_PORT lets a second instance (a build lane on a database copy) run
 * beside the live app. Anything that is not a whole number from 1024 to 65535
 * falls back to the default, so a typo can never bind NaN or a privileged port.
 */
export function resolvePort(env: Record<string, string | undefined>): number {
  const raw = env.FINANCE_PORT;
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_PORT;
  const n = Number(raw);
  return n >= 1024 && n <= 65535 ? n : DEFAULT_PORT;
}

export const PORT = resolvePort(process.env);

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Require the local address even on reads and requests without an Origin. */
export function originGuard(req: Request, res: Response, next: NextFunction): void {
  const port = req.socket.localPort;
  const host = req.headers.host?.toLowerCase();

  // Validate Host on every method to protect against DNS rebinding.
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    res.status(403).json({ ok: false, error: "forbidden origin" });
    return;
  }

  const origin = req.headers.origin;
  const wrongWriteOrigin = !READ_METHODS.has(req.method) && origin !== undefined && origin !== `http://${host}`;
  if (req.headers["sec-fetch-site"] === "cross-site" || wrongWriteOrigin) {
    res.status(403).json({ ok: false, error: "forbidden origin" });
    return;
  }

  next();
}
