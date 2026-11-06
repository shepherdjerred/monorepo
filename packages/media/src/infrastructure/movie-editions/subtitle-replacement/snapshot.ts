import { z } from "zod";
import type {
  Prisma,
  SubtitleAsset,
  LibraryAsset,
} from "#generated/prisma/client.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  MovieEditionHashSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { MovieReplacementSnapshotV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import { replacementSubtitleSnapshot } from "#automation/subtitle-replacement/snapshot.ts";
import { snapshotNativeSubtitles } from "#automation/native-subtitles/snapshot.ts";
import { captureMovieReplacementSourceV2 } from "./source-capture.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { NativeSubtitleSnapshotSchema } from "#shared/native-subtitles.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import { replacementCandidateBytes } from "#automation/subtitle-replacement/candidate.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { HeldMovieRollbackCaptionSourceV1 } from "./rollback-source.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));

/** Under exact movie/owner/runtime/asset locks; only real immutable parents may sponsor the swap. */
export async function captureMovieReplacementSnapshotV2(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    assetId: string;
    oldSubtitleId: string;
    candidateSubtitleId: string;
    epoch: number;
  },
  invocation: {
    access: MovieChoiceAccess;
    budget: PublicationAuthorityReadBudget;
    heldRollbackSource?: HeldMovieRollbackCaptionSourceV1;
  },
) {
  const { budget, access } = invocation;
  const work = await currentMovieSubtitleWorkV4(
    tx,
    { scope: input.scope, assetId: input.assetId, epoch: input.epoch, access },
    budget,
  );
  if (
    work.protectedReasons.length > 0 ||
    work.targets.length === 0 ||
    work.target === null
  )
    throw new FileGuardError("subtitle_target_changed");
  const { asset } = work;
  const old = asset.subtitles.find((row) => row.id === input.oldSubtitleId);
  const candidate = asset.subtitles.find(
    (row) => row.id === input.candidateSubtitleId,
  );
  if (old === undefined || candidate === undefined || old.id === candidate.id)
    throw new FileGuardError("subtitle_replacement_participants_missing");
  assertOldMovieCaption(old, asset, input.epoch);
  if (
    candidate.state !== "validated" ||
    candidate.path !== null ||
    candidate.storageKind !== "sidecar" ||
    !work.targets.some((target) =>
      subtitleAccepted({
        subtitle: candidate,
        asset,
        epoch: input.epoch,
        target,
        allowStaged: true,
      }),
    )
  )
    throw new FileGuardError("subtitle_quality_unaccepted");
  const evidence = z
    .object({
      movieScope: z.json(),
      targetAuthority: MovieEditionHashSchema,
      replacementFor: z.object({
        oldSubtitleId: z.literal(old.id),
        expectedOldVersion: z.literal(old.version),
      }),
      movieManualReplacementV2: z.strictObject({
        schemaVersion: z.literal(2),
        eventId: z.uuid(),
      }),
    })
    .parse(candidate.matchingEvidence);
  if (evidence.targetAuthority !== work.authority)
    throw new FileGuardError("subtitle_target_changed");
  if (hash(evidence.movieScope) !== hash(input.scope))
    throw new FileGuardError("movie_subtitle_scope_changed");
  const bytes = replacementCandidateBytes(candidate);
  const destination = subtitleDestination({
    videoPath: asset.path,
    language: candidate.language,
    forced: candidate.forced,
    hearingImpaired: candidate.hearingImpaired,
    format: bytes.format,
  });
  if (destination !== old.path || bytes.checksum === old.checksum)
    throw new FileGuardError(
      "subtitle_replacement_requires_distinct_same_path",
    );
  const event = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: evidence.movieManualReplacementV2.eventId },
  });
  budget.consume(1);
  const candidateSource = z
    .object({
      subtitleId: z.literal(candidate.id),
      oldSubtitleId: z.literal(old.id),
      assetId: z.literal(asset.id),
      checksum: z.literal(bytes.checksum),
      scope: z.json(),
    })
    .parse(event.payload);
  if (
    event.kind !== "movie_subtitle_replacement_candidate_v2" ||
    event.actorId === null ||
    hash(candidateSource.scope) !== hash(input.scope)
  )
    throw new Error("Movie replacement candidate lost its actual owner upload");
  const { publication, source } = await captureMovieReplacementSourceV2(
    tx,
    {
      scope: input.scope,
      asset,
      old: NativeSubtitleSnapshotSchema.parse(replacementSubtitleSnapshot(old)),
    },
    budget,
    invocation.heldRollbackSource,
  );
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (runtime.recoveryEpoch !== input.epoch)
    throw new FileGuardError("runtime_protected");
  const snapshot = MovieReplacementSnapshotV2Schema.parse({
    schemaVersion: 2,
    scope: input.scope,
    recoveryEpoch: input.epoch,
    runtimeVersion: runtime.version,
    asset: {
      id: asset.id,
      version: asset.version,
      path: asset.path,
      checksum: asset.checksum,
      ownershipEpoch: asset.ownershipEpoch,
      coverage: [
        {
          mediaId: input.scope.mediaId,
          title: asset.coverage[0]?.media.title,
          generation: work.target.generation,
        },
      ],
    },
    old: replacementSubtitleSnapshot(old),
    candidate: replacementSubtitleSnapshot(candidate),
    targetAuthority: work.authority,
    destination,
    libraryKind: "movies",
    installed: await snapshotNativeSubtitles(tx, asset.id),
    publication,
    source,
    candidateSource: {
      eventId: event.id,
      actorId: event.actorId,
      payloadHash: hash(event.payload),
    },
  });
  work.freshness.assertActive();
  return { snapshot, freshness: work.freshness };
}

function assertOldMovieCaption(
  old: SubtitleAsset,
  asset: LibraryAsset,
  epoch: number,
) {
  if (
    old.state !== "installed" ||
    old.storageKind !== "sidecar" ||
    old.path === null ||
    old.checksum === null ||
    old.ownershipEpoch !== epoch ||
    old.videoChecksum !== asset.checksum ||
    old.videoVersion !== asset.version
  )
    throw new FileGuardError("subtitle_ownership_unconfirmed");
}
