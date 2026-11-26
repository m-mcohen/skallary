// src/why/show.ts -- the story of the name: the words and the five scenes, in one copy.
//
// The scenes draw into a grid of characters, each with a text color and a background color.
// Two renderers show that grid: the terminal (cli/why.ts, `skallary why`) and the app's overlay
// (src/why/WhyOverlay.tsx, hold the sidebar wheat). This file knows nothing about either.

// =====================================================================================
// THE WORDS. Edit anything in quotes below; nothing else in the file needs to change.
// Keep each line under about 90 characters so it fits on one line of the screen.
// =====================================================================================
export const WHY_TEXT = {
  // Scene 1: night to dawn over the field
  field: [
    "Grain was wealth before coins were.",
    "Every coin finds its way back to a field.",
  ],
  // Scene 2: grain weighed against a shekel
  scale: [
    "Shekel, from the root s-k-l: to weigh.",
    "It was a weight of grain before it was a coin.",
  ],
  // Scene 5: each word, then its note. Letters S, C, K and L light up in gold.
  // Keep SAKELLARIOS and SALARY: at the end of the scene they merge into SKALLARY.
  words: [
    ["SHEKEL", "Hebrew. From sh-k-l, to weigh."],
    ["SKILLING", "The old small change of Denmark, Norway and Sweden."],
    ["SHILLING", "England's money word for over a thousand years, and a coin from 1504 to 1971."],
    ["SCALE", "From the Old Norse skal, the weighing pan."],
    ["SCALA", 'Ladder, in Latin. In modern English, "wealth ladder", "climbing the ladder".'],
    ["SAKELLARIOS", "Byzantium's keeper of the palace treasury."],
    ["SALARY", "What this app is built around."],
  ] as [string, string][],
  // Scene 3: the granary
  granary: "Joseph filled the granaries in the good years to carry Egypt through the lean ones.",
  goodYear: "good year",
  leanYear: "lean year",
  survived: "and still standing",
  granaryEnd: "Skallary plans the good months for the expensive ones.",
  // Scene 4: the coin
  coin: [
    "Agrippa I, 41/42 CE: three ears of barley, struck on a coin.",
    "Grain on money is older than most money.",
  ],
  // Lines printed under the big SKALLARY left in the terminal at the end ("white" bright, "dim" grey).
  // Empty on purpose: the show tells the story, the name is all that stays.
  ending: [] as ["white" | "dim" | "", string][],
};
// =====================================================================================

export type RGB = readonly [number, number, number];
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: RGB; ch: string }

/** Milliseconds per frame; lower is faster motion. */
export const FRAME_MS = 22;
/**
 * A tick computes at most one second of frames. A slow screen still keeps real time, and after a
 * hidden tab (no ticks at all) the show resumes where it was instead of racing through the backlog.
 */
const MAX_CATCH_UP = Math.round(1000 / FRAME_MS);
const secs = (s: number) => Math.round((s * 1000) / FRAME_MS);
const HOLD = secs(3); // three seconds of stillness after the last line types out

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
export const lerp = (a: RGB, b: RGB, t: number): RGB => {
  const k = clamp01(t);
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
};
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const BRONZE: RGB = [139, 88, 31], GOLD: RGB = [224, 172, 83], BRIGHT: RGB = [255, 214, 120], STALK: RGB = [150, 135, 60];
const SOIL: RGB = [70, 45, 22], SOIL_TOP: RGB = [96, 62, 30], FADED: RGB = [45, 45, 45];
export const DIM: RGB = [120, 120, 120], WHITE: RGB = [235, 235, 235];
const FLASH: RGB = [255, 248, 225], SUN: RGB = [255, 196, 92], BLACK: RGB = [0, 0, 0];
const NIGHT_TOP: RGB = [6, 8, 24], NIGHT_LOW: RGB = [18, 18, 46], DAWN_TOP: RGB = [60, 96, 160], DAWN_LOW: RGB = [236, 160, 86];
export const shimmer = (c: number, f: number) => lerp(BRONZE, BRIGHT, 0.5 + 0.5 * Math.sin((c - f * 1.6) / 5));

