import { z } from "zod";
import {
  RiotMatchIdSchema,
  S3ObjectKeySchema,
  Sha256DigestSchema,
  IsoInstantSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import {
  MatchProcessingPolicySchema,
  PipelineOwnerSchema,
  type PipelineOwner,
} from "@scout-for-lol/domain/match-processing/states.ts";
import { dateFromIsoInstant } from "#src/database/durable/row-values.ts";

/**
 * Row codec for MatchObservation.
 *
 * The row flattens the domain's processing facts: `pipelineOwner` NULL is the
 * `unowned` variant, and the promotion record is the nullable `promotedAt`
 * column (legal only under FULL, which both the CHECK constraint and this
 * codec's schema enforce). Receipts live in their own table; assembling a full
 * MatchProcessingState is the observation repository's job.
 */

const StoredArtifactReferenceSchema = z.strictObject({
  key: S3ObjectKeySchema,
  digest: Sha256DigestSchema,
});
export type StoredArtifactReference = z.infer<
  typeof StoredArtifactReferenceSchema
>;

export type MatchObservationRecord = z.infer<
  typeof MatchObservationRecordSchema
>;
export const MatchObservationRecordSchema = z
  .strictObject({
    matchId: RiotMatchIdSchema,
    platformRoute: PlatformRouteSchema,
    policy: MatchProcessingPolicySchema,
    owner: PipelineOwnerSchema,
    promotion: z.strictObject({ promotedAt: IsoInstantSchema }).nullable(),
    gameCreatedAt: IsoInstantSchema,
    observedAt: IsoInstantSchema,
    artifacts: z.strictObject({
      match: StoredArtifactReferenceSchema.nullable(),
      timeline: StoredArtifactReferenceSchema.nullable(),
    }),
  })
  .superRefine((record, ctx) => {
    if (record.policy === "ARCHIVE_ONLY" && record.promotion !== null) {
      ctx.addIssue({
        code: "custom",
        message: "an ARCHIVE_ONLY observation cannot carry a promotion record",
        path: ["promotion"],
      });
    }
    if (!record.matchId.startsWith(`${record.platformRoute}_`)) {
      ctx.addIssue({
        code: "custom",
        message: `platformRoute ${record.platformRoute} is not the platform prefix of ${record.matchId}`,
        path: ["platformRoute"],
      });
    }
  });

/** Column shape of a MatchObservation row, minus the DB-managed timestamps. */
export type MatchObservationRow = {
  riotMatchId: string;
  platformRoute: string;
  processingPolicy: string;
  pipelineOwner: string | null;
  promotedAt: Date | null;
  gameCreatedAt: Date;
  observedAt: Date;
  matchObjectKey: string | null;
  matchDigest: string | null;
  timelineObjectKey: string | null;
  timelineDigest: string | null;
};

const RawObservationRowSchema = z.object({
  riotMatchId: z.string(),
  platformRoute: z.string(),
  processingPolicy: z.string(),
  pipelineOwner: z.string().nullable(),
  promotedAt: z.date().nullable(),
  gameCreatedAt: z.date(),
  observedAt: z.date(),
  matchObjectKey: z.string().nullable(),
  matchDigest: z.string().nullable(),
  timelineObjectKey: z.string().nullable(),
  timelineDigest: z.string().nullable(),
});

function ownerFromColumn(column: string | null): { kind: string } {
  switch (column) {
    case null:
      return { kind: "unowned" };
    case "LEGACY_V1":
      return { kind: "legacy-v1" };
    case "TEMPORAL_V2":
      return { kind: "temporal-v2" };
    default:
      throw new Error(`Unknown pipelineOwner column value: ${column}`);
  }
}

function ownerToColumn(owner: PipelineOwner): string | null {
  switch (owner.kind) {
    case "unowned":
      return null;
    case "legacy-v1":
      return "LEGACY_V1";
    case "temporal-v2":
      return "TEMPORAL_V2";
  }
}

function artifactCandidate(
  key: string | null,
  digest: string | null,
): { key: string; digest: string } | null {
  if (key === null || digest === null) {
    if (key !== null || digest !== null) {
      throw new Error(
        "artifact reference columns must be paired: key and digest are always stored together",
      );
    }
    return null;
  }
  return { key, digest };
}

export function matchObservationRowToRecord(
  row: unknown,
): MatchObservationRecord {
  const raw = RawObservationRowSchema.parse(row);
  return MatchObservationRecordSchema.parse({
    matchId: raw.riotMatchId,
    platformRoute: raw.platformRoute,
    policy: raw.processingPolicy,
    owner: ownerFromColumn(raw.pipelineOwner),
    promotion:
      raw.promotedAt === null
        ? null
        : { promotedAt: raw.promotedAt.toISOString() },
    gameCreatedAt: raw.gameCreatedAt.toISOString(),
    observedAt: raw.observedAt.toISOString(),
    artifacts: {
      match: artifactCandidate(raw.matchObjectKey, raw.matchDigest),
      timeline: artifactCandidate(raw.timelineObjectKey, raw.timelineDigest),
    },
  });
}

export function matchObservationRecordToRow(
  record: MatchObservationRecord,
): MatchObservationRow {
  return {
    riotMatchId: record.matchId,
    platformRoute: record.platformRoute,
    processingPolicy: record.policy,
    pipelineOwner: ownerToColumn(record.owner),
    promotedAt:
      record.promotion === null
        ? null
        : dateFromIsoInstant(record.promotion.promotedAt),
    gameCreatedAt: dateFromIsoInstant(record.gameCreatedAt),
    observedAt: dateFromIsoInstant(record.observedAt),
    matchObjectKey: record.artifacts.match?.key ?? null,
    matchDigest: record.artifacts.match?.digest ?? null,
    timelineObjectKey: record.artifacts.timeline?.key ?? null,
    timelineDigest: record.artifacts.timeline?.digest ?? null,
  };
}
