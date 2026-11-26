// src/why/WhyOverlay.tsx -- the story of the name, played over the whole app window.
//
// Opened by holding the sidebar wheat (AppSidebar.tsx). The scenes come from show.ts, the same
// copy the terminal plays; this file only paints its character grid onto a canvas.
// Space, Enter, Right arrow or a click: next scene. Esc: close. Once the name is up, any key or a click closes.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Show, type Grid, type RGB } from "./show";

/** The app always plays the full-size show, scaled to fit the window. */
const COLS = 110, ROWS = 30;
/** A terminal cell is twice as tall as it is wide. */
const CELL_ASPECT = 2;
/** The font Windows Terminal draws the show in, so both look the same. Glyph width is about 0.6 em. */
const FONT_FAMILY = '"Cascadia Mono", Consolas, monospace';
const GLYPH_WIDTH_EM = 0.6;

/** Fades in under the name at the end; then any key or a click closes. */
export const WHY_END_HINT = "press any key to exit";
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

const css = ([r, g, b]: RGB) => `rgb(${r},${g},${b})`;

/** Block characters painted as rectangles, so neighbors meet with no seam: [x, y, w, h] as cell fractions. */
const BLOCKS: Record<string, [number, number, number, number]> = {
  "█": [0, 0, 1, 1], "▀": [0, 0, 1, 0.5], "▄": [0, 0.5, 1, 0.5], "▌": [0, 0, 0.5, 1], "▐": [0.5, 0, 0.5, 1],
};

/** Cell width in device pixels for the largest whole-pixel grid that fits the window. */
function cellWidth(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(1, Math.floor(Math.min(window.innerWidth / COLS, window.innerHeight / (ROWS * CELL_ASPECT)) * dpr));
}

function paint(ctx: CanvasRenderingContext2D, g: Grid, cw: number): void {
  const chh = cw * CELL_ASPECT;
  ctx.fillStyle = "rgb(0,0,0)";
  ctx.fillRect(0, 0, g.w * cw, g.h * chh);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const bg = g.bg[y][x];
    if (bg) { ctx.fillStyle = css(bg); ctx.fillRect(x * cw, y * chh, cw, chh); }
  }
  ctx.font = `${Math.round(cw / GLYPH_WIDTH_EM)}px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const c = g.ch[y][x], fg = g.fg[y][x];
    if (c === " " || !fg) continue;
    ctx.fillStyle = css(fg);
    const block = BLOCKS[c];
    if (block) {
      const [bx, by, bw, bh] = block;
      ctx.fillRect(x * cw + Math.round(bx * cw), y * chh + Math.round(by * chh), Math.round(bw * cw), Math.round(bh * chh));
    } else {
      ctx.fillText(c, x * cw + cw / 2, y * chh + chh / 2);
    }
  }
}

export default function WhyOverlay({ onClose }: { onClose: () => void }) {
  const [show] = useState(() => new Show({ w: COLS, h: ROWS, hint: "space: next   esc: close", endHint: WHY_END_HINT }));
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const advance = () => { if (show.atEnd || show.done) close.current(); else show.next(); };

  // Keys go to the show only. Capture phase on window, so the app's own shortcuts never see them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); close.current(); }
      // At the end any key closes; a key still held from skipping, or Shift or Ctrl alone, does not.
      else if (show.atEnd && !e.repeat && !MODIFIERS.has(e.key)) { e.preventDefault(); close.current(); }
      else if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); if (!e.repeat) advance(); }
    };
    window.addEventListener("keydown", onKey, true);
    box.current?.focus();
    // The page behind must not scroll, and its scrollbar must not sit on top of the show.
    const root = document.documentElement, overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey, true); root.style.overflow = overflow; };
  }, []);

  // The frame loop: tick the show against the clock, paint, repeat. Re-fits when the window resizes.
  useEffect(() => {
    const el = canvas.current;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = el?.getContext("2d") ?? null; } catch { ctx = null; } // no canvas (tests): controls only
    let cw = 0;
    const fit = () => {
      if (!el) return;
      const dpr = window.devicePixelRatio || 1;
      cw = cellWidth();
      el.width = COLS * cw; el.height = ROWS * cw * CELL_ASPECT;
      el.style.width = `${el.width / dpr}px`; el.style.height = `${el.height / dpr}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    const raf = window.requestAnimationFrame?.bind(window) ?? ((cb: FrameRequestCallback) => window.setTimeout(() => cb(Date.now()), 16));
    const cancel = window.cancelAnimationFrame?.bind(window) ?? window.clearTimeout.bind(window);
    let id = 0;
    const frame = () => {
      show.tick(Date.now());
      if (ctx) paint(ctx, show.grid, cw);
      if (!show.done) id = raf(frame);
    };
    id = raf(frame);
    return () => { cancel(id); window.removeEventListener("resize", fit); };
  }, [show]);

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-modal="true"
      aria-label="Skallary"
      tabIndex={-1}
      onClick={advance}
      className="fixed inset-0 z-100 flex cursor-default select-none items-center justify-center bg-black outline-none"
    >
      <canvas ref={canvas} aria-hidden />
    </div>,
    document.body,
  );
}
