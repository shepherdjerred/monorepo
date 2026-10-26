import { z } from "zod";
import path from "node:path";
import type { Prisma } from "#generated/prisma/client.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { movieAttemptEffectAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/effect-authority.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { assertMovieCutV2 } from "#infrastructure/movie-editions/cut-v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { MovieEditionBirthAuthoritySchema } from "#shared/movie-editions/authority.ts";
import {
  MovieFilePlanV2Schema,
  type MovieFilePlanV2,
} from "#shared/movie-editions/file-plan-v2.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import {
  movieEditionDefinition,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { movieEditionLibraryPath } from "#automation/files/editions/movie-path.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { chooseUpgrade, evaluateRelease } from "#domain/quality.ts";
import {
  fileIdentityEvidence,
  assertFileIdentity,
} from "#automation/files/acquisition-identity/evidence.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { ownedSubtitleSidecars } from "#automation/files/subtitle-lifecycle/ownership.ts";

export const MovieTorrentObservationSchema = z.object({
  torrent: z.object({ progress: z.literal(1), save_path: z.string() }),
  files: z
    .array(
      z.object({
        index: z.int().nonnegative(),
        name: z.string().min(1),
        size: z.int().positive(),
        progress: z.number(),
      }),
    )
    .max(100),
});
export type MovieFileAuthorityV4 = Awaited<
  ReturnType<typeof authorizeMovieFilesV4>
>;

/** Complete current scope before runtime/identity, with the original invocation guard retained by the caller. */
export async function authorizeMovieFilesV4(
  tx: Prisma.TransactionClient,
  context: PublicationContext,
  input: MovieAttemptOperationV4,
  access: MovieChoiceAccess,
) {
  context.execution.assertActive();
  await lockMovieCommand(tx, input.scope);
  await assertNoPublicationCompensationFence(tx, {
    mediaIds: [input.scope.mediaId],
  });
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
    include: { torrent: true },
  });
  if (
    attempt.coordinatorOperationId !== input.operationId ||
    !["downloading", "validating"].includes(attempt.state)
  )
    throw new FileGuardError("movie_acquisition_obsolete");
  if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch)))
    throw new FileGuardError("runtime_protected");
  if (!(await context.enabled.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  const replacement = await tx.subtitleReplacement.findFirst({
    where: {
      reservationActive: true,
      asset: {
        edition: input.scope.edition,
        coverage: {
          some: { mediaId: input.scope.mediaId, edition: input.scope.edition },
        },
      },
    },
  });
  if (replacement !== null)
    throw new FileGuardError("subtitle_replacement_unsettled");
  const authorized = await movieAttemptEffectAuthorityV4(
    tx,
    attempt,
    input.scope,
    access,
  );
  if (authorized === null)
    throw new FileGuardError("movie_acquisition_obsolete");
  if (
    attempt.torrent?.owned !== true ||
    attempt.torrent.ownershipEpoch !== attempt.recoveryEpoch
  )
    throw new FileGuardError("torrent_unowned");
  const observation = MovieTorrentObservationSchema.parse(
    attempt.torrent.observation,
  );
  authorized.freshness.assertActive();
  context.execution.assertActive();
  return { ...authorized, attempt, observation };
}

export async function moviePredecessorV4(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
  epoch: number,
) {
  const rows = await tx.assetCoverage.findMany({
    where: { mediaId: scope.mediaId, edition: scope.edition, current: true },
    take: 2,
    include: {
      asset: {
        include: {
          coverage: { orderBy: { mediaId: "asc" }, take: 2 },
          subtitles: {
            where: { state: "installed" },
            orderBy: { id: "asc" },
            take: 101,
          },
        },
      },
    },
  });
  if (rows.length === 0) return null;
  const asset = rows[0]?.asset;
  if (
    rows.length !== 1 ||
    asset?.editionRootId !== scope.rootMediaId ||
    asset.edition !== scope.edition ||
    !asset.owned ||
    asset.ownershipEpoch !== epoch ||
    asset.state !== "published" ||
    asset.checksum === null ||
    asset.coverage.length !== 1 ||
    asset.coverage.some(
      (row) =>
        row.mediaId !== scope.mediaId ||
        row.edition !== scope.edition ||
        !row.current,
    )
  )
    throw new FileGuardError("movie_upgrade_coverage_conflict");
  if (asset.subtitles.length > 100)
    throw new FileGuardError("movie_subtitle_scope_limit");
  ownedSubtitleSidecars(asset);
  return asset;
}

export async function assertMovieMeasuredUpgradeV4(
  tx: Prisma.TransactionClient,
  authority: MovieFileAuthorityV4,
  measured: z.infer<typeof PublicReleaseAttributesSchema> & {
    id: string;
    providerId: string;
    title: string;
  },
) {
  const scope = authority.identity.scope;
  if (!evaluateRelease(measured, authority.profile, [scope.mediaId]).accepted)
    throw new FileGuardError("measured_quality_rejected");
  const previous = await moviePredecessorV4(
    tx,
    scope,
    authority.attempt.recoveryEpoch,
  );
  if (previous !== null) {
    const current = PublicReleaseAttributesSchema.extend({
      id: z.string(),
      providerId: z.string(),
      title: z.string(),
    }).parse(previous.properties);
    const decision = chooseUpgrade({
      candidate: measured,
      current,
      profile: authority.profile,
      mediaIds: [scope.mediaId],
    });
    if (!decision.upgrade)
      throw new FileGuardError(`measured_upgrade_rejected:${decision.reason}`);
  }
  return previous;
}

/** Exact member/provenance and predecessor recheck before accepting staging or publishing this literal plan. */
export async function assertMovieFilePlanV4(
  tx: Prisma.TransactionClient,
  context: PublicationContext,
  authority: MovieFileAuthorityV4,
  raw: MovieFilePlanV2,
) {
  const plan = MovieFilePlanV2Schema.parse(raw);
  const entry = plan.entries[0];
  const birth = MovieEditionBirthAuthoritySchema.parse(
    authority.attempt.movieEditionAuthority,
  );
  if (
    plan.attemptId !== authority.attempt.id ||
    identityHash(plan.scope) !== identityHash(authority.identity.scope) ||
    identityHash(plan.birth) !== identityHash(birth)
  )
    throw new FileGuardError("movie_file_plan_scope_changed");
  await assertMoviePlanMemberV4(tx, context, authority, plan);
  const measured = PublicReleaseAttributesSchema.extend({
    id: z.string(),
    providerId: z.string(),
    title: z.string(),
    canonicalPolicyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    profileVersions: z.record(z.string(), z.int().nonnegative()),
  }).parse(entry.properties);
  if (
    measured.profileVersions[plan.scope.mediaId] !==
      authority.profile.version ||
    entry.generations[plan.scope.mediaId] !== authority.target.generation
  )
    throw new FileGuardError("profile_obsolete");
  if (measured.canonicalPolicyHash !== identityHash(authority.policyMetadata))
    throw new FileGuardError("movie_policy_metadata_changed");
  if (
    measured.id !== authority.release.id ||
    measured.providerId !== authority.release.providerId ||
    measured.title !== authority.release.title
  )
    throw new FileGuardError("movie_measured_source_changed");
  const previous = await assertMovieMeasuredUpgradeV4(tx, authority, measured);
  if (
    (previous?.id ?? null) !== entry.previousAssetId ||
    (previous?.version ?? null) !== entry.previousVersion ||
    (previous?.checksum ?? null) !== entry.previousChecksum
  )
    throw new FileGuardError("asset_version_changed");
  await assertMovieLibraryPathV4(tx, context, plan, previous);
  authority.freshness.assertActive();
  context.execution.assertActive();
  return plan;
}

async function assertMovieLibraryPathV4(
  tx: Prisma.TransactionClient,
  context: PublicationContext,
  plan: MovieFilePlanV2,
  previous: Awaited<ReturnType<typeof moviePredecessorV4>>,
) {
  const entry = plan.entries[0];
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: plan.scope.mediaId },
    include: { parent: { include: { parent: true } } },
  });
  const expected =
    previous === null
      ? movieEditionLibraryPath(
          media,
          entry.identityEvidence.sourceFile.relativePath,
          movieEditionDefinition(plan.scope.rootMediaId, plan.scope.edition),
        )
      : path.relative(
          context.roots.movies.library,
          workerFilePath(context, previous.path),
        );
  if (expected !== entry.libraryPath)
    throw new FileGuardError("movie_library_path_changed");
}

