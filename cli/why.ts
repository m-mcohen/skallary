// cli/why.ts -- the story of the name, as a short show in the terminal.
//
// Run as `skallary why` (or `cli\finance.cmd why`). Not listed in any help text.
// In a live terminal of at least 80 x 22 it plays five scenes full-screen, then leaves a card
// printed. A smaller window: the card only. Piped, redirected or NO_COLOR: the card in plain text.
// Space or Enter: next scene. Esc or any other key: skip to the end. Ctrl+C: quit.

// The words and the scenes live in src/why/show.ts (edit the words there); this file only draws
// them in a terminal.
import { DIM, FRAME_MS, Show, WHY_TEXT, WHITE, bigRows, shimmer, type Grid, type RGB } from "../src/why/show.js";

const ESC = "\x1b[";
const ESCAPES = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const fgc = ([r, g, b]: RGB) => `${ESC}38;2;${r};${g};${b}m`;
const bgc = ([r, g, b]: RGB) => `${ESC}48;2;${r};${g};${b}m`;

/** The card left in the terminal. Plain: no color codes at all. */
export function whyCard(plain: boolean): string {
  const lines = [
    "",
    ...bigRows("SKALLARY").map((r) => "  " + [...r].map((c, x) => (c === " " ? " " : fgc(shimmer(x, 0)) + c)).join("") + `${ESC}0m`),
    "",
    ...WHY_TEXT.ending.map(([tone, s]) => (tone ? `${fgc(tone === "white" ? WHITE : DIM)}  ${s}${ESC}0m` : "")),
    "",
    "",
  ].join("\n");
  return plain ? lines.replace(ESCAPES, "") : lines;
}

/** The grid as one terminal frame: home the cursor, then every row with its colors. */
export function toAnsi(g: Grid): string {
  let buf = `${ESC}H`;
  for (let y = 0; y < g.h; y++) {
    let last = "";
    for (let x = 0; x < g.w; x++) {
      const f = g.fg[y][x], b = g.bg[y][x];
      const key = `${f}|${b}`;
      if (key !== last) { buf += `${ESC}0m` + (f ? fgc(f) : "") + (b ? bgc(b) : ""); last = key; }
      buf += g.ch[y][x];
    }
    buf += `${ESC}0m` + (y < g.h - 1 ? "\n" : "");
  }
  return buf;
}

/** True when a terminal this size can hold the show. 22 lines: a maximized window on a 1280 x 800 screen has about 24. */
export function fitsShow(columns: number, rows: number): boolean {
  return columns >= 80 && rows >= 22;
}

export async function runWhy(opts: { forceStatic?: boolean } = {}): Promise<void> {
  const stdout = process.stdout;
  const tooSmall = !fitsShow(stdout.columns || 0, stdout.rows || 0);
  if (opts.forceStatic || !stdout.isTTY || process.env.NO_COLOR || tooSmall) {
    const plain = !stdout.isTTY || !!process.env.NO_COLOR;
    if (stdout.isTTY && tooSmall && !opts.forceStatic) stdout.write("(Make the window bigger to see the full show.)\n");
    stdout.write(whyCard(plain));
    return;
  }
  await playShow();
  stdout.write(whyCard(false));
}

async function playShow(): Promise<void> {
  const out = (s: string) => process.stdout.write(s);
  const show = new Show({
    w: Math.min(process.stdout.columns || 80, 110),
    h: Math.min((process.stdout.rows || 24) - 1, 30),
    hint: "space: next   esc: skip all",
  });

  // ---------- controls and cleanup ----------
  let inAlt = false;
  let wake: (() => void) | null = null;
  const sleep = (ms: number) => new Promise<void>((r) => {
    const t = setTimeout(() => { wake = null; r(); }, ms);
    wake = () => { clearTimeout(t); wake = null; r(); };
  });
  const restore = () => {
    if (inAlt) { out(`${ESC}?1049l`); inAlt = false; }
    out(`${ESC}0m${ESC}?25h`);
    if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch { /* already closed */ } process.stdin.pause(); }
  };
  const onExit = () => restore();
  process.on("exit", onExit);
  const onKey = (d: Buffer) => {
    const k = d.toString();
    if (k === "\x03") { restore(); process.exit(130); }
    if (k === " " || k === "\r" || k === "\x1b[C") show.next(); else show.skipAll();
    wake?.();
  };
  if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on("data", onKey); }

  out(`${ESC}?1049h${ESC}?25l`); inAlt = true;
  try {
    while (!show.done) {
      show.tick(Date.now());
      out(toAnsi(show.grid));
      if (!show.done) await sleep(Math.max(1, Math.min(FRAME_MS, show.nextAt - Date.now())));
    }
  } finally {
    restore();
    process.removeListener("exit", onExit);
    if (process.stdin.isTTY) process.stdin.removeListener("data", onKey);
  }
}
