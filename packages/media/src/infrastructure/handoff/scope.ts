import path from "node:path";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import {
  BundleReportSchema,
  MigrationBundleSchema,
  MigrationSelectionSchema,
} from "#shared/migration-handoff.ts";
import {
  HandoffScopeSchema,
  type PrepareHandoffSchema,
} from "#shared/handoff.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { selectedHandoffEntries } from "./selection.ts";
import { projectHandoffSubtitles } from "./subtitles.ts";

type Input = z.infer<typeof PrepareHandoffSchema>;
type Entry = z.infer<typeof BundleReportSchema>["entries"][number];
const conflict = (code: string) =>
  new MediaError(
    code,
    "Handoff evidence changed or requires explicit reconciliation",
    409,
  );

export async function buildHandoffScope(
  tx: Prisma.TransactionClient,
  input: Input,
) {
  const { review, manifest, report } = await reviewedBundle(tx, input);
  const approved = MigrationSelectionSchema.parse(review.selection);
  const selected = await selectedHandoffEntries(tx, {
    report,
    approved,
    selected: input.selected,
  });
  return projectScope(tx, { input, manifest, report, selected });
}

async function reviewedBundle(tx: Prisma.TransactionClient, input: Input) {
  const review = await tx.migrationBundleReview.findUniqueOrThrow({
    where: { id: input.bundleReviewId },
    include: { bundle: true },
  });
  const manifest = MigrationBundleSchema.parse(review.bundle.manifest);
  const report = BundleReportSchema.parse(review.report);
  if (
    review.status !== "approved" ||
    review.version !== input.bundleReviewVersion ||
    review.reportHash !== input.reportHash ||
    manifest.bundleHash !== input.bundleHash ||
    review.recoveryEpoch !== input.recoveryEpoch ||
    review.runtimeVersion > input.runtimeVersion ||
    !manifest.complete ||
    !manifest.stable ||
    !report.complete ||
    !report.stable
  )
    throw conflict("handoff_review_changed");
  return { review, manifest, report };
}

async function projectScope(
  tx: Prisma.TransactionClient,
  options: {
    input: Input;
    manifest: z.infer<typeof MigrationBundleSchema>;
    report: z.infer<typeof BundleReportSchema>;
    selected: Entry[];
  },
) {
  const { input, manifest, report, selected } = options;
  const mediaIds = [...new Set(selected.flatMap((entry) => entry.mediaIds))];
  const media = await tx.mediaItem.findMany({
    where: { id: { in: mediaIds } },
    include: { intent: true, parent: { include: { parent: true } } },
  });
  if (media.length !== mediaIds.length)
    throw conflict("handoff_catalog_changed");
  const profiles = await resolveProfiles(tx, input, manifest);
  const projections = media.map((item) => {
    const ancestry = [item.id, item.parent?.id, item.parent?.parent?.id];
    const source = report.entries.find(
      (entry) =>
        entry.kind === "media" &&
        entry.confidence === "exact" &&
        ancestry.some(
          (id) => id !== undefined && entry.mediaIds.includes(id),
        ) &&
        entry.sourceRecord.kind === "media" &&
        entry.sourceRecord.profileSourceId !== null,
    );
    const record = source?.sourceRecord;
    const capture = manifest.captures.find(
      (binding) => binding.captureHash === source?.captureHash,
    );
    const profile =
      capture !== undefined &&
      record?.kind === "media" &&
      record.profileSourceId !== null
        ? profiles.get(`${capture.captureId}:${record.profileSourceId}`)
        : undefined;
    return {
      mediaId: item.id,
      version: item.version,
      generation: item.intent?.generation ?? null,
      profileId: profile?.id ?? null,
      profileVersion: profile?.version ?? null,
      monitored: record?.kind === "media" && record.monitored,
    };
  });
  const files = [];
  const claims = [];
  const protectedRecords = [];
  for (const entry of selected) {
    if (entry.sourceRecord.kind === "file")
      files.push(await projectFile(tx, entry, manifest, media));
    else if (entry.sourceRecord.kind === "request") {
      const claim = await projectClaim(tx, entry);
      if (claim === null)
        protectedRecords.push({
          provenanceKey: entry.provenanceKey,
          reason: "request_mapping_requires_review",
        });
      else claims.push(claim);
    } else if (
      entry.kind !== "media" &&
      entry.kind !== "subtitle" &&
      entry.kind !== "subtitle_preference"
    )
      protectedRecords.push({
        provenanceKey: entry.provenanceKey,
        reason:
          entry.kind === "torrent"
            ? "protected_legacy_source"
            : "subtitle_policy_requires_reconciliation",
      });
  }
  return HandoffScopeSchema.parse({
    request: input,
    media: projections,
    files,
    claims,
    protected: protectedRecords,
    ...(await projectHandoffSubtitles({
      tx,
      request: input,
      manifest,
      selected,
      files,
    })),
  });
}

