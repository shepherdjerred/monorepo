import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import {
  BoundWatchAuthoritySchema,
  QuarantinePlexRefV2Schema,
} from "#shared/plex-binding/watch.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { evaluateMovieRetentionV4 } from "./evaluate.ts";
import { quarantineMovieFilesV4 } from "./quarantine.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
type Fixture = Awaited<ReturnType<typeof createMovieRetentionFixture>>;

async function quarantined(edition: MovieEditionKey) {
  const f = await createMovieRetentionFixture(edition, bytes);
  closers.push(f.close);
  expect(await f.warning()).toMatchObject({ status: "warning" });
  await f.deliverWarning();
  const result = await f.evaluate();
  expect(result.status).toBe("quarantine");
  if (result.decisionId === null || f.context.now === undefined)
    throw new Error("Actual retention producer omitted physical authority");
  const execution = testPublicationExecution();
  await quarantineMovieFilesV4(
    {
      ...f.source.files.context,
      now: f.context.now,
      publicationExecution: () => execution,
      movieManagement: {
        execution,
        budget: new PublicationAuthorityReadBudget(),
      },
    },
    {
      schemaVersion: 4,
      operationId: f.input.operationId,
      decisionId: result.decisionId,
      scope: f.scope,
    },
  );
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: f.input.operationId },
  });
  const receipt = MovieQuarantinePlexReceiptV2Schema.parse(
    z
      .object({
        movieQuarantinePlexReceiptV2: z.unknown(),
      })
      .parse(operation.result).movieQuarantinePlexReceiptV2,
  );
  return { f, decisionId: result.decisionId, receipt };
}

async function immutableParents(f: Fixture, decisionId: string) {
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: f.input.operationId },
  });
  const receipt = MovieQuarantinePlexReceiptV2Schema.parse(
    z
      .object({
        movieQuarantinePlexReceiptV2: z.unknown(),
      })
      .parse(operation.result).movieQuarantinePlexReceiptV2,
  );
  const decision = await f.db.retentionDecision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  return {
    operation,
    manifest: decision.manifest,
    quarantinedAt: decision.quarantinedAt,
    purgeAfter: decision.purgeAfter,
    projection: await f.db.retentionPlexProjection.findUniqueOrThrow({
      where: { decisionId },
    }),
    association: await f.db.plexAssociationEvidence.findUniqueOrThrow({
      where: { id: receipt.bindings[0].evidenceId },
    }),
    asset: await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
      include: { subtitles: { orderBy: { id: "asc" } } },
    }),
    pointer: await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
  };
}

async function evaluate(f: Fixture, now: () => Date) {
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  const result = await evaluateMovieRetentionV4(
    {
      ...f.context,
      now,
      movieManagement: { execution, budget },
    },
    f.input,
    execution,
  );
  expect(budget.take).toBeLessThan(101);
  expect(() => budget.consume(0)).not.toThrow();
  return result;
}

async function quarantinedWatch(f: Fixture) {
  const row = await f.db.plexWatchProjection.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: f.source.user.id,
        mediaId: f.scope.mediaId,
        edition: f.scope.edition,
      },
    },
  });
  const authority = BoundWatchAuthoritySchema.parse(row.authority);
  if (authority.purpose !== "quarantined")
    throw new Error("Actual requester read retained serving watch authority");
  const quarantine = QuarantinePlexRefV2Schema.parse(authority.quarantine);
  expect(row.authorityHash).toBe(identityHash(authority));
  expect(authority.quarantineHash).toBe(identityHash(quarantine));
  expect(quarantine).toMatchObject({
    schemaVersion: 2,
    scope: f.scope,
    operationId: f.input.operationId,
    group: { assetId: f.asset.id, assetVersion: f.asset.version + 1 },
    nativeReceipts: [],
  });
  return { row, authority, quarantine };
}

