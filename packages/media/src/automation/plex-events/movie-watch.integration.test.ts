import { afterEach, beforeAll, describe, expect, test } from "vitest";
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
import { PrismaPlexEventIngress } from "#infrastructure/plex-events/ingress.ts";
import { ObserveMoviePlexHintV4Schema } from "#shared/plex-events/contract.ts";
import { createMovieWatchFacetV4 } from "./movie-activities.ts";
import { createSweepActivities } from "#automation/sweeps.ts";

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

async function fixture(edition: MovieEditionKey = "extended_cut", source = h) {
  const base = await source.fixture();
  const f = await moviePlexV4Fixture(
    source.database(),
    source.context(),
    base,
    {
      edition,
      bytes,
    },
  );
  directories.push(f.files.directory);
  expect(
    await publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
  ).toEqual({ status: "available", reason: null });
  await finalizeMovieAcquisitionV4(
    f.network,
    f.input,
    testPlexBindingExecution(),
  );
  await source.database().credential.create({
    data: {
      userId: base.user.id,
      kind: "plex",
      ciphertext: source.cipher.encrypt(
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
  const userContext = source.context(async (url, init) => {
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
    source
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

async function queueHint(f: Awaited<ReturnType<typeof fixture>>) {
  await new PrismaPlexEventIngress(h.database(), {
    serverMachineId: "fixture-server",
    permittedSections: () => Promise.resolve({ movie: "1", series: "2" }),
  }).accept({
    schemaVersion: 1,
    event: "media.scrobble",
    serverMachineId: "fixture-server",
    sectionId: "1",
    ratingKey: f.item.ratingKey,
    mediaKind: "movie",
  });
  const operation = await h.database().operation.findFirstOrThrow({
    where: { targetId: f.media.id, kind: "observe_movie_plex_hint_v4" },
  });
  return ObserveMoviePlexHintV4Schema.parse(operation.payload);
}

test.each(
  MovieEditionKeySchema.options.filter((edition) => edition !== "default"),
)(
  "actual %s Plex hints refresh only their claimed cut and distrust the event's scrobble status",
  async (edition) => {
    const f = await fixture(edition);
    const defaultBefore = await h.database().mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    });
    const input = await queueHint(f);
    f.wire.watched = false;
    expect(
      await createMovieWatchFacetV4(f.context, () =>
        Promise.resolve(true),
      ).observeMoviePlexHintV4(input, testPlexBindingExecution()),
    ).toEqual({
      status: "observed",
      complete: true,
    });
    expect(await f.read()).toMatchObject({ watched: false });
    expect(input.scope).toEqual({
      rootMediaId: f.media.id,
      mediaId: f.media.id,
      edition,
    });
    expect(
      await h.database().watchState.count({
        where: { mediaId: f.media.id, edition: "default" },
      }),
    ).toBe(0);
    expect(
      await h.database().mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
      }),
    ).toEqual(defaultBefore);
    expect(
      await h.database().operation.count({
        where: { targetId: f.media.id, kind: "retain_media" },
      }),
    ).toBe(0);
  },
);

test.each(["generation", "epoch", "binding", "disabled", "forged"] as const)(
  "a %s named-cut hint cannot change the prior observation",
  async (change) => {
    const f = await fixture();
    expect(await f.observe()).toMatchObject({ complete: true });
    const before = await f.read();
    let input = await queueHint(f);
    const db = h.database();
    if (change === "generation")
      await db.mediaIntent.update({
        where: {
          mediaId_edition: { mediaId: f.media.id, edition: "extended_cut" },
        },
        data: { generation: { increment: 1 } },
      });
    if (change === "epoch")
      await db.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: { recoveryEpoch: 1 },
      });
    if (change === "binding")
      await db.libraryAsset.update({
        where: { id: f.asset.id },
        data: { owned: false },
      });
    if (change === "forged")
      input = { ...input, scope: { ...input.scope, edition: "directors_cut" } };
    f.wire.calls.splice(0);
    expect(
      await createMovieWatchFacetV4(f.context, () =>
        Promise.resolve(change !== "disabled"),
      ).observeMoviePlexHintV4(input, testPlexBindingExecution()),
    ).toEqual({
      status: change === "disabled" ? "disabled" : "superseded",
      complete: false,
    });
    expect(f.wire.calls).toEqual([]);
    expect(await f.read()).toEqual(before);
  },
);

describe("periodic named watch polling", () => {
  const isolated = automationTestHarness();
  test("the periodic watch sweep reaches a named cut whose default target is unavailable", async () => {
    const f = await fixture("extended_cut", isolated);
    const activities = createSweepActivities(f.context);
    const first = await activities.sweepMediaWork({
      kind: "watch",
      sweepId: crypto.randomUUID(),
      cursor: null,
    });
    expect(await f.read()).toBeNull();
    expect(first.nextCursor).toBe("movie-watch:start");
    const named = await activities.sweepMediaWork({
      kind: "watch",
      sweepId: crypto.randomUUID(),
      cursor: first.nextCursor,
    });
    expect(named).toEqual({ processed: 1, nextCursor: null });
    expect(await f.read()).toMatchObject({ watched: true });
  });
});
