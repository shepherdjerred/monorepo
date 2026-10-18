type Node = {
  id: string;
  name: string;
  promotionSourceEnvironmentId: string | null;
};

/**
 * Order environments along promotion edges: sources before targets, siblings
 * by name. Edges to environments of another service start a new root. A cycle
 * is a broken registration contract and fails loudly.
 */
export function promotionOrder<T extends Node>(environments: T[]): T[] {
  const ids = new Set(environments.map((entry) => entry.id));
  const byName = (left: T, right: T) => left.name.localeCompare(right.name);
  const ordered: T[] = [];
  const placed = new Set<string>();
  let frontier = environments
    .filter(
      (entry) =>
        entry.promotionSourceEnvironmentId === null ||
        !ids.has(entry.promotionSourceEnvironmentId),
    )
    .toSorted(byName);
  while (frontier.length > 0) {
    for (const entry of frontier) {
      ordered.push(entry);
      placed.add(entry.id);
    }
    frontier = environments
      .filter(
        (entry) =>
          !placed.has(entry.id) &&
          entry.promotionSourceEnvironmentId !== null &&
          placed.has(entry.promotionSourceEnvironmentId),
      )
      .toSorted(byName);
  }
  if (ordered.length !== environments.length)
    throw new Error("Environment promotion sources form a cycle");
  return ordered;
}
