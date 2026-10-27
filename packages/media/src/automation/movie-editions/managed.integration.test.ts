import { afterEach, beforeAll, expect, test } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createManagedMovieFixture } from "#testing/movie-workflow/managed-fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { createHash } from "node:crypto";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture();
  upgrade = await movieVideoFixture(3840, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test.each(MovieEditionKeySchema.options)(
  "actual adopted %s policy upgrades without creating personal consent or historical acquisitions",
  async (edition) => {
    const db = h.database();
    const f = await createManagedMovieFixture(
      h,
      edition,
      (directory) => directories.push(directory),
      { original, upgrade },
    );
    const selected = { mediaId: f.scope.mediaId, edition };
    expect(await db.mediaRequest.count({ where: selected })).toBe(0);
    expect(
      await db.acquisitionAttempt.count({
        where: { mediaIds: { has: f.scope.mediaId } },
      }),
    ).toBe(0);
    const reconcile = await f.movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    expect(reconcile, JSON.stringify(reconcile)).toMatchObject({
      status: "acquire",
    });
    if (reconcile.attemptId === null)
      throw new Error(
        "Actual management coordinator omitted its new acquisition",
      );
    const input = {
      schemaVersion: 4 as const,
      operationId: f.input.operationId,
      attemptId: reconcile.attemptId,
      scope: f.scope,
    };
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    expect(attempt).toMatchObject({
      sponsorRequestId: null,
      movieEditionChoiceId: null,
      movieEditionChoiceRevision: null,
      movieEditionAuthority: {
        kind: "library_management",
        receiptId: f.receiptId,
      },
      identityEvidence: { schemaVersion: 3 },
    });
    expect(
      await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "submitted", reason: null });
    expect(
      await f.movie.observeMovieAcquisitionV4(
        input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "ready", reason: null });
    expect(
      await f.fileMovie.inspectAndStageMovieV4(
        input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "staged" });
    expect(
      await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).toEqual({ status: "published" });
    expect(
      await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await f.movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
    expect(await db.mediaRequest.count({ where: selected })).toBe(0);
    expect(
      await db.movieEditionChoice.count({
        where: { rootMediaId: f.scope.mediaId },
      }),
    ).toBe(0);
    expect(
      await db.acquisitionAttempt.count({
        where: { mediaIds: { has: f.scope.mediaId } },
      }),
    ).toBe(1);
    const current = await db.assetCoverage.findFirstOrThrow({
      where: { ...selected, current: true },
      include: { asset: true },
    });
    expect(current.asset.path).toBe(f.target);
    expect(
      createHash("sha256")
        .update(await readFile(f.target))
        .digest("hex"),
    ).toBe(createHash("sha256").update(upgrade).digest("hex"));
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({ state: "superseded", owned: true });
    const completed = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    if (completed.torrentId === null)
      throw new Error("Completed managed acquisition lost its actual transfer");
    expect(
      await db.torrent.findUniqueOrThrow({
        where: { id: completed.torrentId },
      }),
    ).toMatchObject({ owned: true });
    expect(f.wire.additions()).toBe(1);
  },
);
