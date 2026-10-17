import { z } from "zod";
import type { AdoptionTargetSchema } from "#shared/migration.ts";
import {
  MAX_MIGRATION_RECORDS,
  type MigrationSnapshot,
} from "#shared/migration.ts";
import {
  MigrationBundleSchema,
  BundleReportSchema,
  MigrationSelectionSchema,
  MigrationRootMappingSchema,
} from "#shared/migration-handoff.ts";
import { validateCapture } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "./profile-import.ts";
import { normalizeCapture } from "./normalize.ts";
import { canonicalOrder } from "./canonical-order.ts";
import { bundleAssociations } from "./bundle-associations.ts";

type Captured = { id: string; snapshot: MigrationSnapshot };
type Context = {
  targets: z.infer<typeof AdoptionTargetSchema>[];
  requesters: { userId: string; plexAccountId: string }[];
  rootMappings?: z.infer<typeof MigrationRootMappingSchema>[];
};
function checkedCaptures(captures: Captured[]) {
  if (
    captures.length === 0 ||
    captures.length > 20 ||
    new Set(captures.map((capture) => capture.id)).size !== captures.length
  )
    throw new Error("Invalid bundle capture set");
  const checked = captures.map((capture) => ({
    id: capture.id,
    ...validateCapture(capture.snapshot),
  }));
  if (
    new Set(
      checked.map(
        (capture) =>
          `${capture.snapshot.sourceKind}:${capture.snapshot.sourceInstanceId}`,
      ),
    ).size !== captures.length
  )
    throw new Error("Bundle has multiple captures of the same source instance");
  if (
    checked.reduce((sum, capture) => sum + capture.snapshot.records.length, 0) >
    MAX_MIGRATION_RECORDS
  )
    throw new Error("Bundle exceeds record limit");
  return checked;
}
function protectEntries(
  entries: z.infer<typeof BundleReportSchema>["entries"],
  stable: boolean,
) {
  const paths = new Map<string, number>();
  for (const file of entries
    .map((entry) => entry.sourceRecord)
    .filter((record) => record.kind === "file"))
    paths.set(file.path, (paths.get(file.path) ?? 0) + 1);
  for (const entry of entries) {
    if (!stable) entry.reasons.push("bundle_incomplete_or_unstable");
    if (entry.sourceRecord.kind === "file") {
      entry.reasons.push("live_mount_and_checksum_proof_required");
      if ((paths.get(entry.sourceRecord.path) ?? 0) > 1)
        entry.reasons.push("cross_source_file_overlap");
    }
    if (entry.reasons.length > 0)
      entry.state =
        entry.confidence === "exact" ? "protected_exact" : "protected";
  }
}
/** Captures remain immutable. Cross-source identity evidence is never itself an ownership handoff. */
export function buildMigrationBundle(captures: Captured[], context: Context) {
  const checked = checkedCaptures(captures);
  const kinds = new Set(checked.map((capture) => capture.snapshot.sourceKind));
  const rootMappings = z
    .array(MigrationRootMappingSchema)
    .max(100)
    .parse(context.rootMappings ?? []);
  if (
    rootMappings.some(
      (mapping) =>
        !captures.some((capture) => capture.id === mapping.captureId),
    )
  )
    throw new Error("Root mapping references a capture outside this bundle");
  const requiredSources = [
    "radarr",
    "sonarr",
    "bazarr",
    "qbittorrent",
    kinds.has("seerr")
      ? "seerr"
      : kinds.has("jellyseerr")
        ? "jellyseerr"
        : "overseerr",
  ] as const;
  const complete =
    requiredSources.every((kind) => kinds.has(kind)) &&
    checked.every((capture) => capture.complete);
  const stable = complete && checked.every((capture) => capture.stable);
  const descriptor = {
    schemaVersion: 1,
    captures: checked
      .map((capture) => ({
        captureId: capture.id,
        captureHash: capture.captureHash,
        sourceKind: capture.snapshot.sourceKind,
        sourceInstanceId: capture.snapshot.sourceInstanceId,
      }))
      .sort((a, b) => canonicalOrder(a.captureHash, b.captureHash)),
    associations: bundleAssociations(checked).sort((a, b) =>
      canonicalOrder(a.evidenceHash, b.evidenceHash),
    ),
    requiredSources: [...requiredSources],
    complete,
    stable,
    rootMappings: rootMappings.sort((a, b) =>
      canonicalOrder(
        `${a.captureId}:${a.sourceRoot}`,
        `${b.captureId}:${b.sourceRoot}`,
      ),
    ),
  };
  const manifest = MigrationBundleSchema.parse({
    ...descriptor,
    bundleHash: snapshotHash(z.json().parse(descriptor)),
  });
  const entries = checked.flatMap((capture) =>
    normalizeCapture(capture.snapshot, context).entries.map((entry) => ({
      ...entry,
      captureHash: capture.captureHash,
    })),
  );
  protectEntries(entries, stable);
  entries.sort((a, b) => canonicalOrder(a.provenanceKey, b.provenanceKey));
  const report = {
    schemaVersion: 1,
    bundleHash: manifest.bundleHash,
    complete,
    stable,
    entries,
    mayTransferOwnership: false,
  };
  return {
    manifest,
    report: BundleReportSchema.parse({
      ...report,
      reportHash: snapshotHash(z.json().parse(report)),
    }),
  };
}
export function validateBundleSelection(
  report: z.infer<typeof BundleReportSchema>,
  input: unknown,
) {
  const selected = MigrationSelectionSchema.parse(input);
  if (
    new Set(selected.map((item) => item.provenanceKey)).size !== selected.length
  )
    throw new Error("Duplicate migration selection");
  const entries = new Map(
    report.entries.map((entry) => [entry.provenanceKey, entry]),
  );
  for (const item of selected) {
    const entry = entries.get(item.provenanceKey);
    if (
      entry?.state !== "adoptable_evidence_ready" ||
      entry.observationHash !== item.evidenceHash
    )
      throw new Error("Migration selection is protected, absent or changed");
  }
  return selected.sort((a, b) =>
    canonicalOrder(a.provenanceKey, b.provenanceKey),
  );
}
