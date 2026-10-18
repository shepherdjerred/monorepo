import { beforeAll, afterAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { commandFixture } from "#infrastructure/editions/command-test-support.ts";
import { chooseTestMovieEdition } from "./test-support.ts";
import {
  captureMovieAttemptChoice,
  assertMovieAttemptChoice,
  readMovieChoice,
} from "./authority.ts";
import { MovieRequestV3Schema } from "#shared/movie-editions/commands.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const access = { serverMachineId: "command-server", movieSectionId: "1" };
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

test("catalog choice GET remains read-only with seven explicit absent definitions", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const before = await counts();
  const first = await f.service.getMovieEditionContext(
    f.actor,
    f.media.id,
    f.actor.id,
  );
  expect(
    await f.service.getMovieEditionContext(f.actor, f.media.id, f.actor.id),
  ).toEqual(first);
  expect(first.options).toHaveLength(7);
  expect(
    first.options.every(
      (option) => option.storedDefinition === null && option.request === null,
    ),
  ).toBe(true);
  expect(await counts()).toEqual(before);
});

test("ordinary Home account captures immutable birth and permits same-choice generation renewal", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  await db.plexIdentityMapping.update({
    where: { userId: f.actor.id },
    data: { homeUserId: crypto.randomUUID() },
  });
  const selected = await chooseTestMovieEdition(db, {
    actor: f.actor,
    mediaId: f.media.id,
    access,
  });
  const attempt = await insertAttempt(
    selected.result.requestId,
    f.media.id,
    selected.result.operationId,
  );
  const birth = JSON.stringify(attempt.movieEditionAuthority);
  await db.mediaRequest.update({
    where: { id: selected.result.requestId },
    data: { version: { increment: 1 } },
  });
  await db.plexIdentityMapping.update({
    where: { userId: f.actor.id },
    data: { version: { increment: 1 }, verifiedAt: new Date() },
  });
  await db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    data: { generation: { increment: 1 } },
  });
  await db.acquisitionAttempt.update({
    where: { id: attempt.id },
    data: { generations: { [f.media.id]: 2 } },
  });
  await db.$transaction((tx) =>
    assertMovieAttemptChoice(tx, {
      attemptId: attempt.id,
      purpose: "new_acquisition_effect",
      access,
    }),
  );
  const renewed = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
  });
  expect(JSON.stringify(renewed.movieEditionAuthority)).toBe(birth);
  await db.plexIdentityMapping.update({
    where: { userId: f.actor.id },
    data: { kind: "managed" },
  });
  await expect(
    db.$transaction((tx) =>
      assertMovieAttemptChoice(tx, {
        attemptId: attempt.id,
        purpose: "new_acquisition_effect",
        access,
      }),
    ),
  ).rejects.toMatchObject({ code: "movie_edition_choice_changed" });
});

test("named pending choice supports protection-only cancellation and exact replay", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const chosen = await chooseTestMovieEdition(db, {
    actor: f.actor,
    mediaId: f.media.id,
    access,
    edition: "directors_cut",
  });
  expect(chosen.result).toMatchObject({
    state: "pending",
    reason: "edition_acquisition_not_ready",
    operationId: null,
  });
  await db.plexIdentityMapping.update({
    where: { userId: f.actor.id },
    data: { permittedSectionIds: [] },
  });
  const list = await f.service.listMovieEditionRequests(f.actor, {
    subjectUserId: f.actor.id,
    cursor: null,
  });
  const row = list.items.find(
    (item) => item.requestId === chosen.result.requestId,
  );
  if (row === undefined) throw new Error("Named request omitted");
  expect(row.access).toBe("protection_only");
  expect(row).not.toHaveProperty("title");
  const input = {
    schemaVersion: 3 as const,
    action: "cancel_request" as const,
    subjectUserId: f.actor.id,
    scope: row.scope,
    requestId: row.requestId,
    expected: {
      targetVersion: row.targetVersion,
      requestVersion: row.requestVersion,
      choiceRevision: row.choiceRevision,
    },
  };
  const key = crypto.randomUUID();
  const result = await f.service.cancelMovieEditionRequest(f.actor, key, input);
  const after = await counts();
  expect(
    await f.service.cancelMovieEditionRequest(f.actor, key, input),
  ).toEqual(result);
  expect(await counts()).toEqual(after);
  expect(
    await db.mediaRequest.findUniqueOrThrow({ where: { id: row.requestId } }),
  ).toMatchObject({
    active: false,
    excluded: true,
    movieEditionChoiceId: null,
    movieEditionChoiceRevision: row.choiceRevision + 1,
  });
});

test("v1 cancellation and revival cannot resurrect a chosen request or old idempotent response", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const context = await f.service.getMovieEditionContext(
    f.actor,
    f.media.id,
    f.actor.id,
  );
  const option = context.options.find((row) => row.edition === "default");
  if (option === undefined) throw new Error("Default option absent");
  const input = MovieRequestV3Schema.parse({
    schemaVersion: 3,
    mediaId: f.media.id,
    subjectUserId: f.actor.id,
    expected: {
      mediaVersion: context.mediaVersion,
      targetVersion: null,
      definition: null,
      request: null,
    },
    selection: {
      edition: "default",
      definitionVersion: 0,
      definitionDigest: option.definitionDigest,
      registryVersion: 1,
    },
    options: { subtitleLanguages: [] },
  });
  const key = crypto.randomUUID();
  const first = await f.service.requestMovieEdition(f.actor, key, input);
  await f.service.cancelRequest(
    f.actor,
    crypto.randomUUID(),
    first.requestId,
    first.applied.requestVersion,
  );
  const revived = await f.service.createRequest(f.actor, crypto.randomUUID(), {
    mediaId: f.media.id,
    subtitleLanguages: [],
    includeSpecials: false,
  });
  expect(revived.requestId).toBe(first.requestId);
  expect(await f.service.requestMovieEdition(f.actor, key, input)).toEqual(
    first,
  );
  expect(
    await db.mediaRequest.findUniqueOrThrow({ where: { id: first.requestId } }),
  ).toMatchObject({
    active: true,
    movieEditionChoiceId: null,
    movieEditionChoiceRevision: 2,
  });
  expect(
    await db.$transaction((tx) =>
      readMovieChoice(tx, { requestId: first.requestId, access }),
    ),
  ).toEqual({ status: "protected", reason: "movie_edition_choice_required" });
  await expect(
    db.mediaRequest.update({
      where: { id: first.requestId },
      data: {
        movieEditionChoiceId: first.choiceId,
        movieEditionChoiceRevision: 1,
      },
    }),
  ).rejects.toThrow();
});

