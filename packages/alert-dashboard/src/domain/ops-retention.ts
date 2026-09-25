const HOUR_NS = 3_600_000_000_000n;
const DAY_NS = 24n * HOUR_NS;

export type RetainedSnapshotRow = {
  id: string;
  generatedAtNs: bigint;
};

function isNewer(
  left: RetainedSnapshotRow,
  right: RetainedSnapshotRow,
): boolean {
  return (
    left.generatedAtNs > right.generatedAtNs ||
    (left.generatedAtNs === right.generatedAtNs && left.id > right.id)
  );
}

/**
 * Snapshot retention: keep the latest snapshot, plus the earliest sample in
 * every UTC hour inside the retention window, and prune everything else.
 *
 * Pure so the repository can apply it inside the ingest transaction; there is
 * no timer, so retention advances exactly as fast as snapshots arrive.
 */
export function prunableSnapshotIds(
  rows: readonly RetainedSnapshotRow[],
  nowNs: bigint,
  retentionDays: number,
): string[] {
  let latest: RetainedSnapshotRow | undefined;
  for (const row of rows) {
    if (latest === undefined || isNewer(row, latest)) latest = row;
  }
  const cutoffNs = nowNs - BigInt(retentionDays) * DAY_NS;
  const earliestByHour = new Map<bigint, RetainedSnapshotRow>();
  for (const row of rows) {
    if (row.generatedAtNs < cutoffNs) continue;
    const bucket = row.generatedAtNs / HOUR_NS;
    const current = earliestByHour.get(bucket);
    if (current === undefined || isNewer(current, row))
      earliestByHour.set(bucket, row);
  }
  const keep = new Set([...earliestByHour.values()].map((row) => row.id));
  if (latest !== undefined) keep.add(latest.id);
  return rows.filter((row) => !keep.has(row.id)).map((row) => row.id);
}
