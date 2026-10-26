import { FileOperations } from "#filesystem/operations.ts";
import { FileGuardError } from "#automation/files/types.ts";
import {
  assertPublicationActive,
  type PublicationContext,
} from "#automation/publication-proof/invocation.ts";
import { publicationAuthorityGuard } from "#automation/publication-proof/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieFilePlanV2 } from "#shared/movie-editions/file-plan-v2.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { authorizeMovieFilesV4, assertMovieFilePlanV4 } from "./authority.ts";

/** Prepare copying/hashing outside PG, then accept only exact operation-owned staging under renewed current authority. */
export async function stageMoviePlanV4(
  context: PublicationContext,
  input: MovieAttemptOperationV4,
  plan: MovieFilePlanV2,
  access: MovieChoiceAccess,
) {
  const rawHash = snapshotHash(nativeJson(plan));
  const authorize = async (tx: Prisma.TransactionClient) => {
    const authority = await authorizeMovieFilesV4(tx, context, input, access);
    if (snapshotHash(nativeJson(authority.attempt.filePlan)) !== rawHash)
      throw new FileGuardError("movie_file_plan_changed");
    await assertMovieFilePlanV4(tx, context, authority, plan);
    const physical = await publicationAuthorityGuard(tx, context, {
      libraryKind: "movies",
      recoveryEpoch: authority.attempt.recoveryEpoch,
    });
    return () => {
      assertPublicationActive(context);
      authority.freshness.assertActive();
      physical();
    };
  };
  let assertAuthority = await context.db.$transaction(authorize);
  const entry = plan.entries[0];
  const operations = new FileOperations(context.roots.movies, {
    authorize: () =>
      Promise.reject(new Error("Prepared movie staging cannot publish")),
    checkpoint: context.checkpoint,
    beforeEffect: () => {
      assertPublicationActive(context);
      assertAuthority();
    },
    ...(context.minimumFreeBytes === undefined
      ? {}
      : { minimumFreeBytes: context.minimumFreeBytes }),
    ...(context.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: context.verifyPlexExclusion }),
  });
  const prepared = await operations.prepareImport({
    operationId: entry.operationId,
    downloadPath: entry.downloadPath,
    libraryPath: entry.libraryPath,
    sha256: entry.checksum,
    ...(entry.previousChecksum === null
      ? {}
      : { previousSha256: entry.previousChecksum }),
  });
  await context.checkpoint("staging-prepared");
  await context.db.$transaction(
    async (tx) => {
      assertAuthority = await authorize(tx);
      await operations.commitPreparedImport(prepared, {
        authorize: () => {
          assertAuthority();
          return Promise.resolve();
        },
        beforeEffect: () => {
          assertPublicationActive(context);
          assertAuthority();
        },
      });
      assertAuthority();
    },
    { timeout: 30_000 },
  );
}
