import { expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";

test("019 preserves historical watch/intent/operation bytes and creates only bounded ordering rows", async () => {
  const cluster = await startMediaTestPostgres({
    migrationCeiling: "20261017001800_capacity_observation",
  });
  const db = cluster.database;
  try {
    const media = await db.mediaItem.create({
      data: { kind: "movie", title: "Historical" },
    });
    await db.$transaction(async (tx) =>
      lockDefaultScopes(tx, [defaultScope(media.id)], { createMissing: true }),
    );
    const user = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Historical user",
      },
    });
    await db.watchState.create({
      data: {
        ...defaultScope(media.id),
        userId: user.id,
        watched: true,
        observedAt: new Date("2020-01-01"),
        source: "plex_current",
      },
    });
    await db.operation.create({
      data: {
        idempotencyKey: crypto.randomUUID(),
        kind: "retain_media",
        targetId: media.id,
        payload: { historical: "literal" },
      },
    });
    const snapshot = () => db.$queryRaw`SELECT jsonb_build_object(
      'intent', (SELECT to_jsonb(t) FROM "MediaIntent" t WHERE "mediaId" = ${media.id}),
      'watch', (SELECT to_jsonb(w) FROM "WatchState" w WHERE "mediaId" = ${media.id}),
      'operation', (SELECT to_jsonb(o) FROM "Operation" o WHERE "targetId" = ${media.id})
    )::text AS value`;
    const before = await snapshot();
    cluster.applyMigration("20261017001900_watch_observation_fence");
    expect(await snapshot()).toEqual(before);
    expect(await db.watchObservationFence.count()).toBe(0);
    const fence = await db.watchObservationFence.create({
      data: defaultScope(media.id),
    });
    expect(fence).toEqual({
      ...defaultScope(media.id),
      issuedRevision: 0n,
      settledRevision: 0n,
    });
    for (const data of [
      { issuedRevision: -1n },
      { settledRevision: -1n },
      { settledRevision: 1n },
    ])
      await expect(
        db.watchObservationFence.update({
          where: { mediaId_edition: defaultScope(media.id) },
          data,
        }),
      ).rejects.toThrow();
    await db.watchObservationFence.update({
      where: { mediaId_edition: defaultScope(media.id) },
      data: { issuedRevision: 9n, settledRevision: 8n },
    });
    await db.watchState.deleteMany({ where: { mediaId: media.id } });
    expect(
      await db.watchObservationFence.findUnique({
        where: { mediaId_edition: defaultScope(media.id) },
      }),
    ).toMatchObject({ issuedRevision: 9n, settledRevision: 8n });
    await expect(
      db.watchObservationFence.create({
        data: { mediaId: crypto.randomUUID() },
      }),
    ).rejects.toThrow();
  } finally {
    await cluster.close();
  }
});
