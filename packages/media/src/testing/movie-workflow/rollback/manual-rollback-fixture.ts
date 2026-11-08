import { z } from "zod";
import { expect } from "vitest";
import { readFile, lstat } from "node:fs/promises";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { MovieRollbackOperationV1 } from "#shared/movie-editions/rollback/operation.ts";
import {
  MovieRollbackIntentEnvelopeV1Schema,
  MovieRollbackPhysicalEnvelopeV1Schema,
} from "#shared/movie-editions/rollback/physical.ts";
import { MovieRollbackPlexEnvelopeV1Schema } from "#shared/movie-editions/rollback/plex.ts";
import { createMovieRollbackFixture } from "./rollback-fixture.ts";
import { installMovieFixtureCaptions } from "#testing/movie-workflow/upgrade-fixture.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { PrismaMovieRollbackCommandsV1 } from "#infrastructure/movie-editions/rollback/manual/manual-command.ts";
import { createRequestedMovieRollbackFileFacetV1 } from "#automation/files/movie-editions/rollback/manual-facet.ts";
import { createRequestedMovieRollbackNetworkFacetV1 } from "#automation/movie-editions/rollback/manual-facet.ts";
import { prepareRollbackLaterCandidate } from "./rollback-lineage-fixture.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { queueOperation } from "#automation/store.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { Database } from "#infrastructure/database.ts";

/** Actual served A, actual served/completed B with two owned installed captions,
 * then a distinct authenticated owner's real original-deadline CAS command. */
