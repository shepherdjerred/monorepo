import { describe, expect, test } from "vitest";
import { observeRequesterWatch } from "#automation/watch.ts";
import { testWatchExecution } from "#testing/watch-execution.ts";
import { prepareWatchBatch } from "./prepare.ts";
import { finalizeWatchBatch } from "./finalize.ts";
import {
  watchHarness,
  pausedTransport,
  watchedTransport,
  barrier,
} from "./test-support.ts";

describe("watch invocation deadline fences", () => {
  const h = watchHarness();
  test("unabortable IO after deadline cannot commit, while a fresh invocation works", async () => {
    const f = await h.fixture();
    const paused = pausedTransport(watchedTransport(true));
    let expired = false;
    const context = h.context(paused.transport);
    const execution = testWatchExecution();
    context.watchExecution = () => ({
      ...execution,
      assertActive: () => {
        if (expired) throw new Error("deadline expired");
      },
    });
    const result = observeRequesterWatch(context, f.media.id);
    const rejected = expect(result).rejects.toThrow("deadline expired");
    await paused.entered;
    expired = true;
    paused.resume();
    await rejected;
    expect(execution.signal.aborted).toBe(false);
    expect(
      await h
        .database()
        .watchState.findUnique({ where: { userId_mediaId_edition: f.key } }),
    ).toMatchObject({ observedAt: new Date(0) });
    expect(
      await observeRequesterWatch(
        h.context(watchedTransport(true)),
        f.media.id,
      ),
    ).toMatchObject({ complete: true });
  });
  test("deadline passing during a PostgreSQL lock wait aborts without changing cache or fence", async () => {
    const f = await h.fixture();
    const context = h.context();
    const execution = testWatchExecution();
    const prepared = await prepareWatchBatch(
      context,
      f.media.id,
      {},
      execution,
    );
    if (prepared === null) throw new Error("Missing batch");
    const locked = barrier();
    const release = barrier();
    let expired = false;
    const holder = h.database().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR UPDATE`;
      locked.release();
      await release.promise;
    });
    await locked.promise;
    const result = finalizeWatchBatch(
      context,
      prepared,
      [
        {
          userId: f.user.id,
          outcome: { kind: "observed", watched: true, scopedAccess: false },
        },
      ],
      {
        ...execution,
        assertActive: () => {
          if (expired) throw new Error("deadline expired");
        },
      },
    );
    const rejected = expect(result).rejects.toThrow("deadline expired");
    try {
      await expect
        .poll(async () => {
          const rows = await h.database().$queryRaw<
            { waiting: bigint }[]
          >`SELECT COUNT(*)::bigint AS waiting FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%MediaRuntimeState%'`;
          return rows[0]?.waiting;
        })
        .toBe(1n);
      expired = true;
    } finally {
      release.release();
    }
    await holder;
    await rejected;
    expect(execution.signal.aborted).toBe(false);
    expect(
      await h
        .database()
        .watchState.findUnique({ where: { userId_mediaId_edition: f.key } }),
    ).toMatchObject({ observedAt: new Date(0) });
    expect(
      await h.database().watchObservationFence.findUnique({
        where: {
          mediaId_edition: { mediaId: f.media.id, edition: "default" },
        },
      }),
    ).toMatchObject({ issuedRevision: 1n, settledRevision: 0n });
  });
});