async function assertMoviePlanMemberV4(
  tx: Prisma.TransactionClient,
  context: PublicationContext,
  authority: MovieFileAuthorityV4,
  plan: MovieFilePlanV2,
) {
  const entry = plan.entries[0];
  assertFileIdentity(authority.identity, entry, authority.observation.files);
  const member = authority.observation.files.find(
    (file) => file.index === entry.identityEvidence.sourceFile.torrentFileIndex,
  );
  if (member === undefined)
    throw new FileGuardError("torrent_file_identity_changed");
  const evidence = fileIdentityEvidence(authority.identity, member);
  const expectedDownload = path.relative(
    context.roots.movies.downloads,
    path.resolve(
      workerFilePath(context, authority.observation.torrent.save_path),
      member.name,
    ),
  );
  if (entry.downloadPath !== expectedDownload)
    throw new FileGuardError("movie_download_path_changed");
  const cut = await assertMovieCutV2(tx, {
    scope: plan.scope,
    releaseId: authority.attempt.releaseId,
    predecessorAssetIds:
      entry.previousAssetId === null ? [] : [entry.previousAssetId],
    phase: "physical",
    members: [
      {
        attemptId: authority.attempt.id,
        torrentFileIndex: evidence.sourceFile.torrentFileIndex,
        relativePath: evidence.sourceFile.relativePath,
        sizeBytes: evidence.sourceFile.sizeBytes,
      },
    ],
  });
  if (
    identityHash(entry.editionEvidence) !==
    identityHash({ candidate: cut.candidate, member: cut.members[0] })
  )
    throw new FileGuardError("movie_file_cut_evidence_changed");
}