const FONT: Record<string, string[]> = {
  S: [" ████", "█    ", " ███ ", "    █", "████ "], K: ["█   █", "█  █ ", "███  ", "█  █ ", "█   █"],
  A: [" ███ ", "█   █", "█████", "█   █", "█   █"], L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"], Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
};
export const bigRows = (word: string) => [0, 1, 2, 3, 4].map((r) => [...word].map((l) => FONT[l][r]).join(" "));
const isSkl = (c: string) => "SCKL".includes(c); // a hard C is a K sound, so it lights up too

/** A character, a text color and a background color per cell. */
export class Grid {
  ch: string[][] = [];
  fg: (RGB | null)[][] = [];
  bg: (RGB | null)[][] = [];
  constructor(readonly w: number, readonly h: number) { this.clear(); }
  clear(): void {
    const grid = <T,>(v: T) => Array.from({ length: this.h }, () => Array<T>(this.w).fill(v));
    this.ch = grid(" "); this.fg = grid<RGB | null>(null); this.bg = grid<RGB | null>(null);
  }
  private ok(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  /** bg undefined keeps the cell's background (text over a painted sky or coin). */
  set(x: number, y: number, c: string, fg: RGB | null, bg?: RGB | null): void {
    x = Math.round(x); y = Math.round(y);
    if (!this.ok(x, y)) return;
    this.ch[y][x] = c; this.fg[y][x] = fg;
    if (bg !== undefined) this.bg[y][x] = bg;
  }
  paint(x: number, y: number, bg: RGB): void { x = Math.round(x); y = Math.round(y); if (this.ok(x, y)) this.bg[y][x] = bg; }
  text(x: number, y: number, s: string, color: RGB | ((i: number, c: string) => RGB | null)): void {
    [...s].forEach((c, i) => { if (c !== " ") this.set(x + i, y, c, typeof color === "function" ? color(i, c) : color); });
  }
  center(y: number, s: string, color: RGB): void { this.text(Math.floor((this.w - [...s].length) / 2), y, s, color); }
}

/** One scene, made fresh when it starts: how many frames it lasts and how to draw frame f. */
interface Segment { frames: number; draw: (f: number) => void }

export interface ShowOptions {
  w: number;
  h: number;
  /** Drawn dim in the top right corner during the show ("" for none). */
  hint: string;
  /** When set, the name at the end never ends, and this line fades in under it from 3 s to 4 s. */
  endHint?: string;
}

/**
 * Plays the scenes against a clock. Call tick(now) as often as you like; it computes every
 * frame that has come due (physics stays right when a tick runs late) but draws only the newest
 * into `grid`, which the caller then shows.
 */
export class Show {
  readonly grid: Grid;
  private readonly scenes: (() => Segment)[];
  private idx = 0;
  private seg: Segment | null = null;
  private start = 0;
  private f = 0;
  private finished = false;

  constructor(private readonly o: ShowOptions) {
    this.grid = new Grid(o.w, o.h);
    this.scenes = makeScenes(this.grid, o);
  }

  /** Which scene is playing: 0 field, 1 scale, 2 granary, 3 coin, 4 words, 5 words merging, 6 name. */
  get scene(): number { return Math.min(this.idx, this.scenes.length - 1); }
  /** Frames computed so far in this scene. */
  get frame(): number { return this.f; }
  get done(): boolean { return this.finished; }
  /** True once the name is on screen. */
  get atEnd(): boolean { return !this.finished && this.idx === this.scenes.length - 1; }
  /** When the next frame is due, in the clock of tick(). */
  get nextAt(): number { return this.start + this.f * FRAME_MS; }

  tick(now: number): void {
    if (this.finished) return;
    if (!this.seg) { this.seg = this.scenes[this.idx](); this.start = now; this.f = 0; }
    const last = this.seg.frames - 1;
    let due = Math.min(last, Math.floor((now - this.start) / FRAME_MS));
    if (due - this.f >= MAX_CATCH_UP) {
      const shift = due - this.f - MAX_CATCH_UP + 1;
      this.start += shift * FRAME_MS;
      due -= shift;
    }
    while (this.f <= due) { this.grid.clear(); this.seg.draw(this.f); this.f++; }
    // The corner hint stays off a name that holds: its own end hint says what to do.
    if (this.o.hint && last !== Infinity) this.grid.text(this.o.w - 30, 0, this.o.hint, DIM);
    if (this.f > last) this.next();
  }

