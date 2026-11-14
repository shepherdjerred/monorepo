import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { retentionPlexContext } from "#automation/retention/fixtures/plex.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { MediaRequestCommands } from "#infrastructure/request-commands.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { refreshInterestNoticeReceipts } from "#automation/notifications/interest-receipts.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { nativeInterestFacts } from "./facts.ts";
import { reconcileRequestInterests } from "./reconcile.ts";
import { RequestInterestCommands } from "./commands.ts";
import { getRequestInterestProgress } from "./progress.ts";
import { householdRetentionState } from "./protection.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { noticeAcceptance } from "./acceptance.ts";
import { InterestCheckNoticeSchema } from "#shared/household/interests.ts";

const h = automationTestHarness();
const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];
const DAY = 86_400_000;
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

/** Physical inspection/promotion, actual Plex binding/finalization and native requester observation.
 * Only external protocol responses and the existing inspection fixture are synthetic. */
async function fixture(tv = false) {
  const db = h.database();
  const files = tv
    ? await sharedTvFileFixture(db, mappedPublicationFixture)
    : await mappedPublicationFixture(db);
  directories.push(files.directory);
  const published = await preparePhysicalPublication(files);
  const ids = published.entry.mediaIds;
  const user = await db.mediaUser.update({
    where: { id: files.user.id },
    data: {
      email: `${files.user.id}@interest.fixture`,
      emailVerifiedAt: new Date(),
      notificationPreference: { create: { emailEnabled: true } },
    },
  });
  const transport = await retentionPlexContext(db, h.context(), ids);
  await db.credential.create({
    data: {
      userId: user.id,
      kind: "plex",
      ciphertext: transport.context.cipher.encrypt(
        JSON.stringify({ serverToken: `synthetic-requester:${user.id}` }),
        `plex:${user.plexAccountId}`,
      ),
    },
  });
  const publication = createPublicationActivities(transport.context);
  expect(await publication.publishMediaToPlex(published.input)).toEqual({
    status: "available",
    reason: null,
  });
  await publication.finalizeMediaAcquisition(published.input);
  await db.mediaItem.updateMany({
    where: { id: { in: ids } },
    data: { originalLanguage: "en", airDate: new Date(Date.now() - DAY) },
  });
  const rootId = tv ? files.media.parentId : files.media.id;
  if (rootId === null) throw new Error("TV fixture lost canonical series");
  let request = await db.mediaRequest.findUniqueOrThrow({
    where: { id: files.request.id },
  });
  if (tv) {
    await db.mediaItem.update({
      where: { id: rootId },
      data: {
        originalLanguage: "en",
        catalogState: "ready",
        catalogCompletedAt: new Date(),
        seriesStatus: "continuing",
        seriesStatusObservedAt: new Date(),
      },
    });
    const command = await new MediaRequestCommands(db, {
      keepDays: 30,
      serverMachineId: "fixture-server",
    }).createRequest(user, crypto.randomUUID(), {
      mediaId: rootId,
      subtitleLanguages: [],
      includeFutureEpisodes: true,
      includeSpecials: false,
      keepingPolicy: "temporary",
    });
    request = await db.mediaRequest.findUniqueOrThrow({
      where: { id: z.uuid().parse(command.requestId) },
    });
    await createCoverageActivities({ db }).expandMediaRequest({
      operationId: z.uuid().parse(command.operationId),
      requestId: request.id,
      requestVersion: request.version,
      cursor: null,
    });
    request = await db.mediaRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
  }
  const observe = async (watched: boolean) => {
    transport.state.watched = watched;
    for (const mediaId of ids)
      expect(await observeRequesterWatch(transport.context, mediaId)).toEqual({
        complete: true,
        reason: null,
      });
  };
  const read = () =>
    db.mediaRequest.findUniqueOrThrow({ where: { id: request.id } });
  const facts = async () =>
    db.$transaction(async (tx) =>
      nativeInterestFacts(tx, await read(), new Date()),
    );
  const sweep = async () => {
    // One production sweep page is intentionally one request. Drain pages so
    // sibling leaf claims cannot hide the root under test.
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const result = await reconcileRequestInterests(db, { cursor });
      if (result.processed === 0) return;
      cursor = result.nextCursor;
    }
    throw new Error("Native fixture exceeded its bounded interest pages");
  };
  return {
    db,
    files,
    published,
    ids,
    user,
    rootId,
    request,
    transport,
    observe,
    read,
    facts,
    sweep,
  };
}