async function projectClaim(tx: Prisma.TransactionClient, entry: Entry) {
  const record = entry.sourceRecord;
  if (record.kind !== "request") throw new Error("Expected request record");
  const user =
    record.plexAccountId === null
      ? null
      : await tx.mediaUser.findUnique({
          where: { plexAccountId: record.plexAccountId },
        });
  if (
    user === null ||
    !record.active ||
    record.requesterMappingEvidenceHash === null ||
    !["movie", "series"].includes(record.scope) ||
    record.seasons.length > 0 ||
    entry.mediaIds.length !== 1
  )
    return null;
  return {
    provenanceKey: entry.provenanceKey,
    userId: user.id,
    mediaId: z.uuid().parse(entry.mediaIds[0]),
    includeFutureEpisodes: record.scope === "series",
    subtitleLanguages: [],
  };
}

async function resolveProfiles(
  tx: Prisma.TransactionClient,
  input: Input,
  manifest: z.infer<typeof MigrationBundleSchema>,
) {
  const result = new Map<string, { id: string; version: number }>();
  for (const binding of input.profiles) {
    const capture = manifest.captures.find(
      (item) => item.captureId === binding.captureId,
    );
    const version = await tx.qualityProfileVersion.findUnique({
      where: {
        profileId_version: {
          profileId: binding.profileId,
          version: binding.version,
        },
      },
      include: { profile: true },
    });
    const resolved =
      version === null
        ? undefined
        : QualityRulesSchema.parse(version.rules).resolved;
    if (
      capture === undefined ||
      version === null ||
      resolved === undefined ||
      version.profile.version !== binding.version ||
      resolved.snapshotHash !== binding.snapshotHash ||
      String(resolved.profile.id) !== binding.sourceProfileId ||
      resolved.source !== capture.sourceKind
    )
      throw conflict("handoff_profile_changed");
    result.set(`${capture.captureId}:${binding.sourceProfileId}`, {
      id: binding.profileId,
      version: binding.version,
    });
  }
  return result;
}

async function projectFile(
  tx: Prisma.TransactionClient,
  entry: Entry,
  manifest: z.infer<typeof MigrationBundleSchema>,
  media: { id: string; kind: string }[],
) {
  const source = entry.sourceRecord;
  if (source.kind !== "file") throw new Error("Expected file record");
  const capture = manifest.captures.find(
    (item) => item.captureHash === entry.captureHash,
  );
  const mappings = manifest.rootMappings.filter(
    (item) =>
      item.captureId === capture?.captureId &&
      source.path.startsWith(`${item.sourceRoot.replace(/\/$/u, "")}/`),
  );
  if (capture === undefined || mappings.length !== 1)
    throw conflict("handoff_mount_mapping_ambiguous");
  const mapping = mappings[0];
  if (mapping === undefined) throw conflict("handoff_mount_mapping_absent");
  const relative = path.relative(mapping.sourceRoot, source.path);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw conflict("handoff_path_escape");
  const canonicalPath = path.join(mapping.canonicalRoot, relative);
  const existing = await tx.libraryAsset.findUnique({
    where: { path: canonicalPath },
    include: { coverage: { where: { current: true } } },
  });
  assertExistingCoverage(existing, entry.mediaIds);
  const kinds = new Set(
    media
      .filter((item) => entry.mediaIds.includes(item.id))
      .map((item) => item.kind),
  );
  if (kinds.size !== 1 || (!kinds.has("movie") && !kinds.has("episode")))
    throw conflict("handoff_physical_coverage_unresolved");
  return {
    provenanceKey: entry.provenanceKey,
    captureId: capture.captureId,
    mediaIds: entry.mediaIds,
    sourcePath: source.path,
    canonicalPath,
    libraryKind: kinds.has("movie") ? ("movies" as const) : ("tv" as const),
    sizeBytes: String(source.sizeBytes),
    capturedChecksum: source.checksum,
    qualitySourceId: source.qualitySourceId,
    existingAssetId: existing?.id ?? null,
    existingAssetVersion: existing?.version ?? null,
    assetId: existing?.id ?? crypto.randomUUID(),
  };
}

function assertExistingCoverage(
  existing: { state: string; coverage: { mediaId: string }[] } | null,
  mediaIds: string[],
): void {
  if (
    existing !== null &&
    (existing.state !== "published" ||
      existing.coverage.length !== mediaIds.length ||
      existing.coverage.some((item) => !mediaIds.includes(item.mediaId)))
  )
    throw conflict("handoff_asset_coverage_changed");
}
