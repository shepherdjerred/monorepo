import { z } from "zod";
import {
  SubtitleSourceProfileSchema,
  SubtitleManagerReferenceSchema,
} from "./migration-subtitles.ts";

export const MAX_MIGRATION_RECORDS = 50_000;
export const MAX_MIGRATION_PAGES = 500;
export const MAX_MIGRATION_BYTES = 24 * 1024 * 1024;
export const EvidenceHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const SourceKindSchema = z.enum([
  "radarr",
  "sonarr",
  "overseerr",
  "jellyseerr",
  "seerr",
  "bazarr",
  "qbittorrent",
]);
const SourceId = z.string().regex(/^[\w:.-]{1,200}$/u);
const Label = z
  .string()
  .max(100)
  .regex(/^[\p{L}\p{N} ._-]*$/u);
const Path = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.includes("://") &&
      !/[?#\r\n\0]/u.test(value),
    "Expected an absolute local path without URL parameters",
  );
const ExternalIds = z.strictObject({
  tmdb: z.number().int().positive().optional(),
  tvdb: z.number().int().positive().optional(),
  imdb: z
    .string()
    .regex(/^tt\d+$/u)
    .optional(),
});
const Base = z.strictObject({ sourceId: SourceId });
const Media = Base.extend({
  kind: z.literal("media"),
  mediaKind: z.enum(["movie", "series", "season", "episode"]),
  externalIds: ExternalIds,
  parentSourceId: SourceId.nullable(),
  season: z.number().int().nonnegative().nullable(),
  episode: z.number().int().nonnegative().nullable(),
  profileSourceId: SourceId.nullable(),
  monitored: z.boolean(),
});
const File = Base.extend({
  kind: z.literal("file"),
  mediaSourceIds: z.array(SourceId).min(1).max(1000),
  path: Path,
  sizeBytes: z.number().int().nonnegative(),
  checksum: EvidenceHashSchema.nullable(),
  downloadHash: z
    .string()
    .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
    .nullable(),
  qualitySourceId: SourceId.nullable(),
});
const Request = Base.extend({
  kind: z.literal("request"),
  requesterSourceId: SourceId,
  plexAccountId: z.string().regex(/^\d+$/u).nullable(),
  requesterMappingEvidenceHash: EvidenceHashSchema.nullable(),
  externalIds: ExternalIds,
  scope: z.enum(["movie", "series", "season", "episode"]),
  seasons: z.array(z.number().int().nonnegative()).max(1000),
  active: z.boolean(),
});
const Preference = Base.extend({
  kind: z.literal("subtitle_preference"),
  mediaSourceId: SourceId,
  languages: z
    .array(z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]+)?$/u))
    .max(20),
  hearingImpaired: z.boolean().nullable(),
  forced: z.boolean().nullable(),
  sourceProfile: SubtitleSourceProfileSchema.nullable().optional(),
  managerReference: SubtitleManagerReferenceSchema.optional(),
});
const Subtitle = Base.extend({
  kind: z.literal("subtitle"),
  mediaSourceId: SourceId,
  path: Path.nullable(),
  videoPath: Path.nullable().optional(),
  embeddedTrackId: z.number().int().nonnegative().nullable().optional(),
  forced: z.boolean().nullable().optional(),
  hearingImpaired: z.boolean().nullable().optional(),
  managerReference: SubtitleManagerReferenceSchema.optional(),
  language: z.string().max(30),
  checksum: EvidenceHashSchema.nullable(),
  provenance: z.enum(["embedded", "provider", "unknown"]),
});
const Torrent = Base.extend({
  kind: z.literal("torrent"),
  infoHash: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
  wireId: z.string().regex(/^[a-f0-9]{40}$/u),
  infoHashV1: z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .nullable(),
  infoHashV2: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  category: Label,
  tags: z.array(Label).max(100),
  savePath: Path,
  progress: z.number().min(0).max(1),
  ratioLimit: z.number().min(-2),
  seedingTimeLimitMinutes: z.number().int().min(-2),
  inactiveSeedingTimeLimitMinutes: z.number().int().min(-2),
  effectiveRatioLimit: z.number().min(-1),
  effectiveSeedingTimeLimitMinutes: z.number().int().min(-1),
  effectiveInactiveSeedingTimeLimitMinutes: z.number().int().min(-1),
  ratio: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("finite"),
      value: z.number().nonnegative(),
    }),
    z.strictObject({ kind: z.literal("infinite") }),
  ]),
  seededSeconds: z.number().int().nonnegative(),
  shareLimitAction: z.enum([
    "Default",
    "Stop",
    "Remove",
    "RemoveWithContent",
    "EnableSuperSeeding",
  ]),
  automaticManagement: z.boolean(),
  forceStarted: z.boolean(),
  managerAssociations: z
    .array(
      z.strictObject({
        sourceInstanceId: EvidenceHashSchema,
        sourceMediaId: SourceId,
        evidenceHash: EvidenceHashSchema,
      }),
    )
    .max(1000),
});
export const MigrationRecordSchema = z.discriminatedUnion("kind", [
  Media,
  File,
  Request,
  Preference,
  Subtitle,
  Torrent,
]);
export type MigrationRecord = z.infer<typeof MigrationRecordSchema>;
export const MigrationEndpointSchema = z.strictObject({
  name: z.enum([
    "media",
    "files",
    "requests",
    "subtitle_preferences",
    "subtitles",
    "torrents",
  ]),
  pages: z.number().int().nonnegative().max(MAX_MIGRATION_PAGES),
  records: z.number().int().nonnegative().max(MAX_MIGRATION_RECORDS),
  complete: z.boolean(),
  stable: z.boolean(),
  digest: EvidenceHashSchema,
  reason: z.enum([
    "complete",
    "page_limit",
    "record_limit",
    "read_failed",
    "unsupported",
    "source_changed",
  ]),
});
export const MigrationSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sourceInstanceId: EvidenceHashSchema,
  sourceKind: SourceKindSchema,
  sourceVersion: z.string().regex(/^[\w.+-]{1,100}$/u),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  endpoints: z.array(MigrationEndpointSchema).min(1).max(6),
  records: z.array(MigrationRecordSchema).max(MAX_MIGRATION_RECORDS),
});
export type MigrationSnapshot = z.infer<typeof MigrationSnapshotSchema>;
export const AdoptionTargetSchema = z.strictObject({
  mediaId: z.uuid(),
  title: z.string().min(1).max(500).optional(),
  kind: z.enum(["movie", "series", "season", "episode"]),
  externalIds: ExternalIds,
  seriesExternalIds: ExternalIds.optional(),
  season: z.number().int().nonnegative().nullable(),
  episode: z.number().int().nonnegative().nullable(),
  checksum: EvidenceHashSchema.nullable(),
});
export const MigrationReportEntrySchema = z.strictObject({
  sourceRecord: MigrationRecordSchema,
  mappedMedia: z
    .array(z.strictObject({ mediaId: z.uuid(), title: z.string().nullable() }))
    .max(1000),
  provenanceKey: EvidenceHashSchema,
  sourceId: SourceId,
  kind: z.enum([
    "media",
    "file",
    "request",
    "subtitle_preference",
    "subtitle",
    "torrent",
  ]),
  observationHash: EvidenceHashSchema,
  mediaIds: z.array(z.uuid()),
  confidence: z.enum(["exact", "ambiguous", "unknown"]),
  state: z.enum(["protected", "protected_exact", "adoptable_evidence_ready"]),
  reasons: z.array(z.string().max(100)),
  owned: z.literal(false),
});
export const MigrationReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  captureHash: EvidenceHashSchema,
  reportHash: EvidenceHashSchema,
  complete: z.boolean(),
  stable: z.boolean(),
  entries: z.array(MigrationReportEntrySchema).max(MAX_MIGRATION_RECORDS),
  mayTransferOwnership: z.literal(false),
});
export type MigrationReport = z.infer<typeof MigrationReportSchema>;
export const MigrationProposalSchema = z.strictObject({
  source: z.strictObject({
    kind: SourceKindSchema,
    instanceId: EvidenceHashSchema,
    version: z.string().max(100),
  }),
  id: z.uuid(),
  captureId: z.uuid(),
  reportHash: EvidenceHashSchema,
  captureHash: EvidenceHashSchema,
  recoveryEpoch: z.number().int().nonnegative(),
  runtimeVersion: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  status: z.enum(["protected", "awaiting_review", "approved", "revoked"]),
  createdAt: z.iso.datetime(),
  report: MigrationReportSchema,
});
export const MigrationProposalSummarySchema = MigrationProposalSchema.omit({
  report: true,
});
export const MigrationProposalListSchema = z
  .array(MigrationProposalSummarySchema)
  .max(100);
export const UploadMigrationSchema = z.strictObject({
  snapshot: MigrationSnapshotSchema,
});
export const ReviewMigrationSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  reportHash: EvidenceHashSchema,
  captureHash: EvidenceHashSchema,
  recoveryEpoch: z.number().int().nonnegative(),
  runtimeVersion: z.number().int().nonnegative(),
  action: z.enum(["approve", "revoke"]),
  acknowledgeNoOwnershipTransfer: z.literal(true),
});
