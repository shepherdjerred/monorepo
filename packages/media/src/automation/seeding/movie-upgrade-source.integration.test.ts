import { afterEach, beforeAll, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createAcquiredMovieUpgradeFixture } from "#testing/movie-workflow/upgrade-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createSeedingActivities } from "#automation/seeding.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

let original: Uint8Array;
let upgrade: Uint8Array;
const close: (() => Promise<void>)[] = [];
beforeAll(async () => {
  original = await movieVideoFixture();
  upgrade = await movieVideoFixture(3840);
});
afterEach(async () => {
  for (const done of close.splice(0)) await done();
});

async function publishedUpgrade() {
  const f = await createAcquiredMovieUpgradeFixture("extended_cut", {
    original,
    upgrade,
  });
  close.push(f.close);
  const db = f.context.db;
  const selected = await f.movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  expect(selected.status).toBe("acquire");
  const input = {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    scope: f.scope,
    attemptId: z.uuid().parse(selected.attemptId),
  };
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "submitted", reason: null });
  expect(
    await f.movie.observeMovieAcquisitionV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "ready", reason: null });
  expect(
    await f.fileMovie.inspectAndStageMovieV4(input, testPublicationExecution()),
  ).toEqual({ status: "staged" });
  const predecessor = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
    include: { subtitles: { orderBy: { id: "asc" } } },
  });
  const exhausted = new PublicationAuthorityReadBudget();
  exhausted.consume(99);
  expect(
    await f.fileMovie.prepareMoviePublicationV4(
      input,
      testPublicationExecution(),
      exhausted,
    ),
  ).toEqual({
    status: "blocked",
    reason: "archive_transition_reconciliation_required",
  });
  expect(
    await db.mediaPublicationTransition.count({
      where: { attemptId: input.attemptId },
    }),
  ).toBe(0);
  expect(
    await f.fileMovie.prepareMoviePublicationV4(
      input,
      testPublicationExecution(),
      new PublicationAuthorityReadBudget(),
    ),
  ).toEqual({ status: "prepared" });
  expect(
    await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
      include: { subtitles: { orderBy: { id: "asc" } } },
    }),
  ).toEqual(predecessor);
  const prepared = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: input.attemptId },
  });
  expect(prepared.outcome).toBeNull();
  expect(
    await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
  ).toEqual({ status: "published" });
  expect(
    await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "available", reason: null });
  await f.movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  const plan = MovieFilePlanSchema.parse(attempt.filePlan);
  const cleanup = await db.upgradeCleanup.findUniqueOrThrow({
    where: {
      assetId_successorAssetId: {
        assetId: f.asset.id,
        successorAssetId: plan.entries[0].assetId,
      },
    },
  });
  const old = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  const successor = await db.libraryAsset.findUniqueOrThrow({
    where: { id: cleanup.successorAssetId },
  });
  return { ...f, db, attempt, cleanup, old, successor };
}

// This full lifecycle also starts and migrates its own PostgreSQL cluster.
// Match the bounded integration budget used by the neighboring cleanup journeys.
test("an actual named upgrade drains its torrent source while the real future rollback cleanup preserves both library videos and captions", async () => {
  const f = await publishedUpgrade();
  expect(f.cleanup.state).toBe("pending");
  expect(f.cleanup.expiresAt.getTime()).toBeGreaterThan(Date.now());
  const rollback = workerFilePath(f.files, f.old.path);
  const library = workerFilePath(f.files, f.successor.path);
  expect(new Uint8Array(await readFile(rollback))).toEqual(original);
  expect(new Uint8Array(await readFile(library))).toEqual(upgrade);
  const captions = await f.db.subtitleAsset.findMany({
    where: { assetId: { in: [f.old.id, f.successor.id] }, path: { not: null } },
  });
  expect(captions.length).toBeGreaterThan(0);
  const before = await Promise.all(
    captions.map(async (caption) => ({
      path: z.string().parse(caption.path),
      bytes: await readFile(
        workerFilePath(f.files, z.string().parse(caption.path)),
      ),
    })),
  );
  const torrentId = z.uuid().parse(f.attempt.torrentId);
  const seed = await f.db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `seed:${torrentId}` },
  });
  f.wire.control.ratio = 1;
  expect(
    await createSeedingActivities(f.context).removeMediaTorrent({
      operationId: seed.id,
      torrentId,
    }),
  ).toEqual({ status: "removed", reason: null });
  expect(f.wire.control.deletes).toBe(1);
  expect(
    await f.db.upgradeCleanup.findUniqueOrThrow({
      where: { id: f.cleanup.id },
    }),
  ).toMatchObject({ state: "pending", expiresAt: f.cleanup.expiresAt });
  expect(new Uint8Array(await readFile(rollback))).toEqual(original);
  expect(new Uint8Array(await readFile(library))).toEqual(upgrade);
  for (const caption of before)
    expect(await readFile(workerFilePath(f.files, caption.path))).toEqual(
      caption.bytes,
    );
}, 60_000);
