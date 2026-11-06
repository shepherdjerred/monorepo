import type { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import {
  RecoveryClaimProjectionSchema,
  type RecoveryClaimProjection,
} from "#shared/recovery-claims.ts";
import { MigrationRecordSchema } from "#shared/migration.ts";
import type { BundleReportSchema } from "#shared/migration-handoff.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  bindingIdentity,
  durableBindingIdentity,
} from "#infrastructure/recovery/legacy-claims/bindings.ts";
import {
  parseStoredClaim,
  relevantRecordWhere,
} from "#infrastructure/recovery/legacy-claims/records.ts";
import { projectLegacyCoordinates } from "#infrastructure/recovery/legacy-claims/coordinates.ts";
import { claimIdentityHash } from "#infrastructure/recovery/legacy-claims/accounting.ts";
import { accountedMovieClaimsV3 } from "./accounting.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));
type Stored = Prisma.MigrationRecordGetPayload<{ include: { capture: true } }>;
type Item = Prisma.MediaItemGetPayload<{
  include: { parent: { include: { parent: true } } };
}>;
type Binding = Prisma.LegacyRequesterBindingGetPayload<{
  include: { user: { include: { plexIdentity: true } } };
}>;

/** Rebuild real claim identities before exact-cut accounting; old id-only ledgers are never pre-applied. */
export async function buildMovieRecoveryClaimsV3(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    epoch: number;
    report?: z.infer<typeof BundleReportSchema>;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: input.scope.mediaId },
    include: { parent: { include: { parent: true } } },
  });
  if (media.kind !== "movie" || media.id !== input.scope.rootMediaId)
    throw new Error(
      "Movie household claim projection requires one exact canonical movie",
    );
  const records = await tx.migrationRecord.findMany({
    where: relevantRecordWhere([media]),
    include: { capture: true },
    orderBy: [{ captureId: "asc" }, { provenanceKey: "asc" }],
    take: budget.takeWeighted(2),
  });
  budget.consume(records.length * 2);
  const accounted = await accountedMovieClaimsV3(tx, input, budget);
  const claims: RecoveryClaimProjection[] = [];
  const relevantClaims: { userId: string; mediaIds: string[] }[] = [];
  const blockers = new Set<string>();
  for (const stored of records) {
    const projected = await projectMovieClaim(tx, { stored, media }, budget);
    if (projected.kind === "irrelevant") continue;
    if (projected.kind === "protected") {
      blockers.add(projected.reason);
      continue;
    }
    relevantClaims.push({
      userId: projected.claim.userId,
      mediaIds: [media.id],
    });
    if (!accounted.identities.has(claimIdentityHash(projected.claim)))
      claims.push(projected.claim);
  }
  if (hasMissingSourceClaim(input.report, records, media))
    blockers.add("unresolved_migration_household_claim");
  return {
    claims,
    relevantClaims,
    blockers: [...blockers].sort(),
    sql: {
      records: records.length,
      scopedReceipts: accounted.scopedReceipts,
      defaultReceipts: accounted.defaultReceipts,
    },
  };
}

