import { describe, expect, test } from "vitest";
import { FRAME_MS, Show, bigRows, type Grid } from "../../src/why/show";

const rowText = (g: Grid, y: number) => g.ch[y].join("");
const gridText = (g: Grid) => g.ch.map((r) => r.join("")).join("\n");

/** Ticks a show on a fake clock, one frame at a time, until `until` says stop (or a safety cap). */
function run(show: Show, until: (s: Show, t: number) => boolean, t0 = 0): number {
  let t = t0;
  for (let i = 0; i < 20000 && !until(show, t); i++) { show.tick(t); t += FRAME_MS; }
  return t;
}

describe("the show engine", () => {
  test("plays the scenes in order: field, scale, granary, coin, words, merge, name", () => {
    const show = new Show({ w: 110, h: 30, hint: "" });
    const seen: number[] = [];
    run(show, (s) => {
      if (seen[seen.length - 1] !== s.scene) seen.push(s.scene);
      return s.done;
    });
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(show.done).toBe(true);
  });

  test("next from inside the words lands on the merge, so the words still come together", () => {
    const show = new Show({ w: 110, h: 30, hint: "" });
    let t = run(show, (s) => s.scene === 4 && s.frame > 50);
    show.next();
    show.tick(t);
    expect(show.scene).toBe(5);
    t = run(show, (s) => gridText(s.grid).includes("S K A L L A R Y") || s.scene !== 5, t);
    expect(show.scene).toBe(5);
    expect(gridText(show.grid)).toContain("S K A L L A R Y");
  });

  test("skipAll ends the show", () => {
    const show = new Show({ w: 110, h: 30, hint: "" });
    show.tick(0);
    show.skipAll();
    show.tick(FRAME_MS);
    expect(show.done).toBe(true);
  });

  test("a long gap (a hidden tab) does not replay the backlog", () => {
    const show = new Show({ w: 110, h: 30, hint: "" });
    show.tick(0);
    show.tick(60_000);
    expect(show.scene).toBe(0);
    expect(show.frame).toBeLessThanOrEqual(46);
  });

  test("a slow screen (a few frames a second) still plays in real time", () => {
    const show = new Show({ w: 110, h: 30, hint: "" });
    for (let t = 0; t <= 2000; t += 250) show.tick(t); // 4 ticks a second
    expect(show.frame).toBeGreaterThanOrEqual(Math.floor(2000 / FRAME_MS));
  });

  test("with an end hint, the name holds and the hint fades in after about 3 seconds", () => {
    const show = new Show({ w: 110, h: 30, hint: "", endHint: "esc to close" });
    let t = run(show, (s) => s.scene === 6);
    expect(show.atEnd).toBe(true);
    const start = t;
    t = run(show, (_s, now) => now >= start + 2000, t);
    expect(gridText(show.grid)).not.toContain("esc to close");
    t = run(show, (_s, now) => now >= start + 4500, t);
    expect(gridText(show.grid)).toContain("esc to close");
    run(show, (_s, now) => now >= start + 60_000, t);
    expect(show.done).toBe(false);
  });

  test("the last frame shows SKALLARY in big letters", () => {
    const show = new Show({ w: 110, h: 30, hint: "" });
    run(show, (s) => s.done);
    const top = bigRows("SKALLARY")[0];
    expect(show.grid.ch.some((_, y) => rowText(show.grid, y).includes(top))).toBe(true);
  });

  test("with an end hint, the corner hint leaves once the name is up", () => {
    const show = new Show({ w: 110, h: 30, hint: "space: next   esc: close", endHint: "esc to close" });
    const t = run(show, (s) => s.scene === 6);
    show.tick(t);
    expect(rowText(show.grid, 0)).not.toContain("space: next");
  });

  test("the hint sits in the top row", () => {
    const show = new Show({ w: 110, h: 30, hint: "space: next   esc: close" });
    show.tick(0);
    expect(rowText(show.grid, 0)).toContain("space: next   esc: close");
  });
});
