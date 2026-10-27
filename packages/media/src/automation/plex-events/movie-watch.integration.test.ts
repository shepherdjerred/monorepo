import { afterEach, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { moviePlexV4Fixture } from "#testing/movie-plex-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { publishMoviePlexV4 } from "#automation/movie-editions/plex-publication.ts";
import { finalizeMovieAcquisitionV4 } from "#automation/movie-editions/finalization.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import type { PlexItem } from "#integrations/plex.ts";
import { BoundWatchAuthoritySchema } from "#shared/plex-binding/watch.ts";
import { readCurrentBoundWatch } from "#infrastructure/plex-binding/watch.ts";

const h = automationTestHarness();
const directories: string[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(edition: MovieEditionKey = "extended_cut") {
  const base = await h.fixture();
  const f = await moviePlexV4Fixture(h.database(), h.context(), base, {
    edition,
    bytes,
  });
  directories.push(f.files.directory);
  expect(
    await publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
  ).toEqual({ status: "available", reason: null });
  await finalizeMovieAcquisitionV4(
    f.network,
    f.input,
    testPlexBindingExecution(),
  );
  await h.database().credential.create({
    data: {
      userId: base.user.id,
      kind: "plex",
      ciphertext: h.cipher.encrypt(
        JSON.stringify({ serverToken: "synthetic-requester" }),
        `plex:${base.user.plexAccountId}`,
      ),
    },
  });
  const wire: {
    item: PlexItem;
    watched: boolean;
    beforeRead: () => Promise<void>;
    calls: string[];
  } = {
    item: structuredClone(f.item),
    watched: true,
    beforeRead: () => Promise.resolve(),
    calls: [],
  };
  const userContext = h.context(async (url, init) => {
    wire.calls.push(url.pathname);
    expect(new Headers(init.headers).get("X-Plex-Token")).toBe(
      "synthetic-requester",
    );
    if (url.pathname === "/identity")
      return Response.json({
        MediaContainer: { machineIdentifier: "fixture-server" },
      });
    if (url.pathname === "/library/sections")
      return Response.json({
        MediaContainer: {
          size: 1,
          Directory: [{ key: "1", type: "movie", title: "Movies" }],
        },
      });
    if (url.pathname !== `/library/metadata/${f.item.ratingKey}`)
      throw new Error("Watch read escaped its actual edition binding");
    const item = {
      ...structuredClone(wire.item),
      viewCount: wire.watched ? 1 : 0,
    };
    await wire.beforeRead();
    return Response.json({ MediaContainer: { size: 1, Metadata: [item] } });
  });
  const context = { ...f.network, userPlex: userContext.userPlex };
  const key = { userId: base.user.id, mediaId: f.media.id, edition };
  const read = () =>
    h
      .database()
      .watchState.findUnique({ where: { userId_mediaId_edition: key } });
  const observe = () => observeRequesterWatch(context, f.media.id, { edition });
  return { ...f, base, context, key, wire, read, observe };
}

test.each(MovieEditionKeySchema.options)(
  "actual %s publication observes requester watch against its exact Plex item and binding",
  async (edition) => {
    const f = await fixture(edition);
    expect(await f.observe()).toEqual({ complete: true, reason: null });
    expect(await f.read()).toMatchObject({
      ...f.key,
      watched: true,
      source: "plex_current",
    });
    expect(
      await h.database().plexWatchProjection.findUniqueOrThrow({
        where: { userId_mediaId_edition: f.key },
      }),
    ).toMatchObject({
      ...f.key,
      watched: true,
      authority: { binding: { scope: { mediaId: f.media.id, edition } } },
    });
    expect(f.wire.calls).toEqual([`/library/metadata/${f.item.ratingKey}`]);
    if (edition !== "default") {
      expect(
        await h.database().watchState.count({
          where: { mediaId: f.media.id, edition: "default" },
        }),
      ).toBe(0);
      expect(await observeRequesterWatch(f.context, f.media.id)).toEqual({
        complete: false,
        reason: "requester_watch_unknown",
      });
    }
  },
);

test("another cut's metadata clears the selected bound watch without crediting another edition", async () => {
  const f = await fixture();
  expect(await f.observe()).toMatchObject({ complete: true });
  f.wire.item.editionTitle = "Theatrical Cut";
  f.wire.watched = false;
  expect(await f.observe()).toMatchObject({ complete: false });
  expect(await f.read()).toBeNull();
  expect(await h.database().plexWatchProjection.count({ where: f.key })).toBe(
    0,
  );
  expect(
    await h.database().watchState.count({
      where: { mediaId: f.media.id, edition: { not: "extended_cut" } },
    }),
  ).toBe(0);
});

test("marking one cut unwatched changes only that cut's intent and retains an exact usable watch proof", async () => {
  const f = await fixture();
  expect(await f.observe()).toMatchObject({ complete: true });
  const db = h.database();
  const defaultBefore = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
  });
  const namedBefore = await db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.media.id, edition: "extended_cut" },
    },
  });
  f.wire.watched = false;
  expect(await f.observe()).toMatchObject({ complete: true });
  expect(await f.read()).toMatchObject({ watched: false });
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toEqual(defaultBefore);
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.media.id, edition: "extended_cut" },
      },
    }),
  ).toMatchObject({
    generation: namedBefore.generation + 1,
    version: namedBefore.version + 1,
  });
  const projection = await db.plexWatchProjection.findUniqueOrThrow({
    where: { userId_mediaId_edition: f.key },
  });
  expect(
    await readCurrentBoundWatch(db, {
      userId: f.key.userId,
      authority: BoundWatchAuthoritySchema.parse(projection.authority),
    }),
  ).toMatchObject({
    status: "known",
    projection: {
      scope: { mediaId: f.media.id, edition: "extended_cut" },
      watched: false,
    },
  });
  expect(
    await db.applicationEvent.findFirstOrThrow({
      where: { mediaId: f.media.id, kind: "media_marked_unwatched" },
    }),
  ).toMatchObject({
    payload: {
      edition: "extended_cut",
      generation: namedBefore.generation + 1,
    },
  });
});

