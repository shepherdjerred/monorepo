import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import {
  createMovieRollbackFixture,
  movieRollbackEditions,
  movieRollbackVideos,
} from "#testing/movie-workflow/rollback/rollback-fixture.ts";
import { installMovieFixtureCaptions } from "#testing/movie-workflow/upgrade-fixture.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { PrismaMovieRollbackCommandsV1 } from "./manual-command.ts";
import { readRequestedMovieRollbackCommandV1 } from "./manual-command-records.ts";
import { createOutboxActivities } from "#automation/store.ts";

let videos: Awaited<ReturnType<typeof movieRollbackVideos>>;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  videos = await movieRollbackVideos();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test.each(movieRollbackEditions)(
  "a real %s owner rollback request pins current B, exact A and original deadline without borrowing B's requester consent",
  async (edition) => {
    const f = await createMovieRollbackFixture(edition, videos);
    closers.push(f.close);
    expect(
      await f.movie.publishMovieToPlexV4(f.input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await f.movie.finalizeMovieAcquisitionV4(
      f.input,
      testPlexBindingExecution(),
    );
    const successorId = f.plan.entries[0].assetId;
    await installMovieFixtureCaptions(f.db, successorId, f.movie, f.fileMovie);
    const owners = await f.db.mediaUser.findMany({
      where: { role: "owner" },
      take: 2,
    });
    const existing = owners[0];
    if (existing === undefined || owners.length !== 1)
      throw new Error("Actual fixture requires its one existing owner");
    const owner = await authenticateMovieFixtureOwner(f.context, existing);
    expect(owner.id).not.toBe(f.network.actor.id);
    const sections = await f.context.permittedSections();
    const settings = {
      keepDays: 30,
      serverMachineId: z.string().min(1).parse(f.context.serverMachineId),
      movieSectionId: sections.movie,
    };
    const service = new PrismaMovieRollbackCommandsV1(f.db, settings);
    const reviewed = await service.context(owner, f.scope, f.input.attemptId);
    const before = await f.state();
    const immutable = await f.immutable();
    const cleanup = await f.db.upgradeCleanup.findUniqueOrThrow({
      where: {
        assetId_successorAssetId: {
          assetId: f.asset.id,
          successorAssetId: successorId,
        },
      },
    });
    expect(reviewed.expected).toMatchObject({
      predecessor: { id: f.asset.id, version: before.predecessor.version },
      successor: { id: successorId, version: before.successor.version },
      cleanup: {
        id: cleanup.id,
        version: cleanup.version,
        expiresAt: cleanup.expiresAt.toISOString(),
      },
      binding: {
        evidenceId: before.pointer.evidenceId,
        revision: before.pointer.revision,
      },
    });
    const input = {
      schemaVersion: 1 as const,
      scope: f.scope,
      sourceAttemptId: f.input.attemptId,
      expected: reviewed.expected,
      reason: "Restore the owner's reviewed previous serving version",
      confirmRestorePredecessor: true as const,
      confirmRetainRejectedSuccessor: true as const,
    };
    await expect(
      service.request(f.network.actor, crypto.randomUUID(), input),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(
      service.request(owner, crypto.randomUUID(), {
        ...input,
        expected: {
          ...input.expected,
          binding: {
            ...input.expected.binding,
            revision: input.expected.binding.revision + 1,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "movie_rollback_changed" });
    await expect(
      service.request(owner, crypto.randomUUID(), {
        ...input,
        expected: {
          ...input.expected,
          cleanup: {
            ...input.expected.cleanup,
            expiresAt: new Date(cleanup.expiresAt.getTime() + 1).toISOString(),
          },
        },
      }),
    ).rejects.toMatchObject({ code: "movie_rollback_changed" });
    expect(
      await f.db.operation.count({
        where: { kind: "rollback_movie_edition_v1" },
      }),
    ).toBe(0);
    const key = crypto.randomUUID();
    const queued = await service.request(owner, key, input);
    expect(queued).toMatchObject({
      status: "queued",
      scope: f.scope,
      sourceAttemptId: f.input.attemptId,
      expiresAt: cleanup.expiresAt.toISOString(),
    });
    const command = {
      schemaVersion: 1 as const,
      operationId: queued.operationId,
      sourceAttemptId: f.input.attemptId,
      scope: f.scope,
    };
    const read = await readRequestedMovieRollbackCommandV1(
      f.db,
      command,
      new PublicationAuthorityReadBudget(),
    );
    expect(read.operation.userId).toBe(owner.id);
    expect(read.payload.request).toEqual(input);
    expect(read.source).toEqual(f.input);
    const outbox = await f.db.outboxCommand.findUniqueOrThrow({
      where: { operationId: queued.operationId },
    });
    expect(outbox.payload).toEqual(read.operation.payload);
    expect(outbox.dispatchedAt).toBeNull();
    expect(
      await new PrismaMovieRollbackCommandsV1(f.db, {
        keepDays: 30,
        movieAccess: () =>
          Promise.reject(
            new Error(
              "Committed manual command replay precedes changed access",
            ),
          ),
      }).request(owner, key, input),
    ).toEqual(queued);
    expect(
      await f.db.operation.count({
        where: { kind: "rollback_movie_edition_v1" },
      }),
    ).toBe(1);
    expect(
      await f.db.upgradeCleanup.findUniqueOrThrow({
        where: { id: cleanup.id },
      }),
    ).toEqual(cleanup);
    expect(await f.state()).toEqual(before);
    expect(await f.immutable()).toEqual(immutable);
    const starts: Parameters<
      Parameters<typeof createOutboxActivities>[1]
    >[0][] = [];
    const dispatcher = createOutboxActivities(f.db, async (start) => {
      if (start.workflowId !== `media-operation-${queued.operationId}`)
        throw new Error("This scenario dispatches only its reviewed rollback");
      starts.push(start);
    });
    const dispatched = await dispatcher.dispatchMediaOutbox();
    expect(dispatched.dispatched).toBe(1);
    expect(starts).toEqual([
      {
        workflowType: "rollbackMovieEditionV1Workflow",
        workflowId: `media-operation-${queued.operationId}`,
        input: command,
      },
    ]);
    const delivered = await f.db.outboxCommand.findUniqueOrThrow({
      where: { operationId: queued.operationId },
    });
    expect(delivered.dispatchedAt).toBeInstanceOf(Date);
    expect(await f.state()).toEqual(before);
    expect(await f.immutable()).toEqual(immutable);
  },
  60_000,
);