test("actual watched Temporary movie finishes without rewriting its publication or watch authority", async () => {
  const f = await fixture();
  await f.observe(true);
  const before = await f.db.plexWatchProjection.findMany({
    where: { mediaId: f.rootId },
  });
  const binding = await f.db.plexBindingCurrent.findMany({
    where: { mediaId: f.rootId },
  });
  expect(await f.facts()).toMatchObject({
    watchedComplete: true,
    requestedCoverageComplete: true,
  });
  await f.sweep();
  expect(await f.read()).toMatchObject({
    interestState: "finished",
    interestReleaseReason: "watched",
  });
  expect(
    await f.db.plexWatchProjection.findMany({ where: { mediaId: f.rootId } }),
  ).toEqual(before);
  expect(
    await f.db.plexBindingCurrent.findMany({ where: { mediaId: f.rootId } }),
  ).toEqual(binding);
}, 60_000);

test.each(["default", "directors_cut"] as const)(
  "%s cancellation withdraws consent and preserves owner-granted Keep until an explicit owner release",
  async (edition) => {
    const db = h.database();
    const base = await h.fixture();
    const owner = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Owner",
        role: "owner",
      },
    });
    const chosen = await requestTestMovieV4(
      db,
      base.user,
      base.media.id,
      edition,
    );
    const interests = new RequestInterestCommands(db, { keepDays: 30 });
    const request = await db.mediaRequest.findUniqueOrThrow({
      where: { id: chosen.result.requestId },
    });
    await interests.execute(owner, crypto.randomUUID(), {
      schemaVersion: 1,
      requestId: request.id,
      expectedVersion: request.version,
      expectedInterestRevision: request.interestRevision,
      action: "keep",
    });
    const temporary = async () => {
      const media = await db.mediaItem.findUniqueOrThrow({
        where: { id: base.media.id },
      });
      const target = await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: media.id, edition } },
      });
      await interests.libraryPolicy(owner, crypto.randomUUID(), {
        schemaVersion: 1,
        mediaId: media.id,
        edition,
        expectedMediaVersion: media.version,
        expectedTargetVersion: target.version,
        keepingPolicy: "temporary",
      });
    };
    await temporary();
    expect(
      await db.$transaction((tx) =>
        householdRetentionState(tx, base.media.id, edition),
      ),
    ).toMatchObject({
      reason: "request_kept_indefinitely",
      libraryKeep: false,
    });
    const current = await db.mediaRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    if (edition === "default")
      await new MediaRequestCommands(db, { keepDays: 30 }).cancelRequest(
        base.user,
        crypto.randomUUID(),
        current.id,
        current.version,
      );
    else {
      const target = await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: base.media.id, edition } },
      });
      await chosen.commands.cancelMovieEditionRequestV4(
        base.user,
        crypto.randomUUID(),
        {
          schemaVersion: 4,
          action: "cancel_request",
          scope: {
            rootMediaId: base.media.id,
            mediaId: base.media.id,
            edition,
          },
          subjectUserId: base.user.id,
          requestId: current.id,
          expected: {
            targetVersion: target.version,
            requestVersion: current.version,
            choiceRevision: current.movieEditionChoiceRevision,
          },
        },
      );
    }
    expect(
      await db.mediaRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).toMatchObject({
      active: false,
      direct: false,
      excluded: true,
      movieEditionChoiceId: null,
    });
    expect(
      await db.$transaction((tx) =>
        householdRetentionState(tx, base.media.id, edition),
      ),
    ).toMatchObject({ reason: "library_kept_indefinitely", libraryKeep: true });
    const transferred = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: base.media.id, edition } },
    });
    expect(transferred).toMatchObject({
      libraryPolicyExplicit: true,
      libraryPolicyActorId: null,
    });
    await temporary();
    expect(
      await db.$transaction((tx) =>
        householdRetentionState(tx, base.media.id, edition),
      ),
    ).toMatchObject({ reason: null, libraryKeep: false });
  },
  60_000,
);