export async function createManualMovieRollbackFixture(
  edition: MovieEditionKey,
  bytes: { original: Uint8Array; upgrade: Uint8Array },
  prepareCommandDatabase?: (db: Database) => Promise<Database>,
) {
  const f = await createMovieRollbackFixture(edition, bytes);
  let stage = "successful B Plex publication";
  try {
    expect(
      await f.movie.publishMovieToPlexV4(f.input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    stage = "finalize actual served B";
    await f.movie.finalizeMovieAcquisitionV4(
      f.input,
      testPlexBindingExecution(),
    );
    const completedSource = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.input.attemptId },
    });
    expect(completedSource.state).toBe("completed");
    const successorId = f.plan.entries[0].assetId;
    stage = "install actual B captions";
    await installMovieFixtureCaptions(f.db, successorId, f.movie, f.fileMovie);
    const owners = await f.db.mediaUser.findMany({
      where: { role: "owner" },
      take: 2,
    });
    const existing = owners[0];
    if (existing === undefined || owners.length !== 1)
      throw new Error(
        "Manual rollback fixture requires its actual unique owner",
      );
    stage = "authenticate distinct actual owner";
    const owner = await authenticateMovieFixtureOwner(f.context, existing);
    expect(owner.id).not.toBe(f.network.actor.id);
    const sections = await f.context.permittedSections();
    const commandDb =
      prepareCommandDatabase === undefined
        ? f.db
        : await prepareCommandDatabase(f.db);
    const service = new PrismaMovieRollbackCommandsV1(commandDb, {
      keepDays: 30,
      serverMachineId: z.string().min(1).parse(f.context.serverMachineId),
      movieSectionId: sections.movie,
    });
    stage = "review exact current B and original cleanup";
    const review = await service.context(owner, f.scope, f.input.attemptId);
    stage = "queue distinct owner rollback command";
    const queued = await service.request(owner, crypto.randomUUID(), {
      schemaVersion: 1,
      scope: f.scope,
      sourceAttemptId: f.input.attemptId,
      expected: review.expected,
      reason:
        "Restore the owner's independently reviewed previous movie and preserve rejected B",
      confirmRestorePredecessor: true,
      confirmRetainRejectedSuccessor: true,
    });
    const input: MovieRollbackOperationV1 = {
      schemaVersion: 1,
      operationId: queued.operationId,
      sourceAttemptId: f.input.attemptId,
      scope: f.scope,
    };
    const cleanup = await f.db.upgradeCleanup.findUniqueOrThrow({
      where: { id: review.expected.cleanup.id },
    });
    stage = "read actual current B session identity";
    const session = await f.context.plex.metadata(f.wire.ratingKey);
    let checkpoint: ((phase: string) => Promise<void>) | null = null;
    const manual = {
      ...createRequestedMovieRollbackFileFacetV1({
        ...f.files,
        checkpoint: async (phase: string) => {
          await f.files.checkpoint(phase);
          await checkpoint?.(phase);
        },
      }),
      ...createRequestedMovieRollbackNetworkFacetV1(f.context),
    };
    const state = async () => {
      const assets = await f.db.libraryAsset.findMany({
        where: { id: { in: [f.asset.id, successorId] } },
        include: { subtitles: { orderBy: { id: "asc" } } },
        orderBy: { id: "asc" },
      });
      const files = [];
      for (const asset of assets) {
        files.push(await auditFile(f.files, asset.id, null, asset.path));
        for (const caption of asset.subtitles.filter(
          (candidate) =>
            candidate.storageKind === "sidecar" &&
            ["installed", "superseded", "quarantined"].includes(
              candidate.state,
            ),
        ))
          files.push(
            await auditFile(
              f.files,
              asset.id,
              caption.id,
              z.string().parse(caption.path),
            ),
          );
      }
      return {
        assets,
        files,
        cleanup: await f.db.upgradeCleanup.findUniqueOrThrow({
          where: { id: cleanup.id },
        }),
        pointer: await f.db.plexBindingCurrent.findUniqueOrThrow({
          where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
        }),
      };
    };
    return {
      ...f,
      input,
      sourceInput: f.input,
      owner,
      review,
      cleanup,
      manual,
      state,
      setCheckpoint: (next: typeof checkpoint) => {
        checkpoint = next;
      },
      setPlayback: (active: boolean) => {
        f.wire.control.sessions.splice(
          0,
          f.wire.control.sessions.length,
          ...(active ? [session] : []),
        );
      },
      laterC: () => prepareRollbackLaterCandidate(f, bytes.upgrade),
      automaticBOnly: async () => {
        const id = await f.db.$transaction(async (tx) => {
          const { target } = await lockMovieCommand(tx, f.scope);
          if (target === null)
            throw new Error(
              "Manual rollback lost its current monitored target",
            );
          return queueOperation(tx, {
            key: `manual-rollback-followup:${input.operationId}`,
            kind: "reconcile_movie_edition_v4",
            targetId: f.scope.mediaId,
            userId: f.network.actor.id,
            payload: {
              schemaVersion: 4,
              mediaId: f.scope.mediaId,
              scope: f.scope,
              generation: target.generation,
              cursor: null,
            },
          });
        });
        const row = await f.db.operation.findUniqueOrThrow({ where: { id } });
        const operation = z
          .object(MovieOperationV4Schema.shape)
          .parse(row.payload);
        return f.movie.reconcileMovieIntentV4(
          operation,
          testPlexBindingExecution(),
        );
      },
      receipts: async () => {
        const row = await f.db.operation.findUniqueOrThrow({
          where: { id: input.operationId },
        });
        if (row.result === null) return {};
        return z
          .object({
            movieRollbackIntentV1:
              MovieRollbackIntentEnvelopeV1Schema.optional(),
            movieRollbackPhysicalV1:
              MovieRollbackPhysicalEnvelopeV1Schema.optional(),
            movieRollbackPlexV1: MovieRollbackPlexEnvelopeV1Schema.optional(),
          })
          .parse(row.result);
      },
    };
  } catch (error) {
    await f.close();
    if (error instanceof z.ZodError)
      throw new Error(
        `Manual fixture stage ${stage}: ${JSON.stringify(error.issues)}`,
        { cause: error },
      );
    throw error;
  }
}

async function auditFile(
  context: Parameters<typeof workerFilePath>[0],
  assetId: string,
  subtitleId: string | null,
  stored: string,
) {
  const filename = workerFilePath(context, stored);
  const info = await lstat(filename, { bigint: true });
  return {
    assetId,
    subtitleId,
    path: stored,
    device: info.dev.toString(),
    inode: info.ino.toString(),
    bytes: await readFile(filename),
  };
}