  /** Move on to the next scene (the last one: end the show). The grid keeps the last frame drawn. */
  next(): void {
    if (this.finished) return;
    this.seg = null;
    this.idx++;
    if (this.idx >= this.scenes.length) this.finished = true;
  }

  skipAll(): void { this.finished = true; }
}

function makeScenes(cv: Grid, o: ShowOptions): (() => Segment)[] {
  const W = o.w, H = o.h, CX = Math.floor(W / 2);
  // Text that types itself out from frame `start`, at `speed` characters per frame.
  const typed = (s: string, f: number, start: number, speed = 1.1) => s.slice(0, Math.max(0, Math.floor((f - start) * speed)));
  const typedEnd = (s: string, start: number, speed = 1.1) => start + Math.ceil(s.length / speed);

  const stepParticles = (ps: Particle[], gravity = 0.12) => {
    for (const p of ps) { p.vy += gravity; p.x += p.vx; p.y += p.vy; p.life--; }
    return ps.filter((p) => p.life > 0);
  };
  const drawParticles = (ps: Particle[]) => { for (const p of ps) cv.set(p.x, p.y, p.ch, lerp(FADED, p.color, p.life / p.max)); };
  const burst = (x: number, y: number, n: number, colors: RGB[], speed = 1.6): Particle[] =>
    Array.from({ length: n }, () => {
      const a = rnd(0, Math.PI * 2), v = rnd(0.3, speed);
      const life = Math.floor(rnd(18, 40));
      return { x, y, vx: Math.cos(a) * v * 2, vy: Math.sin(a) * v - 0.6, life, max: life, color: colors[Math.floor(rnd(0, colors.length))], ch: "*+.·'"[Math.floor(rnd(0, 5))] };
    });

  // ---------- scene 1: night to dawn; one seed falls and a field of wheat rises ----------
  function field(): Segment {
    const ground = H - 7;
    const stars = Array.from({ length: 40 }, () => ({ x: Math.floor(rnd(0, W)), y: Math.floor(rnd(1, ground - 4)), p: rnd(0, 6) }));
    const stalks: { x: number; h: number; delay: number }[] = [];
    for (let x = 3; x < W - 3; x += 4) stalks.push({ x, h: 6 + Math.floor(rnd(0, 7)), delay: 30 + (Math.abs(x - CX) / W) * 70 + rnd(0, 8) });
    const [cap1, cap2] = WHY_TEXT.field, s1 = 70, s2 = typedEnd(cap1, s1) + 15;
    let dust: Particle[] = [];
    return { frames: typedEnd(cap2, s2) + HOLD, draw: (f) => {
      const dawn = Math.min(1, f / 150);
      for (let y = 0; y < ground; y++) {
        const v = y / ground;
        const sky = lerp(lerp(NIGHT_TOP, NIGHT_LOW, v), lerp(DAWN_TOP, DAWN_LOW, v * v), dawn);
        for (let x = 0; x < W; x++) cv.paint(x, y, sky);
      }
      for (const s of stars) if (dawn < 0.7 && Math.sin(f / 5 + s.p) > -0.3) cv.set(s.x, s.y, "·", lerp(WHITE, DAWN_TOP, dawn * 1.4));
      // the sun climbs out of the soil
      const sunX = Math.floor(W * 0.78), sunY = ground + 3 - dawn * 11;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -7; dx <= 7; dx++) {
        if ((dx / 2) ** 2 + dy ** 2 <= 10 && sunY + dy < ground) cv.paint(sunX + dx, sunY + dy, lerp(SUN, [255, 236, 170], 0.3 - dy / 10));
      }
      for (let x = 0; x < W; x++) { cv.set(x, ground, "▀", SOIL_TOP, SOIL); cv.paint(x, ground + 1, SOIL); }
      // the seed
      if (f < 30) cv.set(CX, (f / 30) * (ground - 1), "•", BRIGHT);
      if (f === 30) dust = burst(CX, ground - 1, 14, [SOIL_TOP, GOLD], 0.8);
      dust = stepParticles(dust, 0.08); drawParticles(dust);
      // the field, with a gust of wind rolling through once it has grown
      const gustX = (f - 150) * 1.4;
      for (const s of stalks) {
        const grown = Math.max(0, Math.min(s.h, ((f - s.delay) / 35) * s.h));
        if (grown <= 0) continue;
        const top = ground - Math.floor(grown);
        for (let y = ground - 1; y > top; y--) cv.set(s.x, y, "|", STALK);
        if (grown >= s.h) {
          const gust = f > 150 ? 2.2 * Math.exp(-((s.x - gustX) ** 2) / 50) : 0;
          const sway = Math.round(Math.sin(f / 8 + s.x / 9) * 0.8 + gust);
          cv.set(s.x + Math.sign(sway), top, "|", STALK);
          for (let k = 0; k < 3; k++) { cv.set(s.x + sway - 1, top - 1 - k, "\\", GOLD); cv.set(s.x + sway, top - 1 - k, "|", GOLD); cv.set(s.x + sway + 1, top - 1 - k, "/", GOLD); }
          cv.set(s.x + sway, top - 4, "'", BRIGHT);
        }
      }
      cv.center(ground + 3, typed(cap1, f, s1), WHITE);
      cv.center(ground + 5, typed(cap2, f, s2), DIM);
    } };
  }