test.each(["continuing", "ended", "cancelled"] as const)(
  "actual watched %s TV uses complete requested coverage",
  async (status) => {
    const f = await fixture(true);
    await f.db.mediaItem.update({
      where: { id: f.rootId },
      data: { seriesStatus: status, seriesStatusObservedAt: new Date() },
    });
    await f.observe(true);
    expect(
      await getRequestInterestProgress(f.db, f.user, f.request.id),
    ).toMatchObject({
      status: status === "continuing" ? "caught_up" : "complete",
      counts: {
        requested: 2,
        released: 2,
        available: 2,
        watched: 2,
        captionsPending: 0,
      },
    });
    await f.sweep();
    expect(await f.read()).toMatchObject({
      interestState: status === "continuing" ? "following" : "finished",
      interestReleaseReason: status === "continuing" ? null : "series_finished",
    });
  },
  60_000,
);

test("known unaired and missing requested episodes protect complete-show release; only an explicit own exclusion masks a leaf", async () => {
  const f = await fixture(true);
  await f.observe(true);
  const unaired = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Future episode",
      parentId: f.rootId,
      seasonNumber: 1,
      episodeNumber: 3,
      airDate: new Date(Date.now() + DAY),
    },
  });
  expect(await f.facts()).toMatchObject({
    requestedCoverageComplete: false,
    watchedComplete: false,
  });
  expect(
    await getRequestInterestProgress(f.db, f.user, f.request.id),
  ).toMatchObject({
    status: "caught_up",
    counts: { requested: 3, released: 2, watched: 2 },
  });
  await f.db.mediaItem.update({
    where: { id: f.rootId },
    data: { seriesStatus: "ended", seriesStatusObservedAt: new Date() },
  });
  await f.sweep();
  expect(await f.read()).toMatchObject({ interestState: "following" });
  await f.db.mediaItem.update({
    where: { id: unaired.id },
    data: { airDate: new Date(Date.now() - DAY) },
  });
  expect(
    await getRequestInterestProgress(f.db, f.user, f.request.id),
  ).toMatchObject({
    status: "following",
    reason: "requested_content_unavailable",
  });
  await f.db.$transaction((tx) =>
    lockDefaultScopes(tx, [{ mediaId: unaired.id, edition: "default" }], {
      createMissing: true,
    }),
  );
  const other = await f.db.mediaUser.create({
    data: { plexAccountId: crypto.randomUUID(), displayName: "Other member" },
  });
  await f.db.mediaRequest.create({
    data: {
      mediaId: unaired.id,
      userId: other.id,
      excluded: true,
      active: false,
      direct: false,
    },
  });
  expect(await f.facts()).toMatchObject({ requestedCoverageComplete: false });
  await f.db.mediaRequest.create({
    data: {
      mediaId: unaired.id,
      userId: f.user.id,
      excluded: true,
      active: false,
      direct: false,
    },
  });
  expect(await f.facts()).toMatchObject({
    requestedCoverageComplete: true,
    watchedComplete: true,
  });
  await f.sweep();
  expect(await f.read()).toMatchObject({
    interestState: "finished",
    interestReleaseReason: "series_finished",
  });
}, 60_000);

