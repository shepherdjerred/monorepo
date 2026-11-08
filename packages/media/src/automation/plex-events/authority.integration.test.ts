import { describe, expect, test } from "vitest";
import { observeRequesterWatch } from "#automation/watch.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import {
  watchHarness,
  pausedTransport,
  watchedTransport,
} from "./test-support.ts";

async function inheritedWatchRequest(h: ReturnType<typeof watchHarness>) {
  const f = await h.fixture();
  const db = h.database();
  const rootMedia = await h.fixture();
  const root = await db.mediaRequest.create({
    data: { userId: f.user.id, mediaId: rootMedia.media.id },
  });
  const commands = new PrismaMediaApplication(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
  });
  const direct = await db.mediaRequest.findUniqueOrThrow({
    where: { userId_mediaId_edition: f.key },
  });
  await commands.cancelRequest(
    f.user,
    crypto.randomUUID(),
    direct.id,
    direct.version,
  );
  await db.mediaRequest.update({
    where: { userId_mediaId_edition: f.key },
    data: { active: true, excluded: false },
  });
  const leaf = await db.mediaRequest.findUniqueOrThrow({
    where: { userId_mediaId_edition: f.key },
  });
  expect(leaf).toMatchObject({
    active: true,
    direct: false,
    excluded: false,
    movieEditionChoiceId: null,
  });
  await db.requestCoverage.create({
    data: {
      rootRequestId: root.id,
      requestId: leaf.id,
      mediaId: f.media.id,
      sourceVersion: root.version,
    },
  });
  return { f, db, root, commands };
}

describe("watch authority across external reads", () => {
  const h = watchHarness();
  authorityDriftCases(h);

  test("root exclusion changes the complete effective cohort", async () => {
    const { f, db, root, commands } = await inheritedWatchRequest(h);
    const paused = pausedTransport(watchedTransport(true));
    const result = observeRequesterWatch(
      h.context(paused.transport),
      f.media.id,
    );
    await paused.entered;
    try {
      await commands.cancelRequest(
        f.user,
        crypto.randomUUID(),
        root.id,
        root.version,
      );
    } finally {
      paused.resume();
    }
    expect(await result).toMatchObject({ complete: false });
    expect(
      await db.mediaRequest.findUniqueOrThrow({ where: { id: root.id } }),
    ).toMatchObject({ active: false, excluded: true });
    expect(
      await db.watchState.findUnique({
        where: { userId_mediaId_edition: f.key },
      }),
    ).toBeNull();
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
    ).toMatchObject({
      issuedRevision: f.fence.issuedRevision + 1n,
      settledRevision: f.fence.settledRevision + 1n,
    });
  });
  test.each(["legacy_section", "legacy_duplicate"])(
    "%s display data cannot replace a current immutable association",
    async (change) => {
      const f = await h.fixture();
      if (change === "legacy_section")
        await h.database().mediaItem.update({
          where: { id: f.media.id },
          data: {
            externalIds: { plexRatingKey: f.ratingKey, plexSectionId: "2" },
          },
        });
      else
        await h.database().mediaItem.create({
          data: {
            kind: "movie",
            title: "Unbound legacy duplicate",
            externalIds: { plexRatingKey: f.ratingKey, plexSectionId: "1" },
          },
        });
      expect(
        await observeRequesterWatch(
          h.context(watchedTransport(true)),
          f.media.id,
        ),
      ).toEqual({ complete: true, reason: null });
      expect(
        await h
          .database()
          .watchState.findUnique({ where: { userId_mediaId_edition: f.key } }),
      ).toMatchObject({ watched: true });
    },
  );
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

function authorityDriftCases(h: ReturnType<typeof watchHarness>) {
  test.each(["epoch", "mapping", "credential", "claim", "cohort", "binding"])(
    "%s drift cannot commit a value from an old authority",
    async (change) => {
      const f = await h.fixture();
      const db = h.database();
      const paused = pausedTransport(
        async () => new Response(null, { status: 404 }),
      );
      const result = observeRequesterWatch(
        h.context(paused.transport),
        f.media.id,
      );
      let winner = f.baseline;
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
        if (change === "claim") {
          const request = await db.mediaRequest.findUniqueOrThrow({
            where: { userId_mediaId_edition: f.key },
          });
          await new PrismaMediaApplication(db, {
            keepDays: 30,
            serverMachineId: "fixture-server",
          }).cancelRequest(
            f.user,
            crypto.randomUUID(),
            request.id,
            request.version,
          );
        }
        if (change === "cohort") {
          await h.requester(f.media.id);
          winner = await db.watchState.findUniqueOrThrow({
            where: { userId_mediaId_edition: f.key },
          });
        }
        if (change === "binding") {
          const part = f.item.Media[0]?.Part[0];
          if (part === undefined)
            throw new Error("Actual fixture Part missing");
          part.id++;
          await f.rebind();
        }
      } finally {
        paused.resume();
      }
      expect(await result).toEqual({
        complete: false,
        reason: "requester_watch_unknown",
      });
      const current = await db.watchState.findUnique({
        where: { userId_mediaId_edition: f.key },
      });
      if (change === "epoch" || change === "cohort")
        expect(current).toEqual(winner);
      else expect(current).toBeNull();
    },
  );
}