  // ---------- scene 2: grain is poured onto a balance against a shekel, and the beam swings level ----------
  function scale(): Segment {
    const base = Math.min(8, H - 16), half = 17, panW = 11, FULL = 70; // the lowest caption sits at base + 15
    const [cap1, cap2] = WHY_TEXT.scale, s1 = 20, s2 = typedEnd(cap1, s1) + 20;
    let angle = 3.4, vel = 0, heap = 0, balancedAt = -1;
    let grains: { x: number; y: number; vy: number }[] = [], sparks: Particle[] = [];
    return { frames: Math.max(200, typedEnd(cap2, s2) + HOLD), draw: (f) => {
      const target = 3.4 * (1 - Math.min(1, heap / FULL));
      vel += (target - angle) * 0.06; vel *= 0.9; angle += vel;
      const ly = base - Math.round(angle), ry = base + Math.round(angle);
      // pour
      if (f < 120) grains.push({ x: CX - half + rnd(-3, 3), y: 0, vy: rnd(0, 0.3) });
      for (const g of grains) { g.vy += 0.18; g.y += g.vy; }
      heap += grains.filter((g) => g.y >= ly + 2).length;
      grains = grains.filter((g) => g.y < ly + 2);
      for (const g of grains) cv.set(g.x, g.y, ".", GOLD);
      // stand and beam
      for (let y = base + 1; y < base + 10; y++) cv.set(CX, y, "║", BRONZE);
      cv.text(CX - 5, base + 10, "▄▄▄▄▄▄▄▄▄▄▄", BRONZE);
      cv.set(CX, base, "▲", GOLD);
      if (Math.abs(angle) < 0.15 && Math.abs(vel) < 0.03 && balancedAt < 0) { balancedAt = f; sparks = burst(CX, base - 1, 30, [GOLD, BRIGHT, WHITE]); }
      const glow = balancedAt >= 0 && f - balancedAt < 12;
      for (let i = -half; i <= half; i++) cv.set(CX + i, base + Math.round((angle * i) / half), "═", glow ? BRIGHT : BRONZE);
      const pan = (ex: number, ey: number) => {
        cv.set(ex - 3, ey + 1, "/", DIM); cv.set(ex + 3, ey + 1, "\\", DIM);
        cv.text(ex - Math.floor(panW / 2) - 1, ey + 3, "\\" + "_".repeat(panW) + "/", BRONZE);
      };
      pan(CX - half, ly); pan(CX + half, ry);
      const n = Math.min(heap, FULL), row1 = Math.min(panW, Math.ceil((n / FULL) * panW * 1.5)), row2 = Math.max(0, row1 - panW);
      cv.text(CX - half - Math.floor(row1 / 2), ly + 2, ":".repeat(row1), GOLD);
      if (row2) cv.text(CX - half - Math.floor(row2 / 2), ly + 1, ".".repeat(row2), GOLD);
      cv.text(CX + half - 2, ry + 1, "▟█▙", BRONZE); cv.text(CX + half - 2, ry + 2, "SKL", BRIGHT);
      sparks = stepParticles(sparks, 0.05); drawParticles(sparks);
      cv.center(base + 13, typed(cap1, f, s1), WHITE);
      cv.center(base + 15, typed(cap2, f, s2), DIM);
    } };
  }

