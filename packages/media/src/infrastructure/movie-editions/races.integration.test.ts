import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { commandFixture } from "#infrastructure/editions/command-test-support.ts";
import {
  MovieRequestV3Schema,
  type CancelMovieRequestResultV3,
  type RevokeMovieEditionChoiceResultV3,
} from "#shared/movie-editions/commands.ts";
import { chooseTestMovieEdition } from "./test-support.ts";
import { lockMovieCommand } from "./locks.ts";
import {
  captureMovieAttemptChoice,
  assertMovieAttemptChoice,
} from "./authority.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const access = { serverMachineId: "command-server", movieSectionId: "1" };
type Fixture = Awaited<ReturnType<typeof commandFixture>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

function protectiveExpected(applied: {
  targetVersion: number;
  requestVersion: number;
  choiceRevision: number;
}) {
  return {
    targetVersion: applied.targetVersion,
    requestVersion: applied.requestVersion,
    choiceRevision: applied.choiceRevision,
  };
}

async function requestInput(f: Fixture, subjectUserId = f.actor.id) {
  const context = await f.service.getMovieEditionContext(
    f.actor,
    f.media.id,
    subjectUserId,
  );
  const option = context.options.find((item) => item.edition === "default");
  if (option === undefined) throw new Error("Default choice option missing");
  return MovieRequestV3Schema.parse({
    schemaVersion: 3,
    mediaId: f.media.id,
    subjectUserId,
    expected: {
      mediaVersion: context.mediaVersion,
      targetVersion: option.targetVersion,
      definition: option.storedDefinition,
      request:
        option.request === null
          ? null
          : {
              id: option.request.id,
              version: option.request.version,
              choiceRevision: option.request.choiceRevision,
            },
    },
    selection: {
      edition: "default",
      definitionVersion: option.definitionVersion,
      definitionDigest: option.definitionDigest,
      registryVersion: context.registryVersion,
    },
    options: { subtitleLanguages: [] },
  });
}

async function capture<T>(promise: Promise<T>) {
  try {
    return { status: "fulfilled" as const, value: await promise };
  } catch (error) {
    return { status: "rejected" as const, error };
  }
}

async function waitForMediaLock() {
  await expect
    .poll(async () => {
      const rows = await cluster.database.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock' AND query LIKE '%FROM "MediaItem"%'
    `;
      return Number(rows[0]?.waiting ?? 0);
    })
    .toBeGreaterThanOrEqual(1);
}

async function mediaState(mediaId: string) {
  const db = cluster.database;
  return {
    media: await db.mediaItem.findUniqueOrThrow({ where: { id: mediaId } }),
    definitions: await db.mediaEditionDefinition.findMany({
      where: { rootMediaId: mediaId },
      orderBy: { key: "asc" },
    }),
    targets: await db.mediaIntent.findMany({
      where: { mediaId },
      orderBy: { edition: "asc" },
    }),
    requests: await db.mediaRequest.findMany({
      where: { mediaId },
      orderBy: { id: "asc" },
    }),
    choices: await db.movieEditionChoice.findMany({
      where: { rootMediaId: mediaId },
      orderBy: { id: "asc" },
    }),
    operations: await db.operation.findMany({
      where: { targetId: mediaId },
      orderBy: { id: "asc" },
      include: { outbox: true },
    }),
  };
}

test("concurrent first choices with the same absence CAS have one winner and no partial target", async () => {
  const f = await commandFixture(cluster.database);
  const input = await requestInput(f);
  const results = await Promise.all([
    capture(f.service.requestMovieEdition(f.actor, crypto.randomUUID(), input)),
    capture(f.service.requestMovieEdition(f.actor, crypto.randomUUID(), input)),
  ]);
  expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(results.find((item) => item.status === "rejected")).toMatchObject({
    error: { code: "version_conflict" },
  });
  const state = await mediaState(f.media.id);
  expect(state.definitions).toHaveLength(1);
  expect(state.targets).toHaveLength(1);
  expect(state.requests).toHaveLength(1);
  expect(state.choices).toHaveLength(1);
  expect(state.operations).toHaveLength(1);
  expect(state.operations[0]?.outbox).toMatchObject({
    operationId: state.operations[0]?.id,
  });
  expect(state.requests[0]).toMatchObject({
    movieEditionChoiceRevision: 1,
    version: 1,
  });
});

test("concurrent exact keys replay one choice; v1 reuse of that key cannot mutate it", async () => {
  const f = await commandFixture(cluster.database);
  const input = await requestInput(f);
  const key = crypto.randomUUID();
  const [first, duplicate] = await Promise.all([
    f.service.requestMovieEdition(f.actor, key, input),
    f.service.requestMovieEdition(f.actor, key, input),
  ]);
  expect(duplicate).toEqual(first);
  const before = await mediaState(f.media.id);
  expect(before.choices).toHaveLength(1);
  expect(before.operations).toHaveLength(1);
  await expect(
    f.service.createRequest(f.actor, key, {
      mediaId: f.media.id,
      subtitleLanguages: [],
      includeSpecials: false,
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  expect(await mediaState(f.media.id)).toEqual(before);
});

test.each(["owner_demotion", "library_revocation"] as const)(
  "fresh %s while canonical lock waits refuses new consent without partial writes",
  async (change) => {
    const db = cluster.database;
    const f = await commandFixture(db, "owner");
    const managed = await commandFixture(db);
    await db.plexIdentityMapping.update({
      where: { userId: managed.actor.id },
      data: {
        kind: "managed",
        homeUserId: crypto.randomUUID(),
        plexRestricted: true,
      },
    });
    const subjectId =
      change === "owner_demotion" ? managed.actor.id : f.actor.id;
    const input = await requestInput(f, subjectId);
    const before = await mediaState(f.media.id);
    const held = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${f.media.id} FOR UPDATE`;
      held.resolve(undefined);
      await release.promise;
    });
    await held.promise;
    const command = capture(
      f.service.requestMovieEdition(f.actor, crypto.randomUUID(), input),
    );
    try {
      await waitForMediaLock();
      if (change === "owner_demotion")
        await db.mediaUser.update({
          where: { id: f.actor.id },
          data: { role: "member", version: { increment: 1 } },
        });
      else
        await db.plexIdentityMapping.update({
          where: { userId: f.actor.id },
          data: { permittedSectionIds: [], version: { increment: 1 } },
        });
    } finally {
      release.resolve(undefined);
      await blocker;
    }
    expect(await command).toMatchObject({
      error: {
        code:
          change === "owner_demotion"
            ? "owner_required"
            : "plex_library_access_required",
      },
    });
    expect(await mediaState(f.media.id)).toEqual(before);
  },
);

