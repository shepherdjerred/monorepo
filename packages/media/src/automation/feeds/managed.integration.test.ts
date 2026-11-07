import { afterEach, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createManagedMovieFixture } from "#testing/movie-workflow/managed-fixture.ts";
import { createManagedSeriesFixture } from "#testing/series-workflow/fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { MOVIE_EDITION_REGISTRY } from "#shared/movie-editions/registry.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { matchProviderFeedSourceV1 } from "./matching.ts";
import { captureManagedFeedSource } from "./managed-feed.test-support.ts";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
let tvUpgrade: Uint8Array;
let tvOriginal: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture();
  tvOriginal = await movieVideoFixture(1280);
  upgrade = await movieVideoFixture(3840, undefined, { bitrateKbps: 160_000 });
  tvUpgrade = await movieVideoFixture(1920, undefined, {
    bitrateKbps: 160_000,
  });
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function managedMovie(edition: "directors_cut" | "extended_cut") {
  return createManagedMovieFixture(
    h,
    edition,
    (directory) => directories.push(directory),
    { original, upgrade },
  );
}
async function movieFeed(
  f: Awaited<ReturnType<typeof managedMovie>>,
  providerId: "knaben" | "privatehd",
) {
  const label = MOVIE_EDITION_REGISTRY[f.scope.edition].plexLabel.replaceAll(
    " ",
    ".",
  );
  return captureManagedFeedSource(f.context, {
    providerId,
    title: `${f.network.media.title.replaceAll(" ", ".")}.2020.${label}.2160p.WEB-DL.H264.English-MEDIA`,
    sizeBytes: upgrade.byteLength,
  });
}
async function movieBaseline(f: Awaited<ReturnType<typeof managedMovie>>) {
  const db = h.database();
  return {
    asset: await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    }),
    receipt: await db.mediaHandoffReceipt.findUniqueOrThrow({
      where: { id: f.receiptId },
    }),
    pointer: await db.plexBindingCurrent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
  };
}

test.each(["knaben", "privatehd"] as const)(
  "actual %s recent feed queues and reserves an adopted named movie through library management without a requester",
  async (providerId) => {
    const f = await managedMovie(
      providerId === "knaben" ? "directors_cut" : "extended_cut",
    );
    const baseline = await movieBaseline(f);
    const feed = await movieFeed(f, providerId);
    expect(
      await matchProviderFeedSourceV1(feed.context, feed.input),
    ).toMatchObject({ status: "processed", nextCursor: null });
    const queued = await h.database().operation.findUniqueOrThrow({
      where: {
        idempotencyKey: `feed-acquire-v1:${feed.source.id}:${f.scope.mediaId}:${f.scope.edition}:${String(f.input.generation)}`,
      },
      include: { outbox: true },
    });
    expect(queued).toMatchObject({
      kind: "reconcile_movie_edition_v4",
      userId: f.network.actor.id,
      payload: { scope: f.scope, libraryManagementReceiptId: f.receiptId },
    });
    expect(queued.outbox).toMatchObject({
      kind: "reconcile_movie_edition_v4",
      payload: queued.payload,
    });
    const started: { workflowId: string; workflowType: string }[] = [];
    await createOutboxActivities(h.database(), async (input) => {
      started.push({
        workflowId: input.workflowId,
        workflowType: input.workflowType,
      });
    }).dispatchMediaOutbox();
    expect(started).toContainEqual({
      workflowId: `media-operation-${queued.id}`,
      workflowType: "reconcileMovieEditionV4Workflow",
    });
    const input = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(queued.payload),
    );
    const reserved = await f.movie.reconcileMovieIntentV4(
      input,
      testPlexBindingExecution(),
    );
    expect(reserved).toMatchObject({ status: "acquire", reason: null });
    const attempt = await h.database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: z.uuid().parse(reserved.attemptId) },
    });
    expect(attempt).toMatchObject({
      sponsorRequestId: null,
      movieEditionChoiceId: null,
      identityEvidence: { schemaVersion: 3 },
      movieEditionAuthority: {
        kind: "library_management",
        receiptId: f.receiptId,
      },
    });
    expect(
      await h
        .database()
        .mediaRequest.count({ where: { mediaId: f.scope.mediaId } }),
    ).toBe(0);
    expect(
      await h
        .database()
        .movieEditionChoice.count({ where: { rootMediaId: f.scope.mediaId } }),
    ).toBe(0);
    expect(await movieBaseline(f)).toEqual(baseline);
    expect(await h.database().torrent.count()).toBe(0);
    expect(await matchProviderFeedSourceV1(feed.context, feed.input)).toEqual({
      status: "processed",
      processed: 0,
      nextCursor: null,
    });
    expect(
      await h
        .database()
        .operation.count({ where: { idempotencyKey: queued.idempotencyKey } }),
    ).toBe(1);
  },
  60_000,
);

