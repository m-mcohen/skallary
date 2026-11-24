// src/domain/setup-progress.ts -- the first-run interview's steps and how far a household
// has got through them,
// plus the value forms of the settings the interview's steps write.
export type SetupStepId = "household" | "pay" | "tax" | "charity" | "holidays" | "banks" | "accounts" | "filing";
export type SetupStepState = "done" | "skipped";
export type SetupProgress = Partial<Record<SetupStepId, SetupStepState>> & { finishedAt?: string };

/** The interview's steps, in the order it asks them. */
export const SETUP_STEPS: readonly SetupStepId[] = ["household", "pay", "tax", "charity", "holidays", "banks", "accounts", "filing"];

/** The app_settings key that holds the interview's progress. */
export const SETUP_PROGRESS_KEY = "setup_progress";

export function isSetupStepId(v: unknown): v is SetupStepId {
  return typeof v === "string" && (SETUP_STEPS as readonly string[]).includes(v);
}

export function isSetupStepState(v: unknown): v is SetupStepState {
  return v === "done" || v === "skipped";
}

/** The good entries of a progress value, and the first problem found (null when none). */
function readSetupProgress(raw: unknown): { progress: SetupProgress; problem: string | null } {
  const progress: SetupProgress = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { progress, problem: "The set-up progress is a list of steps." };
  let problem: string | null = null;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "finishedAt") {
      if (typeof value === "string" && !Number.isNaN(Date.parse(value))) progress.finishedAt = value;
      else problem ??= "The finish time is a date and time.";
    } else if (isSetupStepId(key)) {
      if (isSetupStepState(value)) progress[key] = value;
      else problem ??= "A step is either done or skipped.";
    } else {
      problem ??= "That is not a set-up step.";
    }
  }
  return { progress, problem };
}

/** Progress from untrusted input, or a plain message saying what is wrong. */
export function cleanSetupProgress(raw: unknown): SetupProgress | string {
  const { progress, problem } = readSetupProgress(raw);
  return problem ?? progress;
}

/** Stored progress: a bad entry is dropped and the good ones kept, so one bad entry never loses the rest. */
export function setupProgressFromStored(raw: unknown): SetupProgress {
  return readSetupProgress(raw).progress;
}

/** The steps not yet done (skipped ones included), in the interview's order. */
export function stillToSetUp(p: SetupProgress): SetupStepId[] {
  return SETUP_STEPS.filter((s) => p[s] !== "done");
}

/** The filing step's choice (`starter_filing`): choices a, b, c. */
export type StarterFiling = "standard-rules" | "categories-only" | "checklist";
export const STARTER_FILINGS: readonly StarterFiling[] = ["standard-rules", "categories-only", "checklist"];

export function isStarterFiling(v: unknown): v is StarterFiling {
  return typeof v === "string" && (STARTER_FILINGS as readonly string[]).includes(v);
}

/** Where the app opens (`launch_browser`). */
export interface LaunchBrowser { browser: "edge" | "chrome" | "default"; profile: string | null }
const BROWSERS: readonly LaunchBrowser["browser"][] = ["edge", "chrome", "default"];

/** A browser profile name: letters, digits, space, dot, underscore, hyphen; 1 to 64 characters. It reaches a command line, so nothing else is allowed. */
export function isSafeProfileName(name: string): boolean {
  return /^[A-Za-z0-9 ._-]{1,64}$/.test(name);
}

/** A launch browser from untrusted input, or a plain message saying what is wrong. */
export function cleanLaunchBrowser(raw: unknown): LaunchBrowser | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Choose the browser the app opens in.";
  const { browser, profile } = raw as Record<string, unknown>;
  if (typeof browser !== "string" || !(BROWSERS as readonly string[]).includes(browser)) {
    return "Choose Edge, Chrome, or your computer's default browser.";
  }
  if (profile !== null && profile !== undefined && typeof profile !== "string") return "The profile is a name, or blank for none.";
  const p = typeof profile === "string" && profile.trim() !== "" ? profile.trim() : null;
  if (p !== null && !isSafeProfileName(p)) return "A profile name uses only letters, numbers, spaces, dots, dashes and underscores (up to 64).";
  return { browser: browser as LaunchBrowser["browser"], profile: p };
}

/**
 * Where the interview picks up: the first of `steps` not answered at all, else the first one
 * skipped, else null (every step done). A reload mid-interview lands on the next new question,
 * not back on one the person chose to skip.
 */
export function resumeStep(p: SetupProgress, steps: readonly SetupStepId[]): SetupStepId | null {
  return steps.find((s) => p[s] === undefined) ?? steps.find((s) => p[s] !== "done") ?? null;
}