test.each(["unaired", "missing", "captions_pending"] as const)(
  "mixed usable TV backlog with %s sibling stays protected despite an elapsed accepted notice",
  async (blocked) => {
    const f = await fixture(true);
    await f.observe(false);
    expect(await f.facts()).toMatchObject({
      usableUnwatched: true,
      watchedComplete: false,
      requestedCoverageComplete: true,
    });
    if (blocked === "captions_pending") {
      await f.db.mediaItem.update({
        where: { id: z.uuid().parse(f.ids[0]) },
        data: { originalLanguage: "ja" },
      });
    } else {
      await f.db.mediaItem.create({
        data: {
          kind: "episode",
          title: "Requested unavailable sibling",
          parentId: f.rootId,
          seasonNumber: 1,
          episodeNumber: 3,
          airDate: new Date(Date.now() + (blocked === "unaired" ? DAY : -DAY)),
        },
      });
    }
    const request = await f.read();
    const acceptedAt = new Date(Date.now() - 8 * DAY);
    const notice = await f.db.applicationEvent.create({
      data: {
        mediaId: f.rootId,
        kind: "interest_check",
        createdAt: acceptedAt,
        payload: InterestCheckNoticeSchema.parse({
          schemaVersion: 1,
          requestId: request.id,
          userId: request.userId,
          interestRevision: request.interestRevision,
          mediaId: request.mediaId,
          edition: request.edition,
        }),
      },
    });
    await f.db.mediaRequest.update({
      where: { id: request.id },
      data: {
        interestRenewedAt: new Date(Date.now() - 40 * DAY),
        usableUnwatchedSince: new Date(Date.now() - 40 * DAY),
        interestNoticeEventId: notice.id,
        interestNoticeRevision: request.interestRevision,
        interestNoticeViewedAt: acceptedAt,
        interestNoticeAcceptedAt: acceptedAt,
      },
    });
    expect(
      await f.db.$transaction(async (tx) =>
        noticeAcceptance(tx, await f.read(), new Date()),
      ),
    ).toEqual(acceptedAt);
    expect(await f.facts()).toMatchObject({
      usableUnwatched: false,
      watchedComplete: false,
      requestedCoverageComplete: blocked === "captions_pending",
    });
    await f.sweep();
    const protectedRequest = await f.read();
    expect(protectedRequest).toMatchObject({
      interestState: "following",
      usableUnwatchedSince: null,
      interestNoticeEventId: null,
    });
    expect(
      await f.db.$transaction((tx) =>
        householdRetentionState(tx, z.uuid().parse(f.ids[0])),
      ),
    ).toMatchObject({ reason: "requester_still_following" });
    // Explicit withdrawal remains available; the automatic protection cannot
    // prevent a person from deciding to stop following this request.
    await new RequestInterestCommands(f.db, { keepDays: 30 }).execute(
      f.user,
      crypto.randomUUID(),
      {
        schemaVersion: 1,
        requestId: protectedRequest.id,
        expectedVersion: protectedRequest.version,
        expectedInterestRevision: protectedRequest.interestRevision,
        action: "drop",
      },
    );
    expect(await f.read()).toMatchObject({
      interestState: "dropped",
      interestReleaseReason: "dropped_manually",
    });
  },
  60_000,
);

test("snapshot request masks later catalog additions but unknown air dates remain protective", async () => {
  const f = await fixture(true);
  await f.observe(true);
  await f.db.mediaRequest.update({
    where: { id: f.request.id },
    data: { includeFutureEpisodes: false },
  });
  const late = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Later catalog entry",
      parentId: f.rootId,
      seasonNumber: 1,
      episodeNumber: 3,
    },
  });
  expect(await f.facts()).toMatchObject({
    requestedCoverageComplete: true,
    watchedComplete: true,
  });
  await f.db.mediaRequest.update({
    where: { id: f.request.id },
    data: { includeFutureEpisodes: true },
  });
  expect(await f.facts()).toMatchObject({ requestedCoverageComplete: false });
  expect(
    await getRequestInterestProgress(f.db, f.user, f.request.id),
  ).toMatchObject({
    status: "following",
    counts: { requested: 3, released: null },
  });
  expect(late.airDate).toBeNull();
}, 60_000);

