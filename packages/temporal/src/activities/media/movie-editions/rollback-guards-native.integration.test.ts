import { expect, test } from "vitest";
import type { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { createMovieFileWorkerActivitiesV4 } from "#activities/media/movie-editions.ts";
import { rollbackGuardScenario } from "./rollback-guards.test-support.ts";

import { useMovieRollbackVideos } from "#activities/media/testing/rollback-fixtures.ts";

const rollbackInputs = useMovieRollbackVideos();

test("automatic rollback requires its genuine negative event before admission", async () => {
  const f = await rollbackGuardScenario(rollbackInputs.videos());
  rollbackInputs.closeAfterTest(f.close);
  const before = await f.state();
  expect(
    await f
      .sdk("missing-negative")
      .run(f.files.prepareMovieRollbackV4, f.input),
  ).toEqual({
    status: "blocked",
    reason: "movie_rollback_actual_plex_rejection_missing",
  });
  expect(await f.state()).toEqual(before);
}, 60_000);

test("a real later successful B Plex receipt defeats the earlier genuine rejection", async () => {
  const f = await rollbackGuardScenario(rollbackInputs.videos());
  rollbackInputs.closeAfterTest(f.close);
  await f.reject();
  expect(
    await f
      .sdk("actual-successful-b")
      .run(f.network.publishMovieToPlexV4, f.input),
  ).toEqual({ status: "available", reason: null });
  const before = await f.state();
  expect(
    await f.sdk("refuse-served-b").run(f.files.prepareMovieRollbackV4, f.input),
  ).toEqual({
    status: "blocked",
    reason: "movie_rollback_successful_plex_requires_manual_command",
  });
  expect(await f.state()).toEqual(before);
}, 60_000);

test.each(["generation", "pair"] as const)(
  "actual %s drift blocks automatic rollback with zero inverse effects",
  async (kind) => {
    const f = await rollbackGuardScenario(rollbackInputs.videos());
    rollbackInputs.closeAfterTest(f.close);
    await f.reject();
    if (kind === "generation")
      await f.db.mediaIntent.update({
        where: {
          mediaId_edition: {
            mediaId: f.scope.mediaId,
            edition: f.scope.edition,
          },
        },
        data: { generation: { increment: 1 } },
      });
    else
      await f.db.libraryAsset.update({
        where: { id: f.asset.id },
        data: { version: { increment: 1 } },
      });
    const before = await f.state();
    const expected =
      kind === "generation"
        ? "movie_rollback_source_obsolete"
        : "movie_rollback_pair_changed";
    expect(
      await f
        .sdk(`refuse-${kind}-drift`)
        .run(f.files.prepareMovieRollbackV4, f.input),
    ).toEqual({ status: "blocked", reason: expected });
    expect(await f.state()).toEqual(before);
  },
  60_000,
);

test("one actual Files invocation with 99 already paid cannot begin inverse effects", async () => {
  const f = await rollbackGuardScenario(rollbackInputs.videos());
  rollbackInputs.closeAfterTest(f.close);
  await f.reject();
  await f.admit();
  const before = await f.state();
  const originals = await f.immutable();
  const actual: PublicationAuthorityReadBudget[] = [];
  const movie = {
    ...f.fileMovie,
    rollbackMoviePublicationV4: (
      ...args: Parameters<typeof f.fileMovie.rollbackMoviePublicationV4>
    ) => {
      actual.push(args[3]);
      args[3].consume(99);
      return f.fileMovie.rollbackMoviePublicationV4(...args);
    },
  };
  const files = createMovieFileWorkerActivitiesV4(() =>
    Promise.resolve({ movie }),
  );
  await expect(
    f
      .sdk("spent-99-native-inverse")
      .run(files.rollbackMoviePublicationV4, f.input),
  ).rejects.toThrow();
  const budget = actual[0];
  if (budget === undefined || actual.length !== 1)
    throw new Error("The actual Files capability was not captured once");
  expect(() => budget.consume(0)).toThrow("100 total queried records");
  expect(await f.state()).toEqual(before);
  expect(await f.immutable()).toEqual(originals);
}, 60_000);

test("pending SQL fence protects OLD caption and coverage identity when moved to an unrelated asset", async () => {
  const f = await rollbackGuardScenario(rollbackInputs.videos());
  rollbackInputs.closeAfterTest(f.close);
  await f.reject();
  await f.admit();
  // An explicitly foreign unowned row supplies no physical or serving authority.
  const foreign = await f.db.libraryAsset.create({
    data: {
      path: `/foreign/not-owned-${crypto.randomUUID()}`,
      sizeBytes: 1n,
      properties: {},
      state: "discovered",
      owned: false,
      edition: f.scope.edition,
      editionRootId: f.scope.rootMediaId,
    },
  });
  const before = await f.state();
  const caption = before.predecessor.subtitles[0];
  if (caption === undefined)
    throw new Error("Actual predecessor caption missing");
  await expect(
    f.db.subtitleAsset.update({
      where: { id: caption.id },
      data: { assetId: foreign.id },
    }),
  ).rejects.toThrow(
    "Pending movie rollback owns its exact physical participants",
  );
  await expect(
    f.db.assetCoverage.update({
      where: {
        assetId_mediaId: { assetId: f.asset.id, mediaId: f.scope.mediaId },
      },
      data: { assetId: foreign.id },
    }),
  ).rejects.toThrow(
    "Pending movie rollback owns its exact physical participants",
  );
  const source = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.input.attemptId },
  });
  await expect(
    f.db.acquisitionAttempt.update({
      where: { id: source.id },
      data: { updatedAt: new Date(source.updatedAt.getTime() + 1) },
    }),
  ).rejects.toThrow(
    "Movie rollback preserves its literal original B acquisition and clocks",
  );
  expect(await f.state()).toEqual(before);
}, 60_000);
