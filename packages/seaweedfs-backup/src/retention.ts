import type { BackupPolicy, CompletionMarker } from "./schemas.ts";
import type { ObjectStore } from "./store.ts";
import { completionKey, listCompletionMarkers } from "./manifest.ts";

type PacificDate = { year: number; month: number; day: number };

function pacificDate(value: string): PacificDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.get("year"));
  const month = Number(lookup.get("month"));
  const day = Number(lookup.get("day"));
  if (![year, month, day].every((part) => Number.isInteger(part))) {
    throw new Error(`Cannot derive Pacific calendar date from ${value}`);
  }
  return { year, month, day };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dailyKey(value: string): string {
  const date = pacificDate(value);
  return `${String(date.year)}-${pad(date.month)}-${pad(date.day)}`;
}

function weeklyKey(value: string): string {
  const local = pacificDate(value);
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function monthlyKey(value: string): string {
  const date = pacificDate(value);
  return `${String(date.year)}-${pad(date.month)}`;
}

function newestPerBoundary(
  markers: readonly CompletionMarker[],
  key: (value: string) => string,
  limit: number,
): CompletionMarker[] {
  const newest = new Map<string, CompletionMarker>();
  for (const marker of markers) {
    const boundary = key(marker.completedAt);
    const existing = newest.get(boundary);
    if (
      existing === undefined ||
      marker.completedAt.localeCompare(existing.completedAt) > 0
    ) {
      newest.set(boundary, marker);
    }
  }
  return [...newest.values()]
    .toSorted((left, right) =>
      right.completedAt.localeCompare(left.completedAt),
    )
    .slice(0, limit);
}

export function selectRetainedSnapshotIds(
  markers: readonly CompletionMarker[],
  policy: BackupPolicy,
): Set<string> {
  const daily = markers.filter((marker) => marker.cadence === "daily");
  const sixHourly = markers
    .filter((marker) => marker.cadence === "six-hourly")
    .toSorted((left, right) =>
      right.completedAt.localeCompare(left.completedAt),
    )
    .slice(0, policy.retention.sixHourly);
  const retained = [
    ...sixHourly,
    ...newestPerBoundary(daily, dailyKey, policy.retention.daily),
    ...newestPerBoundary(daily, weeklyKey, policy.retention.weekly),
    ...newestPerBoundary(daily, monthlyKey, policy.retention.monthly),
  ];
  return new Set(retained.map((marker) => marker.snapshotId));
}

export function retainedPointCounts(
  markers: readonly CompletionMarker[],
  policy: BackupPolicy,
): { sixHourly: number; daily: number; weekly: number; monthly: number } {
  const retained = selectRetainedSnapshotIds(markers, policy);
  const selected = markers.filter((marker) => retained.has(marker.snapshotId));
  const daily = selected.filter((marker) => marker.cadence === "daily");
  return {
    sixHourly: selected.filter((marker) => marker.cadence === "six-hourly")
      .length,
    daily: new Set(daily.map((marker) => dailyKey(marker.completedAt))).size,
    weekly: new Set(daily.map((marker) => weeklyKey(marker.completedAt))).size,
    monthly: new Set(daily.map((marker) => monthlyKey(marker.completedAt)))
      .size,
  };
}

export async function pruneExpiredSnapshots(input: {
  store: ObjectStore;
  backupBucket: string;
  policy: BackupPolicy;
  now?: Date;
}): Promise<{ deletedSnapshots: number; markers: CompletionMarker[] }> {
  const now = input.now ?? new Date();
  const markers = await listCompletionMarkers(input.store, input.backupBucket);
  const retained = selectRetainedSnapshotIds(markers, input.policy);
  const minimumAgeMilliseconds =
    input.policy.retention.objectLockDays * 86_400_000;
  let deletedSnapshots = 0;
  for (const marker of markers) {
    if (
      retained.has(marker.snapshotId) ||
      now.getTime() - Date.parse(marker.completedAt) < minimumAgeMilliseconds
    ) {
      continue;
    }
    await input.store.deleteObject(
      input.backupBucket,
      completionKey(marker.snapshotId),
    );
    for (const manifest of marker.manifests) {
      await input.store.deleteObject(input.backupBucket, manifest.key);
    }
    deletedSnapshots += 1;
  }
  return { deletedSnapshots, markers };
}