test("progress privacy uses the fresh actor role and does not write any authority", async () => {
  const f = await fixture();
  await f.observe(false);
  const stranger = await f.db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Other member",
      role: "owner",
    },
  });
  const before = await f.read();
  expect(
    await getRequestInterestProgress(f.db, stranger, f.request.id),
  ).toMatchObject({ counts: { watched: 0, available: 1 } });
  await f.db.mediaUser.update({
    where: { id: stranger.id },
    data: { role: "member" },
  });
  await expect(
    getRequestInterestProgress(f.db, stranger, f.request.id),
  ).rejects.toMatchObject({ status: 404 });
  expect(await f.read()).toEqual(before);
  await f.db.plexIdentityMapping.update({
    where: { userId: f.user.id },
    data: { plexRestricted: true },
  });
  expect(
    await getRequestInterestProgress(f.db, f.user, f.request.id),
  ).toMatchObject({
    status: "unknown",
    reason: "requester_access_not_current",
    counts: { watched: null },
  });
}, 60_000);

test("foreign video waits for required English captions, and publication alone does not assert a movie release date", async () => {
  const f = await fixture();
  await f.observe(false);
  expect(
    await getRequestInterestProgress(f.db, f.user, f.request.id),
  ).toMatchObject({ counts: { released: null, available: 1, watched: 0 } });
  await f.db.mediaItem.update({
    where: { id: f.rootId },
    data: { originalLanguage: "ja" },
  });
  expect(await f.facts()).toMatchObject({
    usableUnwatched: false,
    watchedComplete: false,
  });
  expect(
    await getRequestInterestProgress(f.db, f.user, f.request.id),
  ).toMatchObject({
    status: "following",
    reason: "required_english_captions_pending",
    counts: { available: 0, captionsPending: 1 },
  });
  await f.db.mediaReleaseDate.create({
    data: {
      id: crypto.randomUUID(),
      mediaId: f.rootId,
      region: "US",
      kind: "digital",
      date: "2020-01-01",
      precision: "day",
      observedAt: new Date(),
    },
  });
  expect(
    await getRequestInterestProgress(f.db, f.user, f.request.id),
  ).toMatchObject({ counts: { released: 1, available: 0 } });
  await f.sweep();
  expect(await f.read()).toMatchObject({
    interestState: "following",
    interestNoticeEventId: null,
  });
}, 60_000);