  // ---------- scene 3: seven good years fill the granary, seven lean years draw it down ----------
  function granary(): Segment {
    const gw = 30, gh = Math.min(10, H - 14), gx = CX - gw / 2, gy = 5, per = 18; // the last caption sits at gy + gh + 8
    const cap = WHY_TEXT.granary, end = WHY_TEXT.granaryEnd, sEnd = 14 * per + 10;
    let rain: { x: number; y: number; vy: number }[] = [], spill: { x: number; y: number; vx: number; vy: number }[] = [];
    return { frames: typedEnd(end, sEnd) + HOLD, draw: (f) => {
      const yr = Math.min(14, f / per);
      const level = yr <= 7 ? (yr / 7) * gh : ((14 - yr) / 7) * gh;
      const good = yr < 7;
      cv.text(gx + 2, gy - 3, "/" + "^".repeat(gw - 6) + "\\", BRONZE);
      cv.text(gx + 1, gy - 2, "/" + "^".repeat(gw - 4) + "\\", BRONZE);
      cv.text(gx, gy - 1, "/" + "^".repeat(gw - 2) + "\\", BRONZE);
      for (let y = 0; y < gh; y++) {
        cv.set(gx, gy + y, "▌", BRONZE); cv.set(gx + gw - 1, gy + y, "▐", BRONZE);
        const fill = level - (gh - 1 - y);
        if (fill > 0) cv.text(gx + 1, gy + y, (fill >= 1 ? ":" : ".").repeat(gw - 2), fill >= 1 ? GOLD : BRONZE);
      }
      cv.text(gx, gy + gh, "▀".repeat(gw), BRONZE);
      // grain rains in during the good years and pours out of the door in the lean ones
      if (good) for (let k = 0; k < 2; k++) rain.push({ x: gx + rnd(3, gw - 3), y: 0, vy: 0 });
      for (const g of rain) { g.vy += 0.15; g.y += g.vy; }
      rain = rain.filter((g) => g.y < gy - 3);
      for (const g of rain) cv.set(g.x, g.y, ".", GOLD);
      if (!good && yr < 14) for (let k = 0; k < 2; k++) spill.push({ x: gx + gw, y: gy + gh - 1, vx: rnd(0.8, 1.6), vy: rnd(-0.4, 0) });
      for (const s of spill) { s.vy += 0.1; s.x += s.vx; s.y = Math.min(gy + gh, s.y + s.vy); }
      spill = spill.filter((s) => s.x < W);
      for (const s of spill) cv.set(s.x, s.y, ".", GOLD);
      // the fourteen years
      for (let i = 0; i < 14; i++) {
        const passed = yr > i, mark = i < 7 ? (passed ? "■" : "□") : passed ? "□" : "■";
        const color = i < 7 ? (passed ? GOLD : FADED) : passed ? FADED : GOLD;
        cv.set(gx + 1 + i * 2 + (i >= 7 ? 2 : 0), gy + gh + 2, mark, color);
      }
      const label = yr >= 14 ? WHY_TEXT.survived : good ? `${WHY_TEXT.goodYear} ${Math.floor(yr) + 1}` : `${WHY_TEXT.leanYear} ${Math.floor(yr) - 6}`;
      cv.center(gy + gh + 4, label, yr >= 14 ? BRIGHT : good ? WHITE : DIM);
      cv.center(gy + gh + 6, typed(cap, f, 10, 1.4), DIM);
      cv.center(gy + gh + 8, typed(end, f, sEnd), WHITE);
    } };
  }