test.each(MovieEditionKeySchema.options)(
  "%s uses actual quarantined requester reads for its full real quarantine window and later purge eligibility",
  async (edition) => {
    const { f, decisionId, receipt } = await quarantined(edition);
    const original = await immutableParents(f, decisionId);
    if (original.quarantinedAt === null || original.purgeAfter === null)
      throw new Error("Physical quarantine omitted real policy timestamps");
    expect(await evaluate(f, () => new Date())).toEqual({
      status: "grace",
      decisionId,
      wakeAt: original.purgeAfter.toISOString(),
      reason: null,
    });
    expect(
      original.purgeAfter.getTime() - original.quarantinedAt.getTime(),
    ).toBe(7 * 86_400_000);
    const watched = await quarantinedWatch(f);
    expect(watched.row).toMatchObject({
      purpose: "quarantined",
      watched: true,
    });
    expect(watched.quarantine).toMatchObject({
      decisionId,
      manifestHash: receipt.manifestHash,
      operationResultHash: identityHash(receipt),
    });
    expect(watched.authority.binding).toEqual(receipt.bindings[0]);
    expect(await immutableParents(f, decisionId)).toEqual(original);
    expect(
      await evaluate(f, () => new Date(Date.now() + 8 * 86_400_000)),
    ).toEqual({
      status: "purge",
      decisionId,
      wakeAt: original.purgeAfter.toISOString(),
      reason: null,
    });
    const refreshed = await quarantinedWatch(f);
    expect(refreshed.authority).toEqual(watched.authority);
    expect(refreshed.row.watched).toBe(true);
    expect(await immutableParents(f, decisionId)).toEqual(original);
  },
  60_000,
);

test("an actual quarantined named-cut unwatch queues its scoped restore without a default restore or new acquisition", async () => {
  const { f, decisionId } = await quarantined("directors_cut");
  expect(await evaluate(f, () => new Date())).toMatchObject({
    status: "grace",
  });
  const original = await immutableParents(f, decisionId);
  const watched = await quarantinedWatch(f);
  const attempts = await f.db.acquisitionAttempt.findMany({
    where: { mediaIds: { has: f.scope.mediaId } },
    orderBy: { id: "asc" },
  });
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
    },
  });
  f.source.wire.setWatched(false);
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  expect(
    await observeRequesterWatch(
      {
        ...f.context,
        now: () => new Date(),
        plexBindingExecution: () => execution,
        movieManagement: { execution, budget },
      },
      f.scope.mediaId,
      { edition: f.scope.edition },
    ),
  ).toEqual({ complete: true, reason: null });
  expect(() => budget.consume(0)).not.toThrow();
  const unwatched = await quarantinedWatch(f);
  expect(unwatched.row.watched).toBe(false);
  expect(unwatched.authority).toEqual(watched.authority);
  const commands = await f.db.operation.findMany({
    where: { targetId: f.scope.mediaId, kind: "restore_movie_edition_v4" },
    include: { outbox: true },
  });
  expect(commands).toHaveLength(1);
  const restore = commands[0];
  if (restore === undefined)
    throw new Error("Actual unwatch omitted its restore command");
  expect(
    MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(restore.payload),
    ),
  ).toEqual({
    schemaVersion: 4,
    operationId: restore.id,
    mediaId: f.scope.mediaId,
    scope: f.scope,
    generation: target.generation + 1,
  });
  expect(restore.outbox?.payload).toEqual(restore.payload);
  expect(
    await f.db.operation.count({
      where: {
        targetId: f.scope.mediaId,
        kind: { in: ["restore_media", "restore_native_quarantine"] },
      },
    }),
  ).toBe(0);
  expect(
    await f.db.acquisitionAttempt.findMany({
      where: { mediaIds: { has: f.scope.mediaId } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(attempts);
  expect(f.source.wire.additions()).toBe(1);
  expect(await immutableParents(f, decisionId)).toEqual(original);
}, 60_000);
