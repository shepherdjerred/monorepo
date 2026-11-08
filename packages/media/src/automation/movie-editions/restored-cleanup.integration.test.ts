import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, expect, test } from "vitest";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createRestoredMovieCleanupFixture } from "#testing/movie-workflow/restored-cleanup-fixture.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import { observeMediaUpgradeCleanup } from "#automation/plex-binding/cleanup.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { UpgradeCleanupPlexStoredSchema } from "#shared/plex-binding/cleanup.ts";
import { z } from "zod";

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
type Fixture = Awaited<ReturnType<typeof createRestoredMovieCleanupFixture>>;

async function serving(f: Fixture) {
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.successor.id },
    include: { subtitles: { orderBy: { id: "asc" } } },
  });
  const filenames = [
    asset.path,
    ...asset.subtitles
      .filter(
        (row) => row.state === "installed" && row.storageKind === "sidecar",
      )
      .map((row) => {
        if (row.path === null)
          throw new Error("Actual restored sidecar path missing");
        return row.path;
      }),
  ];
  return {
    asset,
    bytes: await Promise.all(
      filenames.map((filename) => readFile(workerFilePath(f.files, filename))),
    ),
  };
}

async function history(f: Fixture) {
  return {
    commands: await f.db.operation.findMany({
      where: {
        id: {
          in: [
            f.publication.id,
            f.retentionInput.operationId,
            f.restoreInput.operationId,
          ],
        },
      },
      orderBy: { id: "asc" },
    }),
    transition: await f.db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: f.transition.id },
    }),
  };
}

test.each(MovieEditionKeySchema.options)(
  "%s purges A using B's actual restored serving authority while retaining the original rollback deadline",
  async (edition) => {
    const f = await createRestoredMovieCleanupFixture(edition, {
      original,
      upgrade,
    });
    closers.push(f.close);
    const current = await serving(f);
    const originalHistory = await history(f);
    const plan = MovieFilePlanSchema.parse(f.attempt.filePlan);
    const journalFiles = [
      plan.entries[0].operationId,
      ...plan.entries[0].previousSidecars.map((row) => row.operationId),
    ].map((id) =>
      path.join(f.files.roots.movies.control, `journal/${id}.json`),
    );
    const journals = await Promise.all(
      journalFiles.map((filename) => readFile(filename)),
    );
    expect(current.asset.version).toBe(f.successor.version + 2);
    expect(current.asset.plexPublishedAt).toEqual(f.successor.plexPublishedAt);
    expect(
      await observeMediaUpgradeCleanup(
        f.context,
        f.cleanupInput,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "observed" });
    const command = await f.db.operation.findUniqueOrThrow({
      where: { id: f.cleanupInput.operationId },
    });
    const stored = UpgradeCleanupPlexStoredSchema.parse(
      z.object({ upgradeCleanupPlex: z.unknown() }).parse(command.result)
        .upgradeCleanupPlex,
    );
    expect(stored.evidenceHash).toBe(identityHash(stored.evidence));
    expect(stored.evidence).toMatchObject({
      schemaVersion: 3,
      expected: {
        schemaVersion: 3,
        scope: f.scope,
        cleanup: { expiresAt: f.cleanup.expiresAt.toISOString() },
        serving: {
          schemaVersion: 3,
          oldGroups: [
            { assetId: f.successor.id, assetVersion: current.asset.version },
          ],
          parents: [
            {
              kind: "movie_restore_publication_v1",
              reference: {
                operationId: f.restoreInput.operationId,
                assetVersion: current.asset.version,
              },
            },
          ],
        },
      },
    });
    expect(await f.physical.cleanupSupersededMediaFile(f.cleanupInput)).toEqual(
      { status: "purged" },
    );
    const cleanup = await f.db.upgradeCleanup.findUniqueOrThrow({
      where: { id: f.cleanup.id },
    });
    expect(cleanup).toMatchObject({
      state: "purged",
      assetId: f.old.id,
      successorAssetId: f.successor.id,
      expiresAt: f.cleanup.expiresAt,
    });
    const old = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.old.id },
      include: { subtitles: true },
    });
    expect(old).toMatchObject({
      state: "purged",
      rollbackExpiresAt: f.old.rollbackExpiresAt,
    });
    for (const filename of [
      f.old.path,
      ...f.old.subtitles.map((row) => {
        if (row.path === null)
          throw new Error("Actual rollback sidecar missing");
        return row.path;
      }),
    ])
      await expect(
        access(workerFilePath(f.files, filename)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await serving(f)).toEqual(current);
    expect(await history(f)).toEqual(originalHistory);
    expect(
      await Promise.all(journalFiles.map((filename) => readFile(filename))),
    ).toEqual(journals);
    expect(current.bytes[0]).toEqual(Buffer.from(upgrade));
  },
  60_000,
);

test("an active session still protects an old rollback file when its successor was restored", async () => {
  const f = await createRestoredMovieCleanupFixture("directors_cut", {
    original,
    upgrade,
  });
  closers.push(f.close);
  const before = await serving(f);
  f.wire.control.sessions = [
    {
      ratingKey: "synthetic-active",
      type: "movie",
      title: "Synthetic active playback",
      Media: [{ Part: [{ id: 999_999, file: f.old.path }] }],
    },
  ];
  expect(
    await observeMediaUpgradeCleanup(
      f.context,
      f.cleanupInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "protected", reason: "reconciliation_required" });
  expect(
    await f.physical.cleanupSupersededMediaFile(f.cleanupInput),
  ).toMatchObject({ status: "protected" });
  await access(workerFilePath(f.files, f.old.path));
  expect(await serving(f)).toEqual(before);
}, 60_000);