test("a native single-episode source uses the actual approved TV leaf grant without creating personal demand", async () => {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original: tvOriginal, upgrade: tvUpgrade, episodeCount: 1 },
  );
  const mediaId = z.uuid().parse(f.ids[0]);
  const baseline = await h
    .database()
    .mediaHandoffReceipt.findUniqueOrThrow({ where: { id: f.receiptId } });
  const feed = await captureManagedFeedSource(f.context, {
    providerId: "knaben",
    title: `${f.series.title}.2020.S01E01.1080p.WEB-DL.H264.English-MEDIA`,
    sizeBytes: tvUpgrade.byteLength,
  });
  expect(
    await matchProviderFeedSourceV1(feed.context, feed.input),
  ).toMatchObject({ status: "processed", nextCursor: null });
  const target = await h.database().mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId, edition: "default" } },
  });
  const queued = await h.database().operation.findUniqueOrThrow({
    where: {
      idempotencyKey: `feed-acquire-v1:${feed.source.id}:${mediaId}:default:${String(target.generation)}`,
    },
    include: { outbox: true },
  });
  expect(queued.outbox).toMatchObject({
    kind: "reconcile_media",
    payload: queued.payload,
  });
  const input = z
    .object({
      operationId: z.uuid(),
      mediaId: z.uuid(),
      generation: z.int().nonnegative(),
    })
    .parse(queued.payload);
  const reserved = await createAcquisitionActivities(
    f.context,
  ).reconcileMediaIntent(input);
  expect(reserved).toMatchObject({ status: "acquire", reason: null });
  const attempt = await h.database().acquisitionAttempt.findUniqueOrThrow({
    where: { id: z.uuid().parse(reserved.attemptId) },
  });
  expect(attempt).toMatchObject({
    sponsorRequestId: null,
    identityEvidence: {
      schemaVersion: 4,
      management: { receiptId: f.receiptId },
    },
  });
  expect(await h.database().mediaRequest.count({ where: { mediaId } })).toBe(0);
  expect(
    await h
      .database()
      .mediaHandoffReceipt.findUniqueOrThrow({ where: { id: f.receiptId } }),
  ).toEqual(baseline);
}, 60_000);

test.each(["revoked_owner", "original99"] as const)(
  "%s protects managed feed enqueue without inventing a request or changing the source",
  async (protection) => {
    const f = await managedMovie("directors_cut");
    const feed = await movieFeed(f, "knaben");
    const budget = new PublicationAuthorityReadBudget();
    const context = {
      ...feed.context,
      movieManagement: { execution: testPlexBindingExecution(), budget },
    };
    if (protection === "revoked_owner") {
      const current = await authenticateMovieFixtureOwner(
        f.context,
        f.network.actor,
        { ownerAccountId: "710099" },
      );
      expect(current.role).toBe("member");
      expect(
        await matchProviderFeedSourceV1(context, feed.input),
      ).toMatchObject({ status: "processed", nextCursor: null });
    } else {
      budget.consume(99);
      await expect(
        matchProviderFeedSourceV1(context, feed.input),
      ).rejects.toThrow(NativeArchiveScopeProtection);
      expect(budget.take).toBeLessThanOrEqual(0);
    }
    expect(
      await h.database().operation.count({
        where: {
          idempotencyKey: `feed-acquire-v1:${feed.source.id}:${f.scope.mediaId}:${f.scope.edition}:${String(f.input.generation)}`,
        },
      }),
    ).toBe(0);
    expect(
      await h
        .database()
        .mediaRequest.count({ where: { mediaId: f.scope.mediaId } }),
    ).toBe(0);
    expect(
      await h
        .database()
        .applicationEvent.findUniqueOrThrow({ where: { id: feed.source.id } }),
    ).toEqual(feed.source);
  },
  60_000,
);
