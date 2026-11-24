/** Puts a chart in a linked-hover group; a chart with no group joins nothing. */
export function joinLinkGroup(instance: { group?: string }, group: string | undefined, connect: (g: string) => void): void {
  if (!group) return;
  instance.group = group;
  connect(group);
}