test.each(["fresh", "elapsed", "renewed"] as const)(
  "native unwatched movie waits 30 days and an accepted private notice's seven-day reply period (%s)",
  async (mode) => {
    const f = await fixture();
    await f.observe(false);
    const baseline = async (days: number) =>
      f.db.mediaRequest.update({
        where: { id: f.request.id },
        data: {
          interestRenewedAt: new Date(Date.now() - days * DAY),
          usableUnwatchedSince: new Date(Date.now() - days * DAY),
        },
      });
    await baseline(29);
    await f.sweep();
    const beforeDue = await f.read();
    expect(beforeDue.interestNoticeEventId).toBeNull();
    await baseline(40);
    // Simulate elapsed policy history at ORIGINAL notice/receipt producer writes.
    // No serving binding, playback authority, native clock or existing receipt is changed.
    const noticeAt = new Date(Date.now() - 8 * DAY);
    const events = new Set<string>();
    const deliveries = new Set<string>();
    const accepted = new Set<string>();
    const historical = mode !== "fresh";
    const policyDb = queryFixtureDatabase(f.db, {
      query: {
        applicationEvent: {
          async create({ args, query }) {
            const selected =
              historical &&
              args.data.mediaId === f.rootId &&
              args.data.kind === "interest_check";
            if (selected) args.data.createdAt = noticeAt;
            const row = await query(args);
            if (selected) events.add(z.uuid().parse(row.id));
            return row;
          },
        },
        notificationDelivery: {
          async create({ args, query }) {
            const selected =
              args.data.eventId !== undefined && events.has(args.data.eventId);
            if (selected)
              args.data.createdAt = new Date(noticeAt.getTime() + 1);
            const row = await query(args);
            if (selected) deliveries.add(z.uuid().parse(row.id));
            return row;
          },
          async update({ args, query }) {
            const id = args.where.id ?? "";
            if (
              deliveries.has(id) &&
              !accepted.has(id) &&
              args.data.acceptedAt instanceof Date
            ) {
              args.data.acceptedAt = new Date(noticeAt.getTime() + 3);
              accepted.add(id);
            }
            return query(args);
          },
        },
        notificationDeliveryAttempt: {
          async create({ args, query }) {
            if (
              args.data.deliveryId !== undefined &&
              deliveries.has(args.data.deliveryId)
            )
              args.data.startedAt = new Date(noticeAt.getTime() + 2);
            return query(args);
          },
        },
      },
    });
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const result = await reconcileRequestInterests(policyDb, { cursor });
      if (result.processed === 0) break;
      cursor = result.nextCursor;
    }
    const request = await f.read();
    expect(request.interestNoticeEventId).not.toBeNull();
    const delivery = await f.db.notificationDelivery.findFirstOrThrow({
      where: {
        eventId: z.uuid().parse(request.interestNoticeEventId),
        userId: f.user.id,
      },
    });
    expect(delivery.channel).toBe("email");
    expect(
      await f.db.notificationDelivery.count({
        where: {
          eventId: delivery.eventId,
          channel: { notIn: ["email", "discord"] },
        },
      }),
    ).toBe(0);
    const sent = new Map<string, string>();
    const page = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("Private requests page"),
    });
    closers.push(async () => {
      await page.stop(true);
    });
    const rendered = await fetch(page.url);
    expect(rendered.status).toBe(200);
    const context = {
      ...f.transport.context,
      db: policyDb,
      publicOrigin: page.url.origin,
      notify: (
        message: Parameters<typeof f.transport.context.notify>[0],
        mutation?: Parameters<typeof f.transport.context.notify>[1],
      ) => {
        mutation?.beforeMutation();
        const receipt = `synthetic-interest:${message.idempotencyKey}`;
        sent.set(receipt, message.recipient);
        return Promise.resolve({ receipt });
      },
      reconcileNotification: (input: { receipt: string }) =>
        Promise.resolve({
          status: "delivered" as const,
          recipient: sent.get(input.receipt) ?? null,
        }),
    };
    const operation = await f.db.operation.findFirstOrThrow({
      where: { kind: "deliver_notification", targetId: delivery.id },
    });
    expect(
      await createNotificationActivities(context).deliverMediaNotification({
        operationId: operation.id,
        notificationId: delivery.id,
      }),
    ).toMatchObject({ status: "accepted" });
    expect(await refreshInterestNoticeReceipts(context, delivery.eventId)).toBe(
      true,
    );
    const original = await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    if (mode === "renewed") {
      const latest = await f.read();
      await new RequestInterestCommands(f.db, { keepDays: 30 }).execute(
        f.user,
        crypto.randomUUID(),
        {
          schemaVersion: 1,
          requestId: latest.id,
          expectedVersion: latest.version,
          expectedInterestRevision: latest.interestRevision,
          action: "continue",
        },
      );
    }
    await f.sweep();
    expect(await f.read()).toMatchObject({
      interestState: mode === "elapsed" ? "expired" : "following",
    });
    const after = await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(after.acceptedAt).toEqual(original.acceptedAt);
    expect(after.providerReceipt).toEqual(original.providerReceipt);
    if (mode === "renewed") {
      const renewed = await f.read();
      expect(renewed.interestNoticeEventId).toBeNull();
    }
  },
  60_000,
);
