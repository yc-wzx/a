/** Find an existing path without recursing into cycles in legacy data. */
export function dependencyPath(
  edges: { predecessorId: string; successorId: string }[],
  start: string,
  target: string,
): string[] | null {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const children = next.get(edge.predecessorId) ?? [];
    children.push(edge.successorId);
    next.set(edge.predecessorId, children);
  }
  const parents = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current === target) {
      const path = [current];
      let parent = parents.get(current);
      while (parent != null) {
        path.unshift(parent);
        parent = parents.get(parent);
      }
      return path;
    }
    for (const child of next.get(current) ?? []) {
      if (parents.has(child)) continue;
      parents.set(child, current);
      queue.push(child);
    }
  }
  return null;
}