async function projectMovieClaim(
  tx: Prisma.TransactionClient,
  input: { stored: Stored; media: Item },
  budget: PublicationAuthorityReadBudget,
) {
  const { stored, media } = input;
  const record = parseStoredClaim(stored);
  if (record.kind !== "request" || !record.active)
    return { kind: "irrelevant" as const };
  const coordinates = await projectLegacyCoordinates(tx, record, [media]);
  if (!coordinates.relevant) return { kind: "irrelevant" as const };
  if (!stored.capture.complete || !stored.capture.stable)
    return {
      kind: "protected" as const,
      reason: "legacy_claim_capture_incomplete",
    };
  if (coordinates.reason !== null)
    return { kind: "protected" as const, reason: coordinates.reason };
  if (
    !["overseerr", "jellyseerr", "seerr"].includes(stored.capture.sourceKind) ||
    record.scope !== "movie"
  )
    return {
      kind: "protected" as const,
      reason: "movie_legacy_claim_source_unsupported",
    };
  const binding = await tx.legacyRequesterBinding.findFirst({
    where: {
      captureId: stored.captureId,
      sourceKind: stored.capture.sourceKind,
      sourceInstanceId: stored.capture.sourceInstanceId,
      requesterSourceId: record.requesterSourceId,
    },
    orderBy: { revision: "desc" },
    include: { user: { include: { plexIdentity: true } } },
  });
  budget.consume(binding === null ? 0 : 1);
  if (binding === null)
    return {
      kind: "protected" as const,
      reason: "legacy_claim_requester_unmapped",
    };
  const digest = await requesterDigest(
    tx,
    stored,
    record.requesterSourceId,
    budget,
  );
  if (!bindingUnchanged(binding, stored, digest))
    return {
      kind: "protected" as const,
      reason: "legacy_claim_binding_identity_changed",
    };
  const latest = await tx.legacyRequesterBinding.findFirstOrThrow({
    where: {
      sourceKind: binding.sourceKind,
      sourceInstanceId: binding.sourceInstanceId,
      requesterSourceId: binding.requesterSourceId,
    },
    orderBy: { revision: "desc" },
  });
  budget.consume(1);
  return {
    kind: "claim" as const,
    claim: RecoveryClaimProjectionSchema.parse({
      captureId: stored.captureId,
      captureHash: stored.capture.manifestHash,
      sourceKind: stored.capture.sourceKind,
      sourceInstanceId: stored.capture.sourceInstanceId,
      provenanceKey: stored.provenanceKey,
      recordDigest: stored.observationHash,
      requesterSourceId: record.requesterSourceId,
      bindingId: binding.id,
      bindingRevision: binding.revision,
      latestBindingRevision: latest.revision,
      userId: binding.userId,
      mediaIds: [media.id],
      outsideMediaIds: [],
      sourceScope: "movie",
      seasons: [],
    }),
  };
}

function bindingUnchanged(binding: Binding, stored: Stored, digest: string) {
  return (
    binding.captureHash === stored.capture.manifestHash &&
    binding.requesterEvidenceHash === digest &&
    binding.user.plexIdentity !== null &&
    hash(durableBindingIdentity(bindingIdentity(binding.user))) ===
      hash(durableBindingIdentity(binding.identitySnapshot))
  );
}

async function requesterDigest(
  tx: Prisma.TransactionClient,
  stored: Stored,
  requesterId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const records = await tx.migrationRecord.findMany({
    where: {
      captureId: stored.captureId,
      kind: "request",
      payload: { path: ["requesterSourceId"], equals: requesterId },
    },
    orderBy: { provenanceKey: "asc" },
    take: budget.take,
  });
  budget.consume(records.length);
  if (records.length === 0)
    throw new Error(
      "Movie household requester disappeared from its actual capture",
    );
  for (const row of records) {
    const record = MigrationRecordSchema.parse(row.payload);
    if (
      record.kind !== "request" ||
      record.requesterSourceId !== requesterId ||
      hash(record) !== row.observationHash
    )
      throw new Error("Movie household requester record digest changed");
  }
  return hash({
    captureHash: stored.capture.manifestHash,
    requesterSourceId: requesterId,
    records: records.map((row) => ({
      provenanceKey: row.provenanceKey,
      recordDigest: row.observationHash,
    })),
  });
}

function hasMissingSourceClaim(
  report: z.infer<typeof BundleReportSchema> | undefined,
  records: Stored[],
  media: Item,
) {
  if (report === undefined) return false;
  return report.entries.some((entry) => {
    const record = entry.sourceRecord;
    if (record.kind !== "request" || !record.active) return false;
    const relevant =
      entry.mediaIds.includes(media.id) ||
      (record.scope === "movie" &&
        record.externalIds.tmdb !== undefined &&
        record.externalIds.tmdb === media.tmdbId);
    return (
      relevant &&
      !records.some(
        (row) =>
          row.capture.manifestHash === entry.captureHash &&
          row.provenanceKey === entry.provenanceKey &&
          row.observationHash === entry.observationHash,
      )
    );
  });
}
