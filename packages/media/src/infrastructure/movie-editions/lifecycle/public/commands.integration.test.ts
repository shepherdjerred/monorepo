import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { grantTestLease } from "#testing/authority.ts";
import { commandFixture } from "#infrastructure/editions/command-test-support.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import {
  readMovieEditionContextV4,
  readMovieEditionRequestsV4,
} from "#infrastructure/movie-editions/lifecycle/public/public-view.ts";
import { readMovieTargetContextV4 } from "#infrastructure/movie-editions/lifecycle/target-view.ts";
import { ActivateMovieEditionChoiceV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { CancelMovieRequestV4Schema } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const access = { serverMachineId: "command-server", movieSectionId: "1" };
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  const db = cluster.database;
  await grantTestLease(db);
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true },
  });
  const rules = {
    qualities: ["WEB-1080p", "WEB-2160p"],
    rejectedCodecs: [],
    requiredAudioLanguages: ["en"],
    minimumBytes: 1,
    maximumBytes: 10_000_000,
    minimumScore: 0,
    tagScores: {},
    cutoffQuality: "WEB-2160p",
    cutoffScore: 0,
  };
  const profile = await db.qualityProfile.create({
    data: {
      name: "Actual public activation profile",
      rules,
      versions: { create: { version: 0, rules } },
    },
  });
  await db.qualityProfileDefault.create({
    data: { kind: "movie", profileId: profile.id },
  });
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

for (const edition of MovieEditionKeySchema.options) {
  test(`actual ${edition} v3 choice activates once through v4 without changing its consent birth`, async () => {
    const db = cluster.database;
    const f = await commandFixture(db);
    const previous = await chooseTestMovieEdition(db, {
      actor: f.actor,
      mediaId: f.media.id,
      edition,
      access,
    });
    const scope = { rootMediaId: f.media.id, mediaId: f.media.id, edition };
    const request = await db.mediaRequest.findUniqueOrThrow({
      where: { id: previous.result.requestId },
    });
    const choice = await db.movieEditionChoice.findUniqueOrThrow({
      where: { id: previous.result.choiceId },
    });
    const before = await db.$transaction((tx) =>
      readMovieEditionContextV4(tx, f.actor, {
        mediaId: f.media.id,
        subjectUserId: f.actor.id,
        access,
      }),
    );
    expect(before.options.find((row) => row.edition === edition)).toMatchObject(
      { activationRequired: true, acquisition: "eligible" },
    );
    const option = before.options.find((row) => row.edition === edition);
    const input = ActivateMovieEditionChoiceV4Schema.parse({
      schemaVersion: 4,
      scope,
      subjectUserId: f.actor.id,
      requestId: request.id,
      choiceId: choice.id,
      expected: {
        mediaVersion: before.mediaVersion,
        targetVersion: option?.targetVersion,
        requestVersion: request.version,
        choiceRevision: choice.choiceRevision,
      },
    });
    const commands = new MovieLifecycleCommands(db, { keepDays: 7, ...access });
    const key = crypto.randomUUID();
    const result = await commands.activateMovieEditionChoiceV4(
      f.actor,
      key,
      input,
    );
    expect(result).toMatchObject({
      schemaVersion: 4,
      state: "queued",
      reason: null,
      choiceId: choice.id,
    });
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: result.operationId ?? "" },
      include: { outbox: true },
    });
    expect(operation).toMatchObject({
      kind: "reconcile_movie_edition_v4",
      targetId: f.media.id,
      payload: {
        schemaVersion: 4,
        scope,
        requestId: request.id,
        requestVersion: request.version,
      },
      outbox: { kind: "reconcile_movie_edition_v4" },
    });
    expect(
      await db.mediaRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).toEqual(request);
    expect(
      await db.movieEditionChoice.findUniqueOrThrow({
        where: { id: choice.id },
      }),
    ).toEqual(choice);
    expect(
      await previous.app.requestMovieEdition(
        f.actor,
        previous.key,
        previous.command,
      ),
    ).toEqual(previous.result);
    let refreshes = 0;
    expect(
      await new MovieLifecycleCommands(db, {
        keepDays: 7,
        movieAccess: () => {
          refreshes++;
          throw new Error("Historical ACK must precede configuration");
        },
      }).activateMovieEditionChoiceV4(f.actor, key, input),
    ).toEqual(result);
    expect(refreshes).toBe(0);
    const currentTarget = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: scope.mediaId, edition } },
    });
    const operations = await db.operation.count({
      where: { targetId: scope.mediaId },
    });
    await expect(
      commands.activateMovieEditionChoiceV4(f.actor, crypto.randomUUID(), {
        ...input,
        expected: {
          ...input.expected,
          mediaVersion: result.applied.mediaVersion,
          targetVersion: result.applied.targetVersion,
        },
      }),
    ).rejects.toMatchObject({ code: "movie_choice_already_active" });
    expect(
      await db.operation.count({ where: { targetId: scope.mediaId } }),
    ).toBe(operations);
    expect(
      await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: scope.mediaId, edition } },
      }),
    ).toEqual(currentTarget);
    const page = await db.$transaction((tx) =>
      readMovieEditionRequestsV4(tx, f.actor, {
        subjectUserId: f.actor.id,
        cursor: null,
        access,
      }),
    );
    expect(
      page.items.find((row) => row.requestId === request.id),
    ).toMatchObject({ activationRequired: false });
    const cancel = CancelMovieRequestV4Schema.parse({
      schemaVersion: 4,
      scope,
      subjectUserId: f.actor.id,
      requestId: request.id,
      action: "cancel_request",
      expected: {
        targetVersion: result.applied.targetVersion,
        requestVersion: request.version,
        choiceRevision: choice.choiceRevision,
      },
    });
    expect(
      await commands.cancelMovieEditionRequestV4(
        f.actor,
        crypto.randomUUID(),
        cancel,
      ),
    ).toMatchObject({ state: "cancelled", choiceId: null });
    const final = await db.$transaction((tx) =>
      readMovieTargetContextV4(tx, f.actor, { scope, access }),
    );
    expect(final.ownRequests).toEqual([
      expect.objectContaining({
        id: request.id,
        active: false,
        choiceId: null,
      }),
    ]);
    expect(
      await db.movieEditionChoice.findUniqueOrThrow({
        where: { id: choice.id },
      }),
    ).toEqual(choice);
  }, 60_000);
}
