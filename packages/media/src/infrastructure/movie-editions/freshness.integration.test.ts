import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { commandFixture } from "#infrastructure/editions/command-test-support.ts";
import { MovieRequestV3Schema } from "#shared/movie-editions/commands.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
async function capture<T>(promise: Promise<T>) {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (error) {
    return { status: "rejected", error };
  }
}

beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function inputFor(f: Awaited<ReturnType<typeof commandFixture>>) {
  const context = await f.service.getMovieEditionContext(
    f.actor,
    f.media.id,
    f.actor.id,
  );
  const option = context.options.find((item) => item.edition === "default");
  if (option === undefined) throw new Error("Movie default choice missing");
  return MovieRequestV3Schema.parse({
    schemaVersion: 3,
    mediaId: f.media.id,
    subjectUserId: f.actor.id,
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

async function snapshot(mediaId: string) {
  const db = cluster.database;
  return {
    media: await db.mediaItem.findUniqueOrThrow({ where: { id: mediaId } }),
    target: await db.mediaIntent.findMany({ where: { mediaId } }),
    requests: await db.mediaRequest.findMany({ where: { mediaId } }),
    choices: await db.movieEditionChoice.findMany({
      where: { rootMediaId: mediaId },
    }),
    operations: await db.operation.findMany({
      where: { targetId: mediaId },
      include: { outbox: true },
    }),
    events: await db.applicationEvent.findMany({ where: { mediaId } }),
  };
}

test("mapping expiry during the actual final idempotency INSERT rolls back consent while old replay stays exact", async () => {
  const db = cluster.database;
  const f = await commandFixture(db);
  const original = await inputFor(f);
  const originalKey = crypto.randomUUID();
  const committed = await f.service.requestMovieEdition(
    f.actor,
    originalKey,
    original,
  );
  const next = await inputFor(f);
  const before = await snapshot(f.media.id);
  const key = crypto.randomUUID();
  const held = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const blocker = db.$transaction(async (tx) => {
    // Real PostgreSQL relation lock permits the replay SELECT but blocks the
    // final INSERT after all request/choice/operation writes have been awaited.
    await tx.$executeRaw`LOCK TABLE "IdempotencyRecord" IN SHARE MODE`;
    held.resolve(undefined);
    await release.promise;
  });
  await held.promise;
  const outcome = capture(f.service.requestMovieEdition(f.actor, key, next));
  try {
    await expect
      .poll(async () => {
        const rows = await db.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*) AS waiting FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()
          AND wait_event_type='Lock' AND query LIKE '%INSERT INTO%IdempotencyRecord%'
      `;
        return Number(rows[0]?.waiting ?? 0);
      })
      .toBe(1);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_001);
  } finally {
    release.resolve(undefined);
    await blocker;
  }
  try {
    expect(await outcome).toMatchObject({
      status: "rejected",
      error: { code: "movie_edition_choice_changed" },
    });
    expect(await snapshot(f.media.id)).toEqual(before);
    expect(
      await db.idempotencyRecord.findUnique({
        where: { userId_key: { userId: f.actor.id, key } },
      }),
    ).toBeNull();
    const refresh = vi.fn(() =>
      Promise.reject(
        new Error("A committed replay must not refresh mutable authorization"),
      ),
    );
    expect(
      await f.service.requestMovieEdition(
        f.actor,
        originalKey,
        original,
        refresh,
      ),
    ).toEqual(committed);
    expect(refresh).not.toHaveBeenCalled();
    expect(await snapshot(f.media.id)).toEqual(before);
  } finally {
    vi.restoreAllMocks();
  }
});
