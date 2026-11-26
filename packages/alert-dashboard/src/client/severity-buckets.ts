/**
 * Groups items into one bucket per severity, worst severity first. Items keep
 * their original order inside a bucket. Shared by the alert ledger table and
 * the ops signal tables, which draw a heading row per bucket.
 */
export function bucketBySeverity<Item, Sev>(
  items: readonly Item[],
  severityOf: (item: Item) => Sev,
  rank: (severity: Sev) => number,
): [Sev, Item[]][] {
  const buckets = new Map<Sev, Item[]>();
  for (const item of items) {
    const severity = severityOf(item);
    const bucket = buckets.get(severity) ?? [];
    bucket.push(item);
    buckets.set(severity, bucket);
  }
  return [...buckets.entries()].toSorted(
    ([left], [right]) => rank(right) - rank(left),
  );
}