test("SQL denies forgotten cancellation clear, choice mutation and post-birth attachment", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const chosen = await chooseTestMovieEdition(db, {
    actor: f.actor,
    mediaId: f.media.id,
    access,
  });
  const attempt = await insertAttempt(
    chosen.result.requestId,
    f.media.id,
    chosen.result.operationId,
  );
  await expect(
    db.mediaRequest.update({
      where: { id: chosen.result.requestId },
      data: { active: false, version: { increment: 1 } },
    }),
  ).rejects.toThrow();
  await expect(
    db.mediaRequest.update({
      where: { id: chosen.result.requestId },
      data: { direct: false, version: { increment: 1 } },
    }),
  ).rejects.toThrow();
  await expect(
    db.movieEditionChoice.update({
      where: { id: chosen.result.choiceId },
      data: { createdAt: new Date(0) },
    }),
  ).rejects.toThrow();
  await expect(
    db.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { movieEditionChoiceRevision: 999 },
    }),
  ).rejects.toThrow();
  await expect(
    db.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { createdAt: new Date(0) },
    }),
  ).rejects.toThrow();
});

test("restricted self mapping reveals only protective own-request metadata", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const chosen = await chooseTestMovieEdition(db, {
    actor: f.actor,
    mediaId: f.media.id,
    access,
  });
  await db.plexIdentityMapping.update({
    where: { userId: f.actor.id },
    data: { plexRestricted: true },
  });
  await expect(
    f.service.getMovieEditionContext(f.actor, f.media.id, f.actor.id),
  ).rejects.toMatchObject({ code: "plex_library_access_required" });
  const list = await f.service.listMovieEditionRequests(f.actor, {
    subjectUserId: f.actor.id,
    cursor: null,
  });
  expect(list.items).toHaveLength(1);
  expect(list.items[0]).toMatchObject({
    requestId: chosen.result.requestId,
    access: "protection_only",
    canCancel: true,
  });
  expect(list.items[0]).not.toHaveProperty("title");
  expect(list.items[0]).not.toHaveProperty("year");
});

test("managed-only delegation requires a fresh owner and never treats an ordinary account as managed", async () => {
  const db = cluster.database;
  const owner = await commandFixture(db, "owner");
  const subject = await commandFixture(db);
  await expect(
    owner.service.getMovieEditionContext(
      owner.actor,
      owner.media.id,
      subject.actor.id,
    ),
  ).rejects.toMatchObject({ code: "plex_library_access_required" });
  await db.plexIdentityMapping.update({
    where: { userId: subject.actor.id },
    data: {
      kind: "managed",
      homeUserId: crypto.randomUUID(),
      plexRestricted: true,
    },
  });
  const chosen = await chooseTestMovieEdition(db, {
    actor: owner.actor,
    subjectUserId: subject.actor.id,
    mediaId: owner.media.id,
    access,
  });
  const choice = await db.movieEditionChoice.findUniqueOrThrow({
    where: { id: chosen.result.choiceId },
  });
  expect(choice).toMatchObject({
    actorId: owner.actor.id,
    subjectUserId: subject.actor.id,
  });
  await db.mediaUser.update({
    where: { id: owner.actor.id },
    data: { role: "member" },
  });
  expect(
    await db.$transaction((tx) =>
      readMovieChoice(tx, { requestId: chosen.result.requestId, access }),
    ),
  ).toEqual({ status: "protected", reason: "movie_edition_choice_changed" });
});

async function counts() {
  const db = cluster.database;
  return Promise.all([
    db.mediaEditionDefinition.count(),
    db.mediaIntent.count(),
    db.mediaRequest.count(),
    db.movieEditionChoice.count(),
    db.operation.count(),
    db.outboxCommand.count(),
  ]);
}

async function insertAttempt(
  requestId: string,
  mediaId: string,
  operationId: string | null,
) {
  if (operationId === null)
    throw new Error("Default command did not queue reconciliation");
  const db = cluster.database;
  const release = await db.releaseCandidate.create({
    data: {
      providerId: "choice-fixture",
      providerReleaseId: crypto.randomUUID(),
      title: "Fixture 1080p",
      mediaIds: [mediaId],
      attributes: {},
      evaluation: {},
    },
  });
  return db.$transaction(async (tx) => {
    const fields = await captureMovieAttemptChoice(tx, {
      sponsorRequestId: requestId,
      scope: { rootMediaId: mediaId, mediaId, edition: "default" },
      access,
    });
    return tx.acquisitionAttempt.create({
      data: {
        ...fields,
        releaseId: release.id,
        sponsorRequestId: requestId,
        mediaIds: [mediaId],
        operationId,
        state: "reserved",
        generations: {
          [mediaId]: fields.movieEditionAuthority.targetGenerationAtCapture,
        },
      },
    });
  });
}
