import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { createRestoredMovieUpgradeFixture } from "#testing/movie-workflow/restored-upgrade-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { MovieAttemptOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import {
  MoviePublicationIntentV2Schema,
  MoviePublicationOutcomeV2Schema,
} from "#shared/movie-editions/publication-v2.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { observeMediaUpgradeCleanup } from "#automation/plex-binding/cleanup.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { installMovieFixtureCaptions } from "#testing/movie-workflow/upgrade-fixture.ts";
import { CAPACITY_ROOTS } from "#shared/capacity/contract.ts";

const closers: (() => Promise<void>)[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture();
  upgrade = await movieVideoFixture(3840);
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
type Fixture = Awaited<ReturnType<typeof createRestoredMovieUpgradeFixture>>;

async function originalHistory(f: Fixture) {
  return {
    commands: await f.db.operation.findMany({
      where: {
        id: {
          in: [
            f.publicationOperationId,
            f.retentionInput.operationId,
            f.restoreInput.operationId,
          ],
        },
      },
      orderBy: { id: "asc" },
    }),
    transitions: await f.db.mediaPublicationTransition.findMany({
      where: { attempt: { operationId: f.publicationOperationId } },
      orderBy: { id: "asc" },
    }),
  };
}

async function journal(f: Fixture, operationId: string) {
  const filename = path.join(
    f.source.files.roots.movies.control,
    `journal/${operationId}.json`,
  );
  const contents = await readFile(filename, "utf8");
  return ManifestSchema.parse(JSON.parse(contents));
}

async function snapshotJournals(f: Fixture) {
  const directory = path.join(f.source.files.roots.movies.control, "journal");
  const names = await readdir(directory);
  names.sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      bytes: await readFile(path.join(directory, name)),
    })),
  );
}

async function acquireUpgrade(f: Fixture) {
  const reserved = await f.movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  expect(reserved.status).toBe("acquire");
  const input = MovieAttemptOperationV4Schema.parse({
    schemaVersion: 4,
    operationId: f.input.operationId,
    scope: f.scope,
    attemptId: z.uuid().parse(reserved.attemptId),
  });
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "submitted", reason: null });
  expect(
    await f.movie.observeMovieAcquisitionV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "ready", reason: null });
  expect(
    await f.fileMovie.inspectAndStageMovieV4(input, testPublicationExecution()),
  ).toEqual({ status: "staged" });
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  const plan = MovieFilePlanSchema.parse(attempt.filePlan);
  expect(
    await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
  ).toEqual({ status: "published" });
  expect(
    await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "available", reason: null });
  await f.movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
  await installMovieFixtureCaptions(
    f.db,
    plan.entries[0].assetId,
    f.movie,
    f.fileMovie,
  );
  return { input, plan };
}

async function assertUpgradeJournals(
  f: Fixture,
  plan: ReturnType<typeof MovieFilePlanSchema.parse>,
) {
  const entry = plan.entries[0];
  expect(entry.previousSidecars).toHaveLength(2);
  expect(await journal(f, entry.operationId)).toMatchObject({
    kind: "import",
    phase: "complete",
    previousSha256: f.restored.checksum,
    sha256: entry.checksum,
  });
  const rollback = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.restored.id },
    include: { subtitles: { orderBy: { id: "asc" } } },
  });
  expect(rollback).toMatchObject({
    state: "superseded",
    version: f.restored.version + 1,
    path: `${CAPACITY_ROOTS.movies}/.media-control/rollback/${entry.operationId}`,
    plexPublishedAt: f.restored.plexPublishedAt,
  });
  expect(
    await readFile(workerFilePath(f.source.files.context, rollback.path)),
  ).toEqual(Buffer.from(original));
  for (const sidecar of entry.previousSidecars) {
    const previous = f.restored.subtitles.find(
      (row) => row.id === sidecar.subtitleId,
    );
    if (previous?.path === null || previous?.path === undefined)
      throw new Error("Real restored caption is missing its installed path");
    const quarantined = rollback.subtitles.find(
      (row) => row.id === sidecar.subtitleId,
    );
    expect(quarantined).toMatchObject({
      state: "superseded",
      videoVersion: rollback.version,
      checksum: sidecar.checksum,
      path: `${CAPACITY_ROOTS.movies}/.media-control/quarantine/${sidecar.quarantineId}`,
    });
    const recorded = await journal(f, sidecar.operationId);
    expect(recorded).toMatchObject({
      kind: "quarantine",
      phase: "complete",
      sha256: sidecar.checksum,
      source: workerFilePath(f.source.files.context, previous.path),
      target: path.join(
        f.source.files.roots.movies.control,
        `quarantine/${sidecar.quarantineId}`,
      ),
    });
    expect(quarantined?.path).toBeDefined();
    if (quarantined?.path === null || quarantined?.path === undefined)
      throw new Error("Real rollback caption is missing its quarantined path");
    const captured = f.restoredCaptions.find(
      (row) => row.id === sidecar.subtitleId,
    );
    if (captured === undefined)
      throw new Error(
        "Real restored caption bytes were not captured before upgrade",
      );
    expect(
      await readFile(workerFilePath(f.source.files.context, quarantined.path)),
    ).toEqual(captured.bytes);
  }
  return rollback;
}

