import { expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { sweepFeeds } from "#automation/reconciliation/feeds.ts";
import { matchProviderFeedSourceV1 } from "./matching.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";
import {
  FeedSourceV1Schema,
  MatchFeedSourceV1Schema,
} from "#shared/feeds/contract.ts";

const h = automationTestHarness();

async function captured(title: string) {
  const context = h.context();
  const release = crypto.randomUUID();
  const native = new KnabenProvider((url) => {
    expect(url.pathname).toBe("/v2/browse");
    return Promise.resolve(
      Response.json({
        hits: [
          {
            id: release,
            title,
            bytes: 1000,
            hash: "a".repeat(40),
            seeders: 2,
            details: "https://knaben.org/fixture",
            magnetUrl: null,
          },
        ],
      }),
    );
  });
  context.providers = {
    withProvider: (id, work) => {
      expect(id).toBe("knaben");
      return work(native);
    },
  };
  const sweepId = crypto.randomUUID();
  expect(await sweepFeeds(context, null, sweepId)).toEqual({
    processed: 1,
    nextCursor: "knaben",
  });
  const events = await context.db.applicationEvent.findMany({
    where: { kind: "provider_feed_source_v1" },
  });
  const source = events.find(
    (event) =>
      FeedSourceV1Schema.parse(event.payload).providerReleaseId === release,
  );
  if (source === undefined)
    throw new Error("Actual native feed observation missing");
  const operation = await context.db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `match-feed-source-v1:${source.id}` },
  });
  const input = MatchFeedSourceV1Schema.parse(
    z.object(MatchFeedSourceV1Schema.shape).parse(operation.payload),
  );
  return { context, input, source, release };
}

test.each(["movie", "episode"] as const)(
  "native feed captures, matches and reserves an actual %s request through the existing acquisition guards",
  async (kind) => {
    const f = await h.fixture("123", { kind });
    if (f.series !== null)
      await h
        .database()
        .mediaItem.update({ where: { id: f.series.id }, data: { year: 2020 } });
    const title =
      kind === "movie"
        ? "Example.2020.WEB-DL.1080p"
        : "Example.Series.2020.S01E01.WEB-DL.1080p";
    const feed = await captured(title);
    expect(
      await matchProviderFeedSourceV1(feed.context, feed.input),
    ).toMatchObject({ status: "processed", nextCursor: null });
    const release = await h.database().releaseCandidate.findUniqueOrThrow({
      where: {
        providerId_providerReleaseId: {
          providerId: "knaben",
          providerReleaseId: feed.release,
        },
      },
    });
    expect(release.mediaIds).toContain(f.media.id);
    const operation = await h.database().operation.findFirstOrThrow({
      where: {
        kind: "reconcile_media",
        targetId: f.media.id,
        payload: { path: ["releaseId"], equals: release.id },
      },
    });
    const target = await h.database().mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    });
    const reconciled = await createAcquisitionActivities(
      feed.context,
    ).reconcileMediaIntent({
      operationId: operation.id,
      mediaId: f.media.id,
      generation: target.generation,
    });
    expect(reconciled).toMatchObject({ status: "acquire", reason: null });
    const attempt = await h.database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: z.uuid().parse(reconciled.attemptId) },
    });
    expect(attempt).toMatchObject({
      releaseId: release.id,
      state: "reserved",
      edition: "default",
    });
    expect(await h.database().torrent.count()).toBe(0);
    expect(await h.database().libraryAsset.count()).toBe(0);
    feed.context.permittedSections = () =>
      Promise.reject(
        new Error("Completed matching must precede current configuration"),
      );
    expect(await matchProviderFeedSourceV1(feed.context, feed.input)).toEqual({
      status: "processed",
      processed: 0,
      nextCursor: null,
    });
  },
);

test("an unrelated monitored title cannot poison the retained candidate before its correct target is examined", async () => {
  const unrelated = await h.fixture();
  await h.database().mediaItem.update({
    where: { id: unrelated.media.id },
    data: { title: "Different work" },
  });
  const wanted = await h.fixture();
  await h.database().mediaItem.update({
    where: { id: wanted.media.id },
    data: { title: "Wanted Film" },
  });
  const feed = await captured("Wanted.Film.2020.WEB-DL.1080p");
  await matchProviderFeedSourceV1(feed.context, feed.input);
  const release = await h.database().releaseCandidate.findUniqueOrThrow({
    where: {
      providerId_providerReleaseId: {
        providerId: "knaben",
        providerReleaseId: feed.release,
      },
    },
  });
  expect(release.mediaIds).toEqual([wanted.media.id]);
  expect(
    await h.database().operation.count({
      where: {
        targetId: unrelated.media.id,
        kind: "reconcile_media",
        payload: { path: ["releaseId"], equals: release.id },
      },
    }),
  ).toBe(0);
});