test("a delayed older observation cannot overwrite a newer observation of the same named cut", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  let reads = 0;
  f.wire.beforeRead = async () => {
    if (++reads === 1) {
      entered.resolve(undefined);
      await resume.promise;
    }
  };
  f.wire.watched = false;
  const earlier = f.observe();
  await entered.promise;
  try {
    f.wire.watched = true;
    expect(await f.observe()).toMatchObject({ complete: true });
  } finally {
    resume.resolve(undefined);
  }
  expect(await earlier).toMatchObject({ complete: false });
  expect(await f.read()).toMatchObject({ watched: true });
  const fence = await h.database().watchObservationFence.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.media.id, edition: "extended_cut" },
    },
  });
  expect(fence).toMatchObject({ issuedRevision: 2n, settledRevision: 2n });
});

test("a named movie selector cannot be used for a TV episode", async () => {
  const f = await h.fixture("123", { kind: "episode" });
  await expect(
    observeRequesterWatch(h.context(), f.media.id, { edition: "extended_cut" }),
  ).rejects.toMatchObject({ code: "movie_scope_required" });
});

test("an expired named-cut watch invocation cannot replace its original known observation", async () => {
  const f = await fixture();
  expect(await f.observe()).toMatchObject({ complete: true });
  const baseline = await f.read();
  const execution = testPlexBindingExecution();
  let expired = false;
  f.context.plexBindingExecution = () => ({
    ...execution,
    assertActive: () => {
      execution.assertActive();
      if (expired) throw new Error("Original watch invocation expired");
    },
  });
  f.wire.watched = false;
  f.wire.beforeRead = () => {
    expired = true;
    return Promise.resolve();
  };
  await expect(f.observe()).rejects.toThrow(
    "Original watch invocation expired",
  );
  expect(await f.read()).toEqual(baseline);
});