test.each(MovieEditionKeySchema.options)(
  "%s upgrades an actual restored serving file through its exact restore grant, then cleans only that rollback copy",
  async (edition) => {
    const f = await createRestoredMovieUpgradeFixture(edition, {
      original,
      upgrade,
    });
    closers.push(f.close);
    const history = await originalHistory(f);
    const originalJournals = await snapshotJournals(f);
    expect(f.restored.version).toBe(f.asset.version + 2);
    expect(f.restored.plexPublishedAt).toEqual(f.asset.plexPublishedAt);
    const { input, plan } = await acquireUpgrade(f);
    const transition = await f.db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: input.attemptId },
    });
    const intent = MoviePublicationIntentV2Schema.parse(transition.intent);
    const outcome = MoviePublicationOutcomeV2Schema.parse(transition.outcome);
    expect(intent.entries[0].originalGrant).toEqual(
      f.restoration.receipt.publication,
    );
    expect(intent.entries[0].originalGrant).toMatchObject({
      kind: "movie_restore_publication_v1",
      operationId: f.restoreInput.operationId,
      assetId: f.restored.id,
      assetVersion: f.restored.version,
    });
    expect(intent.entries[0].predecessor).toMatchObject({
      id: f.restored.id,
      version: f.restored.version,
      plexPublishedAt: f.restored.plexPublishedAt?.toISOString(),
    });
    expect(transition.intentHash).toBe(identityHash(intent));
    expect(transition.outcomeHash).toBe(identityHash(outcome));
    const rollback = await assertUpgradeJournals(f, plan);
    const successor = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: plan.entries[0].assetId },
      include: { subtitles: { orderBy: { id: "asc" } } },
    });
    expect(successor).toMatchObject({
      state: "published",
      edition,
      version: 0,
    });
    const installed = successor.subtitles.filter(
      (row) => row.state === "installed" && row.storageKind === "sidecar",
    );
    expect(installed).toHaveLength(2);
    const successorCaptions = await Promise.all(
      installed.map(async (row) => {
        if (row.path === null)
          throw new Error("Real C caption is missing its installed path");
        return {
          path: row.path,
          bytes: await readFile(
            workerFilePath(f.source.files.context, row.path),
          ),
        };
      }),
    );
    if (successor.plexPublishedAt === null)
      throw new Error("Real C publication has no verified serving timestamp");
    const cleanup = await f.db.upgradeCleanup.findUniqueOrThrow({
      where: {
        assetId_successorAssetId: {
          assetId: f.restored.id,
          successorAssetId: successor.id,
        },
      },
    });
    expect(cleanup.expiresAt.getTime()).toBe(
      successor.plexPublishedAt.getTime() + 7 * 86_400_000,
    );
    expect(rollback.rollbackExpiresAt).toEqual(cleanup.expiresAt);
    const operation = await f.db.operation.findUniqueOrThrow({
      where: { idempotencyKey: `upgrade-cleanup:${cleanup.id}` },
    });
    const cleanupInput = { operationId: operation.id, cleanupId: cleanup.id };
    const policyNow = () => new Date(cleanup.expiresAt.getTime() + 1);
    expect(
      await observeMediaUpgradeCleanup(
        { ...f.context, now: policyNow },
        cleanupInput,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "observed" });
    const cleanupExecution = testPublicationExecution();
    expect(
      await createMediaFileActivities({
        ...f.source.files.context,
        now: policyNow,
        publicationExecution: () => cleanupExecution,
      }).cleanupSupersededMediaFile(cleanupInput),
    ).toEqual({ status: "purged" });
    await expect(
      access(workerFilePath(f.source.files.context, rollback.path)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    for (const row of rollback.subtitles) {
      if (row.path === null)
        throw new Error("Real B rollback caption has no quarantined path");
      await expect(
        access(workerFilePath(f.source.files.context, row.path)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(
      await readFile(workerFilePath(f.source.files.context, successor.path)),
    ).toEqual(Buffer.from(upgrade));
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({
        where: { id: successor.id },
        include: { subtitles: { orderBy: { id: "asc" } } },
      }),
    ).toEqual(successor);
    for (const row of successorCaptions)
      expect(
        await readFile(workerFilePath(f.source.files.context, row.path)),
      ).toEqual(row.bytes);
    expect(await originalHistory(f)).toEqual(history);
    for (const prior of originalJournals)
      expect(
        await readFile(
          path.join(f.source.files.roots.movies.control, "journal", prior.name),
        ),
      ).toEqual(prior.bytes);
    expect(f.wire.additions()).toBe(1);
    expect(f.source.wire.additions()).toBe(1);
  },
  60_000,
);