  // ---------- scene 4: a coin spins down and is struck with three ears of barley ----------
  function coin(): Segment {
    const r = 8, cy = Math.floor(H / 2) - 2, land = 75;
    const [cap, cap2] = WHY_TEXT.coin, sCap = land + 25, sCap2 = typedEnd(cap, sCap) + 15;
    let sparks: Particle[] = [];
    return { frames: typedEnd(cap2, sCap2) + HOLD, draw: (f) => {
      const spinning = f < land;
      const rx = spinning ? Math.abs(Math.cos(f / (4 + f / 12))) * r * 2 : r * 2;
      const struck = f >= land && f < land + 5;
      if (f === land) sparks = burst(CX, cy, 60, [GOLD, BRIGHT, WHITE], 2.4);
      if (f >= land && f < land + 22) {
        const R = r + (f - land) * 0.8;
        for (let a = 0; a < 360; a += 3) { const t = (a * Math.PI) / 180; cv.set(CX + Math.cos(t) * R * 2, cy + Math.sin(t) * R, "·", lerp(BRIGHT, FADED, (f - land) / 22)); }
      }
      if (rx >= 0.5) {
        for (let y = -r; y <= r; y++) for (let x = -Math.ceil(rx); x <= Math.ceil(rx); x++) {
          const d = (x / rx) ** 2 + (y / r) ** 2;
          if (d <= 1) cv.paint(CX + x, cy + y, struck ? FLASH : d > 0.82 ? BRONZE : lerp([92, 58, 22], [70, 44, 18], d));
        }
      } else {
        for (let y = -r; y <= r; y++) cv.set(CX, cy + y, "▌", BRONZE);
      }
      // the barley, once the coin has landed
      if (!spinning && !struck) {
        for (const [dx, lean] of [[-4, -1], [0, 0], [4, 1]]) {
          for (let k = 0; k < 3; k++) { cv.set(CX + dx - 1, cy - 5 + k, "\\", BRIGHT); cv.set(CX + dx, cy - 5 + k, "|", BRIGHT); cv.set(CX + dx + 1, cy - 5 + k, "/", BRIGHT); }
          cv.set(CX + dx, cy - 6, "'", BRIGHT);
          for (let k = 0; k < 4; k++) cv.set(CX + dx - Math.round((dx / 4) * k), cy - 2 + k, lean < 0 ? "\\" : lean > 0 ? "/" : "|", GOLD);
        }
      }
      sparks = stepParticles(sparks, 0.1); drawParticles(sparks);
      cv.center(cy + r + 2, typed(cap, f, sCap), WHITE);
      cv.center(cy + r + 4, typed(cap2, f, sCap2), DIM);
    } };
  }

