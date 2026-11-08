import { z } from "zod";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import { FileGuardError, type FilePlanEntry } from "#automation/files/types.ts";
import {
  fileIdentityEvidence,
  assertFileIdentity,
  IdentityTorrentFileSchema,
} from "#automation/files/acquisition-identity/evidence.ts";
import { DefaultAcquisitionIdentitySchema } from "#shared/acquisition/library-management.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  SERIES_PACK_STAGING_BATCH_SIZE_V1,
  SeriesPackStagingScopeV1Schema,
  type SeriesPackStagingScopeV1,
  type SeriesPackStagingPreparedV1,
} from "#shared/acquisition/series-pack-staging-v1.ts";
import { canonicalJson } from "#migration/profile-import.ts";

export const SeriesPackStagingObservationV1Schema = z.object({
  torrent: z.object({ progress: z.literal(1), save_path: z.string() }),
  files: z.array(IdentityTorrentFileSchema).min(1).max(1000),
});

/** Select every actual video member first; partitioning never narrows complete attempt authority. */
export function seriesPackStagingScopeV1(
  attempt: AcquisitionAttempt,
  observation: unknown,
  operationId: string,
): SeriesPackStagingScopeV1 {
  if (attempt.coordinatorOperationId !== operationId)
    throw new FileGuardError("acquisition_obsolete");
  const identity = DefaultAcquisitionIdentitySchema.parse(
    attempt.identityEvidence,
  );
  if (
    !("seriesPackV1" in identity.source) ||
    identity.canonical.kind !== "series"
  )
    throw new FileGuardError("series_pack_staging_required");
  const observed = SeriesPackStagingObservationV1Schema.parse(observation);
  const candidates = observed.files.filter(
    (file) =>
      /\.(?:mkv|mp4|m4v|avi)$/iu.test(file.name) &&
      !/(?:^|[/._ -])(?:sample|extras|featurettes|trailer)(?:[/._ -]|$)/iu.test(
        file.name,
      ),
  );
  const members = candidates
    .map((file) => {
      const proof = fileIdentityEvidence(identity, file);
      if (file.progress !== 1)
        throw new FileGuardError("file_coverage_unconfirmed");
      return {
        torrentFileIndex: proof.sourceFile.torrentFileIndex,
        relativePath: proof.sourceFile.relativePath,
        sizeBytes: proof.sourceFile.sizeBytes,
        coverage: [...proof.coverage].sort(),
      };
    })
    .sort((a, b) => a.torrentFileIndex - b.torrentFileIndex);
  const covered = members.flatMap((member) => member.coverage);
  if (
    members.length === 0 ||
    members.length > 100 ||
    new Set(members.map((member) => member.torrentFileIndex)).size !==
      members.length ||
    new Set(members.map((member) => member.relativePath)).size !==
      members.length ||
    new Set(covered).size !== covered.length ||
    identityHash([...covered].sort()) !==
      identityHash([...attempt.mediaIds].sort())
  )
    throw new FileGuardError("file_coverage_incomplete");
  return SeriesPackStagingScopeV1Schema.parse({
    schemaVersion: 1,
    attemptId: attempt.id,
    operationId,
    attemptOperationId: attempt.operationId,
    recoveryEpoch: attempt.recoveryEpoch,
    identityHash: identityHash(attempt.identityEvidence),
    identityRaw: canonicalJson(z.json().parse(attempt.identityEvidence)),
    observationHash: identityHash(observation),
    observationRaw: canonicalJson(z.json().parse(observation)),
    generationsHash: identityHash(attempt.generations),
    generationsRaw: canonicalJson(z.json().parse(attempt.generations)),
    coverage: [...attempt.mediaIds].sort(),
    members,
  });
}

export function seriesPackStagingMembersV1(
  scope: SeriesPackStagingScopeV1,
  batchIndex: number,
) {
  const start = batchIndex * SERIES_PACK_STAGING_BATCH_SIZE_V1;
  const members = scope.members.slice(
    start,
    start + SERIES_PACK_STAGING_BATCH_SIZE_V1,
  );
  if (members.length === 0)
    throw new FileGuardError("series_pack_batch_out_of_scope");
  return members;
}

export function assertSeriesPackStagingEntriesV1(
  prepared: SeriesPackStagingPreparedV1,
) {
  if (prepared.scopeHash !== identityHash(prepared.scope))
    throw new Error("Series pack staging complete scope hash changed");
  const members = seriesPackStagingMembersV1(
    prepared.scope,
    prepared.batchIndex,
  );
  if (
    prepared.entries.length !== members.length ||
    new Set(prepared.entries.map((entry) => entry.assetId)).size !==
      prepared.entries.length ||
    new Set(prepared.entries.map((entry) => entry.operationId)).size !==
      prepared.entries.length
  )
    throw new Error(
      "Series pack staging batch changed its exact member partition",
    );
  for (const [index, entry] of prepared.entries.entries()) {
    const member = members[index];
    const source = entry.identityEvidence?.sourceFile;
    if (
      member === undefined ||
      source === undefined ||
      entry.libraryKind !== "tv" ||
      source.torrentFileIndex !== member.torrentFileIndex ||
      source.relativePath !== member.relativePath ||
      source.sizeBytes !== member.sizeBytes ||
      entry.sizeBytes !== member.sizeBytes ||
      identityHash([...entry.mediaIds].sort()) !==
        identityHash(member.coverage) ||
      identityHash(entry.generations) !== prepared.scope.generationsHash
    )
      throw new Error(
        "Series pack staging entry differs from its original member",
      );
  }
}

export function assertSeriesPackStagingPlanV1(
  attempt: AcquisitionAttempt,
  observation: unknown,
  entries: readonly FilePlanEntry[],
) {
  const identity = DefaultAcquisitionIdentitySchema.parse(
    attempt.identityEvidence,
  );
  const observed = SeriesPackStagingObservationV1Schema.parse(observation);
  for (const entry of entries)
    assertFileIdentity(identity, entry, observed.files);
}
