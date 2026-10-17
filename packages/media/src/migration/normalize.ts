import { z } from "zod";
import {
  AdoptionTargetSchema,
  MigrationReportSchema,
  type MigrationRecord,
} from "#shared/migration.ts";
import {
  validateCapture,
  recordKey,
} from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "./profile-import.ts";
import {
  buildNormalizationIndex,
  externalKeys,
  type NormalizationIndex,
} from "./normalization-index.ts";

type Target = z.infer<typeof AdoptionTargetSchema>;
type Match = {
  mediaIds: string[];
  reasons: string[];
  confidence: "exact" | "unknown" | "ambiguous";
};
type Options = {
  targets: readonly Target[];
  requesters?: readonly { plexAccountId: string; userId: string }[];
};
function sharesIds(
  ids: Target["externalIds"],
  target: Target["externalIds"],
): boolean {
  const keys = ["tmdb", "tvdb", "imdb"] as const;
  return (
    keys.some((key) => ids[key] !== undefined && target[key] !== undefined) &&
    keys.every(
      (key) =>
        ids[key] === undefined ||
        target[key] === undefined ||
        ids[key] === target[key],
    )
  );
}
function identityFields(
  record: Extract<MigrationRecord, { kind: "media" | "request" }>,
  index: NormalizationIndex,
) {
  const parent =
    record.kind === "media" && record.parentSourceId !== null
      ? index.media.get(record.parentSourceId)
      : undefined;
  const kind = record.kind === "media" ? record.mediaKind : record.scope;
  const season = record.kind === "media" ? record.season : null;
  const episode = record.kind === "media" ? record.episode : null;
  const ids =
    kind === "episode" && parent?.mediaKind === "series"
      ? parent.externalIds
      : record.externalIds;
  return { ids, kind, season, episode };
}
function identity(
  record: Extract<MigrationRecord, { kind: "media" | "request" }>,
  index: NormalizationIndex,
): Match {
  const { ids, kind, season, episode } = identityFields(record, index);
  const candidates = new Set(
    externalKeys(ids, kind, season, episode).flatMap(
      (key) => index.identities.get(key) ?? [],
    ),
  );
  const matched: Target[] = [];
  for (const target of candidates) {
    const targetIds =
      target.kind === "episode"
        ? (target.seriesExternalIds ?? target.externalIds)
        : target.externalIds;
    if (sharesIds(ids, targetIds)) matched.push(target);
    if (matched.length === 2) break;
  }
  return {
    mediaIds: matched.map((target) => target.mediaId),
    confidence:
      matched.length === 1
        ? "exact"
        : matched.length > 1
          ? "ambiguous"
          : "unknown",
    reasons:
      matched.length === 1
        ? []
        : [matched.length > 1 ? "ambiguous_identity" : "identity_unmapped"],
  };
}
function coverage(
  record: Extract<
    MigrationRecord,
    { kind: "file" | "subtitle" | "subtitle_preference" }
  >,
  index: NormalizationIndex,
): Match {
  const ids =
    record.kind === "file" ? record.mediaSourceIds : [record.mediaSourceId];
  const matches = ids.map((id) => {
    const media = index.media.get(id);
    return media?.kind === "media"
      ? identity(media, index)
      : {
          mediaIds: [],
          reasons: ["coverage_unmapped"],
          confidence: "unknown" as const,
        };
  });
  return {
    mediaIds: [...new Set(matches.flatMap((match) => match.mediaIds))],
    confidence: matches.every((match) => match.confidence === "exact")
      ? "exact"
      : matches.some((match) => match.confidence === "ambiguous")
        ? "ambiguous"
        : "unknown",
    reasons: [...new Set(matches.flatMap((match) => match.reasons))],
  };
}
function normalizeRequest(
  record: Extract<MigrationRecord, { kind: "request" }>,
  index: NormalizationIndex,
  options: Options,
): Match {
  const match = identity(record, index);
  if (
    record.plexAccountId === null ||
    record.requesterMappingEvidenceHash === null ||
    options.requesters?.some(
      (user) => user.plexAccountId === record.plexAccountId,
    ) !== true
  )
    match.reasons.push("requester_unmapped");
  if (record.scope === "episode" || record.scope === "season")
    match.reasons.push("partial_scope_unresolved");
  return match;
}
function normalizeRecord(
  record: MigrationRecord,
  index: NormalizationIndex,
  options: Options,
): Match {
  if (record.kind === "media") return identity(record, index);
  if (record.kind === "request")
    return normalizeRequest(record, index, options);
  if (record.kind === "torrent")
    return {
      mediaIds: [],
      confidence: "unknown",
      reasons: [
        record.managerAssociations.length === 0
          ? "manager_association_missing"
          : "cross_capture_association_requires_review",
        "ownership_handoff_missing",
      ],
    };
  const match = coverage(record, index);
  if (
    record.kind === "subtitle_preference" &&
    record.sourceProfile !== undefined
  )
    match.reasons.push("source_subtitle_policy_requires_review");
  if (
    (record.kind === "subtitle" || record.kind === "subtitle_preference") &&
    record.managerReference !== undefined
  )
    match.reasons.push("manager_instance_binding_requires_review");
  if (record.kind === "file" || record.kind === "subtitle") {
    if (record.checksum === null) match.reasons.push("checksum_unknown");
    else if (
      match.mediaIds.some(
        (id) => index.targetIds.get(id)?.checksum !== record.checksum,
      )
    )
      match.reasons.push("checksum_not_verified");
  }
  if (record.kind === "subtitle" && record.provenance === "unknown")
    match.reasons.push("subtitle_provenance_unknown");
  return match;
}
export function normalizeCapture(value: unknown, options: Options) {
  const capture = validateCapture(value);
  const targets = options.targets.map((target) =>
    AdoptionTargetSchema.parse(target),
  );
  const index = buildNormalizationIndex(capture.snapshot, targets);
  const entries = capture.snapshot.records.map((record) => {
    const match = normalizeRecord(record, index, {
      ...options,
      targets,
    });
    if (!capture.complete) match.reasons.push("capture_incomplete");
    if (!capture.stable) match.reasons.push("capture_unstable");
    if (
      record.kind === "file" &&
      [
        `path:${record.path}`,
        ...record.mediaSourceIds.map((id) => `media:${id}`),
      ].some((key) => (index.fileCoverage.get(key) ?? 0) > 1)
    )
      match.reasons.push("overlapping_file_coverage");
    const state =
      match.confidence === "exact"
        ? match.reasons.length > 0
          ? "protected_exact"
          : "adoptable_evidence_ready"
        : "protected";
    return {
      sourceRecord: record,
      mappedMedia: match.mediaIds.map((mediaId) => ({
        mediaId,
        title: index.targetIds.get(mediaId)?.title ?? null,
      })),
      provenanceKey: recordKey(capture.snapshot, record),
      sourceId: record.sourceId,
      kind: record.kind,
      observationHash: snapshotHash(z.json().parse(record)),
      ...match,
      state,
      owned: false,
    };
  });
  const report = {
    schemaVersion: 1,
    captureHash: capture.captureHash,
    complete: capture.complete,
    stable: capture.stable,
    entries,
    mayTransferOwnership: false,
  };
  return MigrationReportSchema.parse({
    ...report,
    reportHash: snapshotHash(z.json().parse(report)),
  });
}
