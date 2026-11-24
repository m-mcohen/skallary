// The only file in the test tree that knows the shape of the chart library's option. Every chart
// test reads the option through these functions, so a library change is a change to this one file.

type Obj = Record<string, unknown>;

function seriesOf(option: unknown, id: string): Obj {
  const list = ((option as Obj).series ?? []) as Obj[];
  const s = list.find((x) => x.id === id);
  if (!s) throw new Error(`no series "${id}" in the option`);
  return s;
}

function valueOf(item: unknown): unknown {
  return item !== null && typeof item === "object" && !Array.isArray(item) ? (item as Obj).value : item;
}

/** The amounts a series was given, in order; a gap is null. */
export function seriesValues(option: unknown, id: string): (number | null)[] {
  const data = (seriesOf(option, id).data ?? []) as unknown[];
  return data.map((item) => {
    const v = valueOf(item);
    const y = Array.isArray(v) ? v[1] : v;
    return y === null || y === undefined || y === "-" ? null : (y as number);
  });
}

export function colorOf(option: unknown, id: string): string {
  const s = seriesOf(option, id);
  return ((s.itemStyle as Obj | undefined)?.color ?? (s.lineStyle as Obj | undefined)?.color) as string;
}

export function isDashed(option: unknown, id: string): boolean {
  return (seriesOf(option, id).lineStyle as Obj | undefined)?.type === "dashed";
}

export function hasZoom(option: unknown): boolean {
  const z = (option as Obj).dataZoom;
  return Array.isArray(z) && z.length > 0;
}

export function showsMarks(option: unknown, id: string): boolean {
  return seriesOf(option, id).showSymbol !== false;
}

/** The money axis's label for an amount in cents. */
export function valueAxisLabel(option: unknown, cents: number): string {
  const y = (option as Obj).yAxis as Obj;
  const fmt = (y.axisLabel as Obj).formatter as (v: number) => string;
  return fmt(cents);
}

/** True when a line is drawn as a curve between its points rather than straight. */
export function isSmooth(option: unknown, id: string): boolean {
  return seriesOf(option, id).smooth === true;
}

/** The kind of scale the x axis uses: "time" places points at their real dates, "category" spaces them evenly. */
export function xAxisType(option: unknown): unknown {
  return ((option as Obj).xAxis as Obj).type;
}

/** The Sankey's bands as drawn: source, target, amount in cents, and how opaque the band is. */
export function flowLinks(option: unknown): { source: string; target: string; cents: number; opacity: number }[] {
  const links = (seriesOf(option, "flow").links ?? []) as { source: string; target: string; value: number; lineStyle: { opacity: number } }[];
  return links.map((l) => ({ source: l.source, target: l.target, cents: l.value, opacity: l.lineStyle.opacity }));
}

/** The Sankey's node ids in drawing order. */
export function flowNodes(option: unknown): string[] {
  return ((seriesOf(option, "flow").data ?? []) as { name: string }[]).map((n) => n.name);
}

export function nodeAlign(option: unknown): unknown {
  return seriesOf(option, "flow").nodeAlign;
}

/** What a band does for the pointer: whether the series can be dragged, and which nodes show a pointer cursor. */
export function flowInteraction(option: unknown): { draggable: unknown; pointerNodes: string[] } {
  const s = seriesOf(option, "flow");
  const nodes = (s.data ?? []) as { name: string; cursor?: string }[];
  return { draggable: s.draggable, pointerNodes: nodes.filter((n) => n.cursor === "pointer").map((n) => n.name) };
}