  // ---------- scene 5: S-K-L across the languages; SAKELLARIOS and SALARY merge into the name ----------
  // "each": the words one at a time. "merge": the roll call, where they come together into the name.
  // Two scenes, so Space during the words lands on the merge instead of skipping it.
  function words(part: "each" | "merge"): Segment {
    const WORDS = WHY_TEXT.words.map(([w, note]) => [w.toUpperCase(), note] as const);
    const NOISE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ$#%&@";
    const row = Math.floor(H / 2) - 2;
    // each word in turn: [first frame, word, note, when its note starts typing]
    const parts: [number, string, string, number][] = [];
    let at = 0;
    for (const [w, note] of WORDS) {
      const sNote = 6 + w.length * 1.2 + 4;
      parts.push([at, w, note, sNote]);
      at += Math.ceil(typedEnd(note, sNote, 1.6) + secs(2));
    }
    const rollStart = at;
    // the roll call: every word at once; then all but SAKELLARIOS and SALARY fade, and those two merge
    const top = Math.max(2, Math.floor(H / 2) - WORDS.length);
    const cy = Math.floor(H / 2);
    const iSak = WORDS.findIndex(([w]) => w === "SAKELLARIOS"), iSal = WORDS.findIndex(([w]) => w === "SALARY");
    const canMerge = iSak >= 0 && iSal >= 0;
    // which letter goes where in S K A L L A R Y: SKALL from sakellarios, ARY from salary
    const picks: [number, number][] = canMerge ? [[iSak, 0], [iSak, 2], [iSak, 1], [iSak, 4], [iSak, 5], [iSal, 3], [iSal, 4], [iSal, 5]] : [];
    const pickAt = new Map(picks.map(([r, i], j) => [`${r}:${i}`, j]));
    const rowY = (r: number, f: number) => {
      const y0 = top + r * 2;
      if (!canMerge || (r !== iSak && r !== iSal)) return y0;
      const t = ease(clamp01((f - 85) / 30));
      return y0 + ((r === iSak ? cy - 2 : cy + 2) - y0) * t;
    };
    const drawWord = (w: string, note: string, sNote: number, f: number) => {
      const letters = [...w];
      const x0 = CX - letters.length;
      letters.forEach((c, i) => {
        const settled = f > 4 + i * 1.2;
        const glow = settled && isSkl(c) ? lerp(BRIGHT, GOLD, (f - 4 - i * 1.2) / 15) : null;
        cv.set(x0 + i * 2, row, settled ? c : NOISE[Math.floor(rnd(0, NOISE.length))], settled ? (glow ?? DIM) : FADED);
      });
      cv.center(row + 3, typed(note, f, sNote, 1.6), WHITE);
    };
    const drawRoll = (f: number) => {
      WORDS.forEach(([w], r) => {
        if (f < r * 5) return;
        const keep = canMerge && (r === iSak || r === iSal);
        [...w].forEach((c, i) => {
          const x0 = CX - w.length + i * 2, y0 = rowY(r, f);
          const j = pickAt.get(`${r}:${i}`);
          if (j !== undefined && f > 125) {
            const t = ease(Math.min(1, (f - 125 - j * 3) / 40));
            if (t <= 0) { cv.set(x0, y0, c, GOLD); return; }
            const x = x0 + (CX - 7 + j * 2 - x0) * t, y = y0 + (cy - y0) * t - Math.sin(t * Math.PI) * 3;
            cv.set(x, y, c, t >= 1 ? (isSkl(c) ? BRIGHT : WHITE) : GOLD);
            return;
          }
          const fade = Math.max(0, (f - (keep ? 125 : 55)) / 25);
          if (fade >= 1) return;
          cv.set(x0, y0, c, lerp(isSkl(c) ? GOLD : DIM, BLACK, fade));
        });
      });
    };
    if (part === "merge") return { frames: canMerge ? 235 : 110, draw: drawRoll };
    return { frames: rollStart, draw: (f) => {
      let k = parts.length - 1;
      while (parts[k][0] > f) k--;
      const [start, w, note, sNote] = parts[k];
      drawWord(w, note, sNote, f - start);
    } };
  }

  // ---------- scene 6: the name lands ----------
  function name(): Segment {
    const rows = bigRows("SKALLARY");
    const bw = rows[0].length, bx = Math.floor((W - bw) / 2), by = Math.floor(H / 2) - 4;
    const fadeFrom = secs(3), fadeFor = secs(1);
    let sparks: Particle[] = [];
    return { frames: o.endHint ? Infinity : secs(4), draw: (f) => {
      if (f === 0) sparks = [...burst(CX - 15, by + 2, 40, [GOLD, BRIGHT, WHITE], 2.2), ...burst(CX + 15, by + 2, 40, [GOLD, BRIGHT, WHITE], 2.2)];
      const reveal = 6 + f * 3;
      rows.forEach((r, y) => [...r].forEach((c, x) => {
        if (c === " " || Math.abs(x - bw / 2) > reveal) return;
        cv.set(bx + x, by + y, c, f < 8 ? FLASH : shimmer(x, f));
      }));
      sparks = stepParticles(sparks, 0.09); drawParticles(sparks);
      if (o.endHint && f >= fadeFrom) cv.center(by + 8, o.endHint, lerp(BLACK, DIM, (f - fadeFrom) / fadeFor));
    } };
  }

  return [field, scale, granary, coin, () => words("each"), () => words("merge"), name];
}
