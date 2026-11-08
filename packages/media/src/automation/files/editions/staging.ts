import { FileOperations } from "#filesystem/operations.ts";
import type { PreparedImport } from "#filesystem/operations/staging.ts";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import type { FileOperationManifest } from "#filesystem/operations-types.ts";
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

/** The explicit pack protocol settles its real batch in the existing effect transaction. */
export type SeriesPackStagingSettlementV1 = {
  assertCurrent: (
    tx: Transaction,
    attempt: AcquisitionAttempt,
  ) => Promise<void>;
  settle: (
    tx: Transaction,
    staged: readonly {
      entry: FilePlanEntry;
      manifest: FileOperationManifest;
    }[],
  ) => Promise<void>;
};

export async function stageAuthorizedPlan(
  context: PublicationContext,
  input: {
    attemptId: string;
    mediaIds: string[];
    plan: FilePlanEntry[];
    movieAccess: MovieChoiceAccess | undefined;
    seriesPackBatch?: SeriesPackStagingSettlementV1;
  },
) {
  const authorize = async (tx: Transaction) => {
    await lockAcquisitionMedia(tx, input.mediaIds);
    if (!(await context.enabled.acquisition()))
      throw new FileGuardError("acquisition_disabled");
    const choice = await assertAcquisition(tx, input.attemptId, {
      serverMachineId: context.serverMachineId,
      movieAccess: input.movieAccess,
      libraryManagement: context.libraryManagement,
    });
    const current = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    await assertPlanEdition(tx, current, input.plan);
    await input.seriesPackBatch?.assertCurrent(tx, current);
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
      const staged = [];
      for (const { entry, operations, prepared } of preparations) {
        const manifest = await operations.commitPreparedImport(prepared, {
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
        if (input.seriesPackBatch !== undefined)
          staged.push({ entry, manifest });
      }
      await input.seriesPackBatch?.settle(tx, staged);
    },
    { timeout: 30_000 },
  );
}