test.each(MovieEditionKeySchema.options)(
  "a native %s movie source queues its acquisition scope without selecting another cut",
  async (edition) => {
    const f = await h.fixture();
    const db = h.database();
    // Distinct canonical works must not compete for one synthetic same-title
    // source; retained candidate identity is intentionally immutable.
    const workTitle = `Source ${z.string().parse(["Cardinal", "Osprey", "Falcon", "Heron", "Raven", "Swift", "Finch"][MovieEditionKeySchema.options.indexOf(edition)])}`;
    await h.database().mediaItem.update({
      where: { id: f.media.id },
      data: { title: workTitle },
    });
    await db.qualityProfileDefault.upsert({
      where: { kind: "movie" },
      create: { kind: "movie", profileId: f.profile.id },
      update: { profileId: f.profile.id },
    });
    const requested = await requestTestMovieV4(db, f.user, f.media.id, edition);
    const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
    const title = `${workTitle.replaceAll(" ", ".")}.2020.${label === "" ? "" : `${label.replaceAll(" ", ".")}.`}WEB-DL.1080p`;
    const feed = await captured(title);
    await matchProviderFeedSourceV1(feed.context, feed.input);
    const release = await db.releaseCandidate.findUniqueOrThrow({
      where: {
        providerId_providerReleaseId: {
          providerId: "knaben",
          providerReleaseId: feed.release,
        },
      },
    });
    const command = await db.operation.findFirstOrThrow({
      where: {
        kind:
          edition === "default"
            ? "reconcile_media"
            : "reconcile_movie_edition_v4",
        targetId: f.media.id,
        payload: { path: ["releaseId"], equals: release.id },
      },
      include: { outbox: true },
    });
    expect(command.outbox).toMatchObject({
      payload: { releaseId: release.id },
    });
    if (edition !== "default")
      expect(command.outbox).toMatchObject({
        payload: { schemaVersion: 4, scope: requested.input.scope },
      });
    expect(
      await h
        .database()
        .acquisitionAttempt.count({ where: { releaseId: release.id } }),
    ).toBe(0);
  },
);

test("ownership loss pauses matching without advancing its checkpoint or granting acquisition", async () => {
  await h.fixture();
  const feed = await captured("Example.2020.WEB-DL.1080p");
  await h.database().mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "observe", ownershipConfirmed: false },
  });
  expect(await matchProviderFeedSourceV1(feed.context, feed.input)).toEqual({
    status: "paused",
    processed: 0,
    nextCursor: null,
  });
  const operation = await h
    .database()
    .operation.findUniqueOrThrow({ where: { id: feed.input.operationId } });
  expect(operation.result).toBeNull();
});

test("actual cancellation before matching removes that scope's acquisition authority", async () => {
  const f = await h.fixture();
  const feed = await captured("Example.2020.WEB-DL.1080p");
  const db = h.database();
  const request = await db.mediaRequest.findFirstOrThrow({
    where: { userId: f.user.id, mediaId: f.media.id, edition: "default" },
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
  });
  await new PrismaMediaApplication(db, {
    keepDays: 7,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  }).cancelMovieEditionRequest(f.user, crypto.randomUUID(), {
    schemaVersion: 3,
    action: "cancel_request",
    subjectUserId: f.user.id,
    scope: { rootMediaId: f.media.id, mediaId: f.media.id, edition: "default" },
    requestId: request.id,
    expected: {
      targetVersion: target.version,
      requestVersion: request.version,
      choiceRevision: request.movieEditionChoiceRevision,
    },
  });
  await matchProviderFeedSourceV1(feed.context, feed.input);
  expect(
    await db.operation.count({
      where: {
        targetId: f.media.id,
        idempotencyKey: {
          startsWith: `feed-acquire-v1:${feed.input.sourceId}:`,
        },
      },
    }),
  ).toBe(0);
});

test("a known future episode does not acquire from a current recent listing", async () => {
  const f = await h.fixture("123", { kind: "episode" });
  if (f.series === null) throw new Error("Actual episode series missing");
  await h.database().mediaItem.update({
    where: { id: f.series.id },
    data: { title: "Future Series", year: 2020 },
  });
  await h.database().mediaItem.update({
    where: { id: f.media.id },
    data: { airDate: new Date(Date.now() + 86_400_000) },
  });
  const feed = await captured("Future.Series.2020.S01E01.WEB-DL.1080p");
  await matchProviderFeedSourceV1(feed.context, feed.input);
  expect(
    await h.database().operation.count({
      where: {
        targetId: f.media.id,
        idempotencyKey: {
          startsWith: `feed-acquire-v1:${feed.input.sourceId}:`,
        },
      },
    }),
  ).toBe(0);
});

test.each([
  "Example.2020.Theatrical.Cut.WEB-DL.1080p",
  "Example.2020.Directors.Cut.WEB-DL.720p",
])(
  "feed scope and quality guards reject %s for the requested director's cut",
  async (title) => {
    const f = await h.fixture();
    await h.database().qualityProfileDefault.upsert({
      where: { kind: "movie" },
      create: { kind: "movie", profileId: f.profile.id },
      update: { profileId: f.profile.id },
    });

    await requestTestMovieV4(h.database(), f.user, f.media.id, "directors_cut");
    const feed = await captured(title);
    await matchProviderFeedSourceV1(feed.context, feed.input);
    expect(
      await h.database().operation.count({
        where: {
          targetId: f.media.id,
          idempotencyKey: {
            startsWith: `feed-acquire-v1:${feed.input.sourceId}:`,
          },
        },
      }),
    ).toBe(0);
  },
);

test("matching pages remain bounded, resume their committed cursor and retain immutable completion", async () => {
  for (let index = 0; index < 26; index++) await h.fixture();
  const feed = await captured("Unrelated.Paging.Source.2020.WEB-DL.1080p");
  const first = await matchProviderFeedSourceV1(feed.context, feed.input);
  expect(first).toMatchObject({ status: "processed", processed: 25 });
  expect(first.nextCursor).not.toBeNull();
  let cursor = first.nextCursor;
  for (let page = 0; cursor !== null && page < 20; page++) {
    const next = await matchProviderFeedSourceV1(feed.context, {
      ...feed.input,
      cursor,
    });
    expect(next.processed).toBeLessThanOrEqual(25);
    cursor = next.nextCursor;
  }
  expect(cursor).toBeNull();
  await expect(
    h.database().operation.update({
      where: { id: feed.input.operationId },
      data: { result: {} },
    }),
  ).rejects.toThrow("cannot disappear");
  expect(await matchProviderFeedSourceV1(feed.context, feed.input)).toEqual({
    status: "processed",
    processed: 0,
    nextCursor: null,
  });
});
