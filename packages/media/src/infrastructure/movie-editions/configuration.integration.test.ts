import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { commandFixture } from "#infrastructure/editions/command-test-support.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { MovieRequestV3Schema } from "#shared/movie-editions/commands.ts";
import {
  CancelMovieRequestV3Schema,
  RevokeMovieEditionChoiceV3Schema,
} from "#shared/movie-editions/commands.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

test.each(["cancel_request", "revoke_choice"] as const)(
  "self %s remains available when current movie configuration fails",
  async (action) => {
    const f = await fixture();
    const committed = await f.service.requestMovieEdition(
      f.actor,
      crypto.randomUUID(),
      f.input,
    );
    f.fail(new Error("Current movie configuration unavailable"));
    await cluster.database.plexIdentityMapping.update({
      where: { userId: f.actor.id },
      data: { permittedSectionIds: [], plexRestricted: true },
    });
    const input = {
      schemaVersion: 3,
      action,
      subjectUserId: f.actor.id,
      scope: {
        rootMediaId: f.media.id,
        mediaId: f.media.id,
        edition: "default",
      },
      requestId: committed.requestId,
      expected: {
        targetVersion: committed.applied.targetVersion,
        requestVersion: committed.applied.requestVersion,
        choiceRevision: committed.applied.choiceRevision,
      },
    };
    const result =
      action === "cancel_request"
        ? await f.service.cancelMovieEditionRequest(
            f.actor,
            crypto.randomUUID(),
            CancelMovieRequestV3Schema.parse(input),
          )
        : await f.service.revokeMovieEditionChoice(
            f.actor,
            crypto.randomUUID(),
            RevokeMovieEditionChoiceV3Schema.parse(input),
          );
    expect(result.choiceId).toBeNull();
    expect(
      await cluster.database.mediaRequest.findUniqueOrThrow({
        where: { id: committed.requestId },
      }),
    ).toMatchObject({
      movieEditionChoiceId: null,
      active: action !== "cancel_request",
      movieEditionChoiceRevision: committed.applied.choiceRevision + 1,
    });
  },
);

async function fixture() {
  const db = cluster.database;
  const f = await commandFixture(db);
  let section = "1";
  let failure: Error | undefined;
  const service = new PrismaMediaApplication(db, {
    keepDays: 30,
    serverMachineId: "command-server",
    visibilitySections: { movie: "1", series: "2" },
    movieAccess: () => {
      if (failure !== undefined) return Promise.reject(failure);
      return Promise.resolve({
        serverMachineId: "command-server",
        movieSectionId: section,
      });
    },
  });
  const context = await service.getMovieEditionContext(
    f.actor,
    f.media.id,
    f.actor.id,
  );
  const selected = context.options.find(
    (option) => option.edition === "default",
  );
  if (selected === undefined) throw new Error("Default movie option is absent");
  const input = MovieRequestV3Schema.parse({
    schemaVersion: 3,
    mediaId: f.media.id,
    subjectUserId: f.actor.id,
    expected: {
      mediaVersion: context.mediaVersion,
      targetVersion: selected.targetVersion,
      definition: selected.storedDefinition,
      request: null,
    },
    selection: {
      edition: selected.edition,
      definitionVersion: selected.definitionVersion,
      definitionDigest: selected.definitionDigest,
      registryVersion: context.registryVersion,
    },
    options: { subtitleLanguages: [] },
  });
  return {
    ...f,
    service,
    input,
    setSection: (value: string) => {
      section = value;
    },
    fail: (error: Error) => {
      failure = error;
    },
  };
}

test("changed configured movie section rejects fresh choice and read despite cached startup sections", async () => {
  const db = cluster.database;
  const f = await fixture();
  const before = await db.mediaItem.findUniqueOrThrow({
    where: { id: f.media.id },
  });
  await expect(
    f.service.requestMovieEdition(f.actor, crypto.randomUUID(), f.input, () => {
      f.setSection("3");
      return Promise.resolve();
    }),
  ).rejects.toMatchObject({ code: "plex_library_access_required" });
  await expect(
    f.service.getMovieEditionContext(f.actor, f.media.id, f.actor.id),
  ).rejects.toMatchObject({ code: "plex_library_access_required" });
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: f.media.id } }),
  ).toEqual(before);
  expect(await db.mediaRequest.count({ where: { mediaId: f.media.id } })).toBe(
    0,
  );
  expect(await db.mediaIntent.count({ where: { mediaId: f.media.id } })).toBe(
    0,
  );
  expect(
    await db.movieEditionChoice.count({ where: { rootMediaId: f.media.id } }),
  ).toBe(0);
});

test("exact committed movie choice replay precedes a failing current config factory and refresh", async () => {
  const f = await fixture();
  const key = crypto.randomUUID();
  const committed = await f.service.requestMovieEdition(f.actor, key, f.input);
  const failure = new Error("Current movie configuration unavailable");
  f.fail(failure);
  const refresh = () => Promise.reject(new Error("Replay must not refresh"));
  expect(
    await f.service.requestMovieEdition(f.actor, key, f.input, refresh),
  ).toEqual(committed);
  await expect(
    f.service.getMovieEditionContext(f.actor, f.media.id, f.actor.id),
  ).rejects.toBe(failure);
  await expect(
    f.service.requestMovieEdition(f.actor, crypto.randomUUID(), f.input),
  ).rejects.toBe(failure);
  expect(
    await cluster.database.movieEditionChoice.count({
      where: { rootMediaId: f.media.id },
    }),
  ).toBe(1);
});
