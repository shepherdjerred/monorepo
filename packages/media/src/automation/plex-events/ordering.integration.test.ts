import { expect, test } from "vitest";
import {
  observeRequesterWatch,
  queueRetentionCheck,
} from "#automation/watch.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { prepareWatchBatch } from "./prepare.ts";
import { finalizeWatchBatch } from "./finalize.ts";
import {
  watchHarness,
  watchedTransport,
  pausedTransport,
  barrier,
} from "./test-support.ts";

const h = watchHarness();
function events(mediaId: string) {
  return h.database().applicationEvent.findMany({
    where: { mediaId },
    orderBy: { id: "asc" },
  });
}
function eventDelta(
  before: Awaited<ReturnType<typeof events>>,
  after: Awaited<ReturnType<typeof events>>,
) {
  const ids = new Set(before.map((event) => event.id));
  expect(after.filter((event) => ids.has(event.id))).toEqual(before);
  return after.filter((event) => !ids.has(event.id));
}
test("an unexpected internal second-user client failure commits none of the batch", async () => {
  const f = await h.fixture();
  await h.requester(f.media.id);
  const baseline = await events(f.media.id);
  expect(baseline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "movie_edition_chosen",
        actorId: f.user.id,
      }),
    ]),
  );
  const watches = await h.database().watchState.findMany({
    where: defaultScope(f.media.id),
    orderBy: { userId: "asc" },
  });
  let calls = 0;
  const context = h.context(watchedTransport(false));
  const client = context.userPlex;
  context.userPlex = (token) => {
    calls++;
    if (calls === 2)
      throw new Error("Synthetic internal client contract failure");
    return client(token);
  };
  await expect(observeRequesterWatch(context, f.media.id)).rejects.toThrow(
    "Synthetic internal client contract failure",
  );
  const rows = await h.database().watchState.findMany({
    where: defaultScope(f.media.id),
    orderBy: { userId: "asc" },
  });
  expect(calls).toBe(2);
  expect(rows).toHaveLength(2);
  expect(rows).toEqual(watches);
  expect(await events(f.media.id)).toEqual(baseline);
});
test("malformed external metadata clears only that requester's bound value to unknown", async () => {
  const f = await h.fixture();
  const second = await h.requester(f.media.id);
  const context = h.context(async (url, init) => {
    const token = new Headers(init.headers).get("X-Plex-Token");
    return token === second.id
      ? Response.json({
          MediaContainer: { size: 1, Metadata: [{ invalid: true }] },
        })
      : watchedTransport(true)(url, init);
  });
  expect(await observeRequesterWatch(context, f.media.id)).toEqual({
    complete: false,
    reason: "requester_watch_unknown",
  });
  expect(
    await h
      .database()
      .watchState.findUnique({ where: { userId_mediaId_edition: f.key } }),
  ).toMatchObject({ watched: true });
  expect(
    await h.database().watchState.findUnique({
      where: { userId_mediaId_edition: { ...f.key, userId: second.id } },
    }),
  ).toBeNull();
  expect(
    await h.database().plexWatchProjection.count({
      where: { ...defaultScope(f.media.id), userId: second.id },
    }),
  ).toBe(0);
});
test("retention queue waits for canonical authority and uses the committed generation", async () => {
  const f = await h.fixture();
  const locked = barrier();
  const release = barrier();
  const writer = h.database().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id=${f.media.id} FOR UPDATE`;
    await tx.mediaIntent.update({
      where: { mediaId_edition: defaultScope(f.media.id) },
      data: { generation: 2 },
    });
    locked.release();
    await release.promise;
  });
  await locked.promise;
  const queued = queueRetentionCheck(h.context(), f.media.id, "locked-fixture");
  try {
    await expect
      .poll(async () => {
        const rows = await h.database().$queryRaw<
          { waiting: bigint }[]
        >`SELECT COUNT(*)::bigint AS waiting FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%MediaItem%'`;
        return rows[0]?.waiting;
      })
      .toBe(1n);
  } finally {
    release.release();
  }
  await writer;
  await queued;
  expect(
    await h.database().operation.findFirst({
      where: { targetId: f.media.id, kind: "retain_media" },
    }),
  ).toMatchObject({ payload: { generation: 2 } });
});
test.each(["success", "failure"])(
  "older %s cannot overwrite a newer whole-media observation",
  async (kind) => {
    const f = await h.fixture();
    const paused = pausedTransport(
      kind === "success"
        ? watchedTransport(true)
        : async () => new Response(null, { status: 404 }),
    );
    const old = observeRequesterWatch(h.context(paused.transport), f.media.id);
    await paused.entered;
    try {
      expect(
        await observeRequesterWatch(
          h.context(watchedTransport(false)),
          f.media.id,
        ),
      ).toEqual({ complete: true, reason: null });
    } finally {
      paused.resume();
    }
    expect(await old).toEqual({
      complete: false,
      reason: "requester_watch_unknown",
    });
    expect(
      await h
        .database()
        .watchState.findUnique({ where: { userId_mediaId_edition: f.key } }),
    ).toMatchObject({ watched: false });
    expect(
      await h.database().mediaIntent.findUnique({
        where: { mediaId_edition: defaultScope(f.media.id) },
      }),
    ).toMatchObject({ generation: 2 });
    expect(
      await h.database().applicationEvent.count({
        where: { mediaId: f.media.id, kind: "media_marked_unwatched" },
      }),
    ).toBe(1);
  },
);
test("newer issuance alone fences an older completion, and replay cannot apply twice", async () => {
  const f = await h.fixture();
  const baseline = await events(f.media.id);
  expect(baseline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "movie_edition_chosen",
        actorId: f.user.id,
      }),
    ]),
  );
  const ctx = h.context();
  const execution = testPlexBindingExecution();
  const first = await prepareWatchBatch(ctx, f.media.id, {}, execution);
  const second = await prepareWatchBatch(ctx, f.media.id, {}, execution);
  if (first === null || second === null)
    throw new Error("Fixture authority missing");
  const outcomes = [
    {
      userId: f.user.id,
      outcome: {
        kind: "observed",
        watched: false,
        scopedAccess: false,
        freshness: second.freshness,
      },
    },
  ] as const;
  expect(await finalizeWatchBatch(ctx, first, outcomes, execution)).toBe(
    "superseded",
  );
  expect(
    await h
      .database()
      .watchState.findUnique({ where: { userId_mediaId_edition: f.key } }),
  ).toEqual(f.baseline);
  expect(await finalizeWatchBatch(ctx, second, outcomes, execution)).toBe(
    "committed",
  );
  const committed = await events(f.media.id);
  expect(eventDelta(baseline, committed)).toMatchObject([
    {
      kind: "media_marked_unwatched",
      actorId: f.user.id,
      payload: { generation: 2 },
    },
  ]);
  expect(await finalizeWatchBatch(ctx, second, outcomes, execution)).toBe(
    "superseded",
  );
  expect(await events(f.media.id)).toEqual(committed);
});
test("two legitimate unwatched outcomes commit atomically despite their own generation advances", async () => {
  const f = await h.fixture();
  const second = await h.requester(f.media.id);
  const baseline = await events(f.media.id);
  expect(baseline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "movie_edition_chosen",
        actorId: f.user.id,
      }),
    ]),
  );
  const before = Date.now();
  expect(
    await observeRequesterWatch(h.context(watchedTransport(false)), f.media.id),
  ).toEqual({ complete: true, reason: null });
  const rows = await h
    .database()
    .watchState.findMany({ where: defaultScope(f.media.id) });
  expect(rows).toHaveLength(2);
  expect(
    rows.every((row) => !row.watched && row.observedAt.getTime() >= before),
  ).toBe(true);
  expect(new Set(rows.map((row) => row.observedAt.getTime())).size).toBe(1);
  expect(
    await h.database().mediaIntent.findUnique({
      where: { mediaId_edition: defaultScope(f.media.id) },
    }),
  ).toMatchObject({ generation: 3 });
  const added = eventDelta(baseline, await events(f.media.id));
  expect(added).toHaveLength(2);
  expect(added.map((event) => event.kind)).toEqual([
    "media_marked_unwatched",
    "media_marked_unwatched",
  ]);
  const actors = added.map((event) => {
    if (event.actorId === null)
      throw new Error("Unwatched event is missing its requester actor");
    return event.actorId;
  });
  expect(actors.sort()).toEqual([f.user.id, second.id].sort());
  expect(added.map((event) => event.payload)).toEqual(
    expect.arrayContaining([{ generation: 2 }, { generation: 3 }]),
  );
});
test.each(["future", "stale"])(
  "%s batch start is rejected without freshening watch evidence",
  async (kind) => {
    const f = await h.fixture();
    const ctx = h.context();
    const execution = testPlexBindingExecution();
    const batch = await prepareWatchBatch(ctx, f.media.id, {}, execution);
    if (batch === null) throw new Error("Missing batch");
    batch.startedAt = new Date(
      Date.now() + (kind === "future" ? 60_000 : -901_000),
    );
    expect(
      await finalizeWatchBatch(
        ctx,
        batch,
        [
          {
            userId: f.user.id,
            outcome: {
              kind: "observed",
              watched: true,
              scopedAccess: false,
              freshness: batch.freshness,
            },
          },
        ],
        execution,
      ),
    ).toBe("superseded");
    expect(
      await h
        .database()
        .watchState.findUnique({ where: { userId_mediaId_edition: f.key } }),
    ).toEqual(f.baseline);
  },
);
test("a successful batch retains its conservative prepare time", async () => {
  const f = await h.fixture();
  const ctx = h.context();
  const execution = testPlexBindingExecution();
  const batch = await prepareWatchBatch(ctx, f.media.id, {}, execution);
  if (batch === null) throw new Error("Missing batch");
  batch.startedAt = new Date(Date.now() - 120_000);
  expect(
    await finalizeWatchBatch(
      ctx,
      batch,
      [
        {
          userId: f.user.id,
          outcome: {
            kind: "observed",
            watched: true,
            scopedAccess: false,
            freshness: batch.freshness,
          },
        },
      ],
      execution,
    ),
  ).toBe("committed");
  expect(
    await h
      .database()
      .watchState.findUnique({ where: { userId_mediaId_edition: f.key } }),
  ).toMatchObject({ observedAt: batch.startedAt });
});