test.each(["cancel_request", "revoke_choice"] as const)(
  "attempt birth winning its locks retains immutable proof, but queued %s fences every later effect",
  async (action) => {
    const db = cluster.database;
    const f = await commandFixture(db);
    const chosen = await chooseTestMovieEdition(db, {
      actor: f.actor,
      mediaId: f.media.id,
      access,
    });
    const scope = {
      rootMediaId: f.media.id,
      mediaId: f.media.id,
      edition: "default" as const,
    };
    const releaseRow = await db.releaseCandidate.create({
      data: {
        providerId: "choice-race",
        providerReleaseId: crypto.randomUUID(),
        title: "Race fixture 1080p",
        mediaIds: [f.media.id],
        attributes: {},
        evaluation: {},
      },
    });
    const captured = Promise.withResolvers<undefined>();
    const finish = Promise.withResolvers<undefined>();
    const birth = db.$transaction(async (tx) => {
      await lockMovieCommand(tx, scope);
      const fields = await captureMovieAttemptChoice(tx, {
        sponsorRequestId: chosen.result.requestId,
        scope,
        access,
      });
      captured.resolve(undefined);
      await finish.promise;
      return tx.acquisitionAttempt.create({
        data: {
          ...fields,
          releaseId: releaseRow.id,
          sponsorRequestId: chosen.result.requestId,
          mediaIds: [f.media.id],
          operationId: crypto.randomUUID(),
          state: "reserved",
          generations: {
            [f.media.id]:
              fields.movieEditionAuthority.targetGenerationAtCapture,
          },
        },
      });
    });
    await captured.promise;
    const common = {
      schemaVersion: 3 as const,
      subjectUserId: f.actor.id,
      scope,
      requestId: chosen.result.requestId,
      expected: protectiveExpected(chosen.result.applied),
    };
    const cancelled = capture<
      CancelMovieRequestResultV3 | RevokeMovieEditionChoiceResultV3
    >(
      action === "cancel_request"
        ? f.service.cancelMovieEditionRequest(f.actor, crypto.randomUUID(), {
            ...common,
            action,
          })
        : f.service.revokeMovieEditionChoice(f.actor, crypto.randomUUID(), {
            ...common,
            action,
          }),
    );
    try {
      await waitForMediaLock();
    } finally {
      finish.resolve(undefined);
    }
    const attempt = await birth;
    expect(await cancelled).toMatchObject({
      status: "fulfilled",
      value: {
        state: action === "cancel_request" ? "cancelled" : "pending_choice",
      },
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
    expect(
      await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      }),
    ).toEqual(attempt);
  },
);

test("cancellation winning canonical locks prevents a delayed birth from capturing historical consent", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const chosen = await chooseTestMovieEdition(db, {
    actor: f.actor,
    mediaId: f.media.id,
    access,
  });
  const scope = {
    rootMediaId: f.media.id,
    mediaId: f.media.id,
    edition: "default" as const,
  };
  const held = Promise.withResolvers<undefined>();
  const proceed = Promise.withResolvers<undefined>();
  const delayed = db.$transaction(async (tx) => {
    // Actor/profile work has begun, but this transaction has not acquired the
    // canonical authority set. Cancellation is allowed to win that boundary.
    held.resolve(undefined);
    await proceed.promise;
    await lockMovieCommand(tx, scope);
    return captureMovieAttemptChoice(tx, {
      sponsorRequestId: chosen.result.requestId,
      scope,
      access,
    });
  });
  const outcome = capture(delayed);
  await held.promise;
  try {
    await f.service.cancelMovieEditionRequest(f.actor, crypto.randomUUID(), {
      schemaVersion: 3,
      action: "cancel_request",
      subjectUserId: f.actor.id,
      scope,
      requestId: chosen.result.requestId,
      expected: protectiveExpected(chosen.result.applied),
    });
  } finally {
    proceed.resolve(undefined);
  }
  expect(await outcome).toMatchObject({
    error: { code: "movie_edition_choice_changed" },
  });
  expect(
    await db.acquisitionAttempt.count({
      where: { sponsorRequestId: chosen.result.requestId },
    }),
  ).toBe(0);
  expect(
    await db.movieEditionChoice.count({
      where: { requestId: chosen.result.requestId },
    }),
  ).toBe(1);
});
