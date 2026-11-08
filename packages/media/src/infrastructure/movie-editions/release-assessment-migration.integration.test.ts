import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { captureMovieAttemptChoice } from "#infrastructure/movie-editions/authority.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";

const h = automationTestHarness({
  migrationCeiling: "20261017002300_plex_association_binding",
});

test("assessment migration preserves literal pre-v4 choices, attempts, source snapshots and committed command replay", async () => {
  const f = await h.fixture();
  const db = h.database();
  const chosen = await chooseTestMovieEdition(db, {
    actor: f.user,
    mediaId: f.media.id,
    access: { serverMachineId: "fixture-server", movieSectionId: "1" },
  });
  const request = await db.mediaRequest.findUniqueOrThrow({
    where: { id: chosen.result.requestId },
  });
  const scope = {
    rootMediaId: f.media.id,
    mediaId: f.media.id,
    edition: "default" as const,
  };
  const birth = await captureMovieAttemptChoice(db, {
    sponsorRequestId: request.id,
    scope,
    access: { serverMachineId: "fixture-server", movieSectionId: "1" },
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
  });
  const attempt = await db.acquisitionAttempt.create({
    data: {
      ...birth,
      releaseId: f.release.id,
      sponsorRequestId: request.id,
      mediaIds: [f.media.id],
      generations: { [f.media.id]: target.generation },
      state: "reserved",
      operationId: f.input.operationId,
    },
  });
  const choice = await db.movieEditionChoice.findUniqueOrThrow({
    where: { id: chosen.result.choiceId },
  });
  const release = await db.releaseCandidate.findUniqueOrThrow({
    where: { id: f.release.id },
  });
  const operations = await db.operation.findMany({
    where: { targetId: f.media.id },
    orderBy: { id: "asc" },
  });
  const acknowledgments = await db.idempotencyRecord.findMany({
    where: { userId: f.user.id },
    orderBy: { key: "asc" },
  });
  h.applyMigration("20261017002400_movie_release_assessment");
  expect(await db.movieReleaseAssessment.count()).toBe(0);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    }),
  ).toEqual(attempt);
  expect(
    await db.movieEditionChoice.findUniqueOrThrow({ where: { id: choice.id } }),
  ).toEqual(choice);
  expect(
    await db.releaseCandidate.findUniqueOrThrow({ where: { id: release.id } }),
  ).toEqual(release);
  expect(
    await db.operation.findMany({
      where: { targetId: f.media.id },
      orderBy: { id: "asc" },
    }),
  ).toEqual(operations);
  expect(
    await chosen.app.requestMovieEdition(
      f.user,
      chosen.key,
      chosen.command,
      () =>
        Promise.reject(new Error("Committed replay must not refresh access")),
    ),
  ).toEqual(chosen.result);
  expect(
    await db.idempotencyRecord.findMany({
      where: { userId: f.user.id },
      orderBy: { key: "asc" },
    }),
  ).toEqual(acknowledgments);
});
