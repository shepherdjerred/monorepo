import { FileOperations } from "#filesystem/operations.ts";
import type { PreparedImport } from "#filesystem/operations/staging.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { assertAcquisition } from "#automation/files/guards.ts";
import { assertPlanEdition } from "./acquisition.ts";
import {
  FileGuardError,
  type FilePlanEntry,
  type Transaction,
} from "#automation/files/types.ts";
import { publicationAuthorityGuard } from "#automation/publication-proof/authority.ts";
import {
  assertPublicationActive,
  type PublicationContext,
} from "#automation/publication-proof/invocation.ts";

export async function stageAuthorizedPlan(
  context: PublicationContext,
  input: {
    attemptId: string;
    mediaIds: string[];
    plan: FilePlanEntry[];
    movieAccess: MovieChoiceAccess | undefined;
  },
) {
  const authorize = async (tx: Transaction) => {
    await lockAcquisitionMedia(tx, input.mediaIds);
    if (!(await context.enabled.acquisition()))
      throw new FileGuardError("acquisition_disabled");
    const choice = await assertAcquisition(tx, input.attemptId, {
      serverMachineId: context.serverMachineId,
      movieAccess: input.movieAccess,
    });
    const current = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    await assertPlanEdition(tx, current, input.plan);
    const guards = new Map<"movies" | "tv", () => void>();
    for (const libraryKind of new Set(
      input.plan.map((entry) => entry.libraryKind),
    ))
      guards.set(
        libraryKind,
        await publicationAuthorityGuard(tx, context, {
          libraryKind,
          recoveryEpoch: current.recoveryEpoch,
        }),
      );
    return (libraryKind: "movies" | "tv") => {
      choice?.assertActive();
      const guard = guards.get(libraryKind);
      if (guard === undefined)
        throw new Error("Missing prepared-import authority");
      guard();
    };
  };
  let assertAuthority = await context.db.$transaction(authorize);
  const preparations: {
    entry: FilePlanEntry;
    operations: FileOperations;
    prepared: PreparedImport;
  }[] = [];
  for (const entry of input.plan) {
    const operations = new FileOperations(context.roots[entry.libraryKind], {
      authorize: () =>
        Promise.reject(new Error("Prepared import cannot publish")),
      checkpoint: context.checkpoint,
      beforeEffect: () => {
        assertPublicationActive(context);
        assertAuthority(entry.libraryKind);
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
    preparations.push({ entry, operations, prepared });
    await context.checkpoint("staging-prepared");
  }
  await context.db.$transaction(
    async (tx) => {
      assertAuthority = await authorize(tx);
      for (const { entry, operations, prepared } of preparations) {
        await operations.commitPreparedImport(prepared, {
          authorize: () => {
            assertAuthority(entry.libraryKind);
            return Promise.resolve();
          },
          beforeEffect: () => {
            assertPublicationActive(context);
            assertAuthority(entry.libraryKind);
          },
        });
        assertAuthority(entry.libraryKind);
      }
    },
    { timeout: 30_000 },
  );
}
