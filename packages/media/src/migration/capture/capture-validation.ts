import { z } from "zod";
import {
  MAX_MIGRATION_BYTES,
  MAX_MIGRATION_PAGES,
  MigrationSnapshotSchema,
  type MigrationSnapshot,
  type MigrationRecord,
} from "#shared/migration.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { canonicalOrder } from "#migration/canonical-order.ts";

export const ENDPOINT_KINDS = {
  media: "media",
  files: "file",
  requests: "request",
  subtitle_preferences: "subtitle_preference",
  subtitles: "subtitle",
  torrents: "torrent",
} as const;
const REQUIRED_ENDPOINTS: Record<
  MigrationSnapshot["sourceKind"],
  readonly string[]
> = {
  radarr: ["media", "files"],
  sonarr: ["media", "files"],
  overseerr: ["requests"],
  jellyseerr: ["requests"],
  seerr: ["requests"],
  bazarr: ["subtitle_preferences", "subtitles"],
  qbittorrent: ["torrents"],
};
export function recordKey(
  snapshot: Pick<MigrationSnapshot, "sourceKind" | "sourceInstanceId">,
  record: Pick<MigrationRecord, "kind" | "sourceId">,
): string {
  return snapshotHash([
    snapshot.sourceKind,
    snapshot.sourceInstanceId,
    record.kind,
    record.sourceId,
  ]);
}
export function recordDigest(records: readonly MigrationRecord[]): string {
  return snapshotHash(
    z
      .json()
      .parse(
        [...records].sort((left, right) =>
          canonicalOrder(
            `${left.kind}:${left.sourceId}`,
            `${right.kind}:${right.sourceId}`,
          ),
        ),
      ),
  );
}
export function validateCapture(value: unknown) {
  const snapshot = MigrationSnapshotSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_MIGRATION_BYTES)
    throw new Error("Capture exceeds byte limit");
  if (
    snapshot.endpoints.reduce((total, endpoint) => total + endpoint.pages, 0) >
    MAX_MIGRATION_PAGES
  )
    throw new Error("Capture exceeds page limit");
  if (Date.parse(snapshot.completedAt) < Date.parse(snapshot.startedAt))
    throw new Error("Capture completed before it started");
  if (
    new Set(snapshot.endpoints.map((endpoint) => endpoint.name)).size !==
    snapshot.endpoints.length
  )
    throw new Error("Duplicate capture endpoint");
  if (
    new Set(snapshot.records.map((record) => recordKey(snapshot, record)))
      .size !== snapshot.records.length
  )
    throw new Error("Duplicate source record identity");
  for (const endpoint of snapshot.endpoints) {
    const records = snapshot.records.filter(
      (record) => record.kind === ENDPOINT_KINDS[endpoint.name],
    );
    if (
      endpoint.records !== records.length ||
      endpoint.digest !== recordDigest(records)
    )
      throw new Error("Capture endpoint evidence mismatch");
    if (
      (endpoint.complete || endpoint.stable) &&
      endpoint.reason !== "complete"
    )
      throw new Error("Capture flags conflict with failure evidence");
  }
  const kinds = new Set(
    snapshot.endpoints.map((endpoint) => ENDPOINT_KINDS[endpoint.name]),
  );
  if (snapshot.records.some((record) => !kinds.has(record.kind)))
    throw new Error("Record lacks endpoint provenance");
  const complete = REQUIRED_ENDPOINTS[snapshot.sourceKind].every((name) =>
    snapshot.endpoints.some(
      (endpoint) => endpoint.name === name && endpoint.complete,
    ),
  );
  const stable =
    complete && snapshot.endpoints.every((endpoint) => endpoint.stable);
  return {
    snapshot,
    complete,
    stable,
    captureHash: snapshotHash(z.json().parse(snapshot)),
  };
}
