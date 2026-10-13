export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to))
      changes[field] = { from, to };
  }
  return changes;
}
