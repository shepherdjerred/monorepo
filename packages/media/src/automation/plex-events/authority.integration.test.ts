import { describe, expect, test } from "vitest";
import { observeRequesterWatch } from "#automation/watch.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import {
  watchHarness,
  pausedTransport,
  watchedTransport,
} from "./test-support.ts";

describe("watch authority across external reads", () => {
  const h = watchHarness();
  test.each([
    "epoch",
    "mapping",
    "credential",
    "claim",
    "cohort",
    "binding",
    "ambiguous",
  ])("%s drift fences failure invalidation", async (change) => {
    const f = await h.fixture();
    const db = h.database();
    const paused = pausedTransport(
      async () => new Response(null, { status: 404 }),
    );
    const result = observeRequesterWatch(
      h.context(paused.transport),
      f.media.id,
    );
    await paused.entered;
    try {
      if (change === "epoch")
        await db.mediaRuntimeState.update({
          where: { id: "singleton" },
          data: { recoveryEpoch: 1 },
        });
      if (change === "mapping")
        await db.plexIdentityMapping.update({
          where: { userId: f.user.id },
          data: { permittedSectionIds: [], version: { increment: 1 } },
        });
      if (change === "credential")
        await db.credential.update({
          where: { id: f.token.id },
          data: {
            ciphertext: h.cipher.encrypt(
              JSON.stringify({ serverToken: "rotated" }),
              `plex:${f.user.plexAccountId}`,
            ),
          },
        });
      if (change === "claim")
        await db.mediaRequest.update({
          where: { userId_mediaId_edition: f.key },
          data: { active: false, version: { increment: 1 } },
        });
      if (change === "cohort") await h.requester(f.media.id);
      if (change === "binding")
        await db.mediaItem.update({
          where: { id: f.media.id },
          data: {
            externalIds: { plexRatingKey: f.ratingKey, plexSectionId: "2" },
          },
        });
      if (change === "ambiguous")
        await db.mediaItem.create({
          data: {
            kind: "movie",
            title: "Another entry",
            externalIds: { plexRatingKey: f.ratingKey, plexSectionId: "1" },
          },
        });
    } finally {
      paused.resume();
    }
    expect(await result).toEqual({
      complete: false,
      reason: "requester_watch_unknown",
    });
    expect(
      await db.watchState.findUnique({
        where: { userId_mediaId_edition: f.key },
      }),
    ).toMatchObject({ watched: true, observedAt: new Date(0) });
  });
  test("root exclusion changes the complete effective cohort", async () => {
    const f = await h.fixture();
    const db = h.database();
    const rootMedia = await h.fixture();
    const root = await db.mediaRequest.create({
      data: { userId: f.user.id, mediaId: rootMedia.media.id },
    });
    await db.mediaRequest.update({
      where: { userId_mediaId_edition: f.key },
      data: { direct: false },
    });
    const leaf = await db.mediaRequest.findUniqueOrThrow({
      where: { userId_mediaId_edition: f.key },
    });
    await db.requestCoverage.create({
      data: {
        rootRequestId: root.id,
        requestId: leaf.id,
        mediaId: f.media.id,
        sourceVersion: root.version,
      },
    });
    const paused = pausedTransport(watchedTransport(true));
    const result = observeRequesterWatch(
      h.context(paused.transport),
      f.media.id,
    );
    await paused.entered;
    try {
      await db.mediaRequest.update({
        where: { id: root.id },
        data: { excluded: true, version: { increment: 1 } },
      });
    } finally {
      paused.resume();
    }
    expect(await result).toMatchObject({ complete: false });
    expect(
      await db.watchState.findUnique({
        where: { userId_mediaId_edition: f.key },
      }),
    ).toMatchObject({ observedAt: new Date(0) });
  });
  test("named-only requesters never join the default cohort or lose their watch evidence", async () => {
    const f = await h.fixture();
    const db = h.database();
    const user = await db.mediaUser.create({
      data: { plexAccountId: crypto.randomUUID(), displayName: "Named only" },
    });
    await db.mediaEditionDefinition.create({
      data: {
        rootMediaId: f.media.id,
        key: "extended",
        policy: "named",
        pathLabel: "Extended",
        plexLabel: "Extended",
        displayLabel: "Extended",
      },
    });
    await db.mediaIntent.create({
      data: {
        mediaId: f.media.id,
        edition: "extended",
        editionRootId: f.media.id,
      },
    });
    await db.mediaRequest.create({
      data: { mediaId: f.media.id, edition: "extended", userId: user.id },
    });
    await db.watchState.create({
      data: {
        mediaId: f.media.id,
        edition: "extended",
        userId: user.id,
        watched: true,
        observedAt: new Date(0),
        source: "plex_current",
      },
    });
    expect(
      await observeRequesterWatch(
        h.context(watchedTransport(true)),
        f.media.id,
      ),
    ).toMatchObject({ complete: true });
    expect(
      await db.watchState.findUnique({
        where: {
          userId_mediaId_edition: {
            userId: user.id,
            mediaId: f.media.id,
            edition: "extended",
          },
        },
      }),
    ).toMatchObject({ watched: true, observedAt: new Date(0) });
    expect(
      await db.watchObservationFence.findUnique({
        where: { mediaId_edition: defaultScope(f.media.id) },
      }),
    ).toMatchObject({ issuedRevision: 1n, settledRevision: 1n });
  });
  test("no target or unresolved lineage creates no observation fence", async () => {
    const db = h.database();
    const media = await db.mediaItem.create({
      data: { kind: "movie", title: "Cold" },
    });
    expect(await observeRequesterWatch(h.context(), media.id)).toMatchObject({
      complete: false,
    });
    expect(await db.mediaIntent.count({ where: { mediaId: media.id } })).toBe(
      0,
    );
    await db.mediaIntent.create({ data: { mediaId: media.id } });
    expect(await observeRequesterWatch(h.context(), media.id)).toMatchObject({
      complete: false,
    });
    expect(
      await db.watchObservationFence.count({ where: { mediaId: media.id } }),
    ).toBe(0);
  });
});
