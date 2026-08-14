/**
 * Pure tree maths for explore conversations.
 *
 * Turns form a tree: siblings under one parent are versions of each other, and
 * the transcript on screen is one root-to-leaf path through it. Everything
 * here operates on an already-loaded message list so the rules stay testable
 * without a database, and so a conversation costs one query rather than one
 * per level.
 */

export type TreeNode = {
  id: string;
  parentId: string | null;
  createdAt: Date;
};

/**
 * Follow the newest child repeatedly to reach a leaf.
 *
 * Newest-wins is what makes a freshly created branch the one you land on: an
 * edit or a regenerate appends, so the new version is always the latest child
 * of that parent.
 */
export function deepestLeafFrom(
  nodes: TreeNode[],
  startId: string | null,
): string | null {
  const childrenByParent = groupByParent(nodes);
  let current = startId ?? newestRoot(nodes)?.id ?? null;
  const seen = new Set<string>();
  while (current !== null) {
    if (seen.has(current)) {
      // Parent pointers are written by us and cannot legitimately cycle, but
      // walking forever on corrupt data would hang a request rather than fail.
      break;
    }
    seen.add(current);
    const children = childrenByParent.get(current) ?? [];
    const newest = newestOf(children);
    if (newest === undefined) {
      return current;
    }
    current = newest.id;
  }
  return current;
}

/**
 * The root-to-leaf path ending at `leafId`, oldest first.
 *
 * Returns an empty path when the leaf is unknown — a stale `currentLeafId`
 * should render an empty conversation, not throw at the caller.
 */
export function pathToLeaf<T extends TreeNode>(
  nodes: T[],
  leafId: string | null,
): T[] {
  if (leafId === null) {
    return [];
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: T[] = [];
  const seen = new Set<string>();
  let current: string | null = leafId;
  while (current !== null) {
    const node: T | undefined = byId.get(current);
    if (node === undefined || seen.has(current)) {
      break;
    }
    seen.add(current);
    path.push(node);
    current = node.parentId;
  }
  return path.reverse();
}

/** Where a message sits among its versions, and how many there are. */
export function versionPosition(
  nodes: TreeNode[],
  messageId: string,
): { index: number; count: number } {
  const node = nodes.find((candidate) => candidate.id === messageId);
  if (node === undefined) {
    return { index: 0, count: 1 };
  }
  const siblings = sortedByAge(
    nodes.filter((candidate) => candidate.parentId === node.parentId),
  );
  const index = siblings.findIndex((sibling) => sibling.id === messageId);
  return { index: Math.max(index, 0), count: siblings.length };
}

/** The sibling set of a message, oldest first — the order the arrows page in. */
export function siblingsOf<T extends TreeNode>(
  nodes: T[],
  messageId: string,
): T[] {
  const node = nodes.find((candidate) => candidate.id === messageId);
  if (node === undefined) {
    return [];
  }
  return sortedByAge(
    nodes.filter((candidate) => candidate.parentId === node.parentId),
  );
}

function groupByParent<T extends TreeNode>(nodes: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const node of nodes) {
    if (node.parentId === null) {
      continue;
    }
    grouped.set(node.parentId, [...(grouped.get(node.parentId) ?? []), node]);
  }
  return grouped;
}

function newestRoot<T extends TreeNode>(nodes: T[]): T | undefined {
  return newestOf(nodes.filter((node) => node.parentId === null));
}

function newestOf<T extends TreeNode>(nodes: T[]): T | undefined {
  return sortedByAge(nodes).at(-1);
}

/**
 * Oldest first, with the id as a tiebreak. SQLite timestamps have millisecond
 * resolution and two versions can land inside one millisecond, so without the
 * tiebreak the arrows could reorder between requests.
 */
function sortedByAge<T extends TreeNode>(nodes: T[]): T[] {
  return [...nodes].sort((left, right) => {
    const delta = left.createdAt.getTime() - right.createdAt.getTime();
    return delta === 0 ? left.id.localeCompare(right.id) : delta;
  });
}
