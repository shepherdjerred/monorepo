/** Pure queue-editing helpers used by the playback machine (1-based indices, as users see them). */

export function removeAt<T>(items: readonly T[], oneBasedIndex: number): T[] {
  return items.filter((_item, index) => index !== oneBasedIndex - 1);
}

export function moveItem<T>(
  items: readonly T[],
  oneBasedFrom: number,
  oneBasedTo: number,
): T[] {
  const from = oneBasedFrom - 1;
  const to = oneBasedTo - 1;
  const last = items.length - 1;
  if (from < 0 || from > last || to < 0 || to > last) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return [...items];
  }
  next.splice(to, 0, moved);
  return next;
}

export function shuffleQueue<T>(items: readonly T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = next[i];
    const b = next[j];
    if (a !== undefined && b !== undefined) {
      next[i] = b;
      next[j] = a;
    }
  }
  return next;
}
