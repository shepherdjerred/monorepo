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
import { queueExistingPlexBinding } from "#automation/plex-binding/queue.ts";
import { createPlexBindingActivities } from "#automation/plex-binding/activities.ts";
import { ReverifyPlexBindingInputSchema } from "#shared/plex-binding/activities.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { PrismaPlaybackCollector } from "#infrastructure/playback/collector.ts";
import { PrismaPlaybackHistory } from "#infrastructure/playback/service.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { PlexPlaybackSession } from "#integrations/plex-playback.ts";
import { queueRetentionCheck } from "#automation/watch.ts";
import { createRetentionActivities } from "#automation/retention.ts";

const h = automationTestHarness();
const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];
const DAY = 86_400_000;
const PLAYBACK_ORIGIN = new Date(Date.now() - 20 * 60_000);
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

type PlaybackControl =
  | "resumed"
  | "historical"
  | "other_user"
  | "manual_drop"
  | "manual_finished"
  | "pre_expiry";
async function prepareExpiredPlayback(
  f: Awaited<ReturnType<typeof fixture>>,
  mode: PlaybackControl,
) {
  const owner = await f.db.mediaUser.findFirstOrThrow({
    where: { role: "owner", restricted: false },
  });
  const mapping = await f.db.plexIdentityMapping.findUniqueOrThrow({
    where: { userId: f.user.id },
  });
  if (mapping.serverAccountId === null)
    throw new Error("Native playback requires exact account mapping");
  const claim = await f.db.plexItemClaim.findFirstOrThrow({
    where: {
      mediaId: f.rootId,
      edition: "default",
      serverMachineId: mapping.serverMachineId,
    },
  });
  const existing = await f.db.playbackCollector.findUnique({
    where: { serverMachineId: mapping.serverMachineId },
  });
  if (existing === null)
    expect(
      await f.db.$transaction((tx) => householdRetentionState(tx, f.rootId)),
    ).toMatchObject({ reason: "requester_playback_renewal_pending" });
  const clock = { now: new Date(PLAYBACK_ORIGIN) };
  const through = (existing?.importedThrough ?? clock.now).toISOString();
  const sourceInstanceId =
    existing?.importSourceInstanceId ?? "synthetic-interest-native-history";
  const rows =
    mode === "historical"
      ? [
          {
            id: "1",
            user_id: mapping.serverAccountId,
            rating_key: claim.ratingKey,
            started: Math.floor(clock.now.getTime() / 1000) - 300,
            stopped: Math.floor(clock.now.getTime() / 1000) - 1,
            duration: 250,
            percent_complete: 40,
            full_title: "Synthetic historical playback",
            grandparent_title: null,
            media_type: "movie",
            platform: "tvOS",
            player: "Synthetic TV",
            transcode_decision: "direct_play" as const,
          },
        ]
      : [];
  const history = new PrismaPlaybackHistory(
    f.db,
    mapping.serverMachineId,
    () => clock.now,
    () =>
      Promise.resolve({
        capturedAt: new Date(through),
        expiresAt: new Date(clock.now.getTime() + 60_000),
        inventoryDigest: "synthetic-stopped-history",
      }),
  );
  await history.importHistory(owner, {
    sourceInstanceId,
    serverMachineId: mapping.serverMachineId,
    through,
    rows,
    userBindings: [
      {
        sourceUserId: mapping.serverAccountId,
        userId: f.user.id,
        plexAccountId: f.user.plexAccountId,
      },
    ],
  });
  const checkpoint = await f.db.playbackCollector.findUniqueOrThrow({
    where: { serverMachineId: mapping.serverMachineId },
  });
  if (checkpoint.collectionStartedAt === null)
    await history.sealHandoff(owner, {
      sourceInstanceId,
      through,
      expectedVersion: checkpoint.version,
      expectedSessions: rows.length,
      snapshotDigest: snapshotHash(
        rows.map((row) => ({ id: row.id, sha256: snapshotHash(row) })),
      ),
      quiescenceCapturedAt: through,
      inventoryDigest: "synthetic-stopped-history",
    });

  clock.now = new Date(
    (
      checkpoint.observedAt ??
      checkpoint.collectionStartedAt ??
      PLAYBACK_ORIGIN
    ).getTime() + 1,
  );
  await new PrismaPlaybackCollector(
    f.db,
    { sessions: () => Promise.resolve([]) },
    mapping.serverMachineId,
    () => clock.now,
  ).reconcile();

  return { mapping, claim, clock };
}

async function exerciseExpiredPlayback(
  f: Awaited<ReturnType<typeof fixture>>,
  mode: PlaybackControl,
  expired: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["read"]>>,
  noticeEventId: string,
) {
  const releasedAt = expired.interestReleasedAt;
  if (releasedAt === null)
    throw new Error("Expected automatic release producer evidence");
  if (mode === "manual_drop" || mode === "manual_finished") {
    const elapsedManualDb = queryFixtureDatabase(f.db, {
      query: {
        mediaRequest: {
          async update({ args, query }) {
            if (
              args.where.id === expired.id &&
              (args.data.interestState === "dropped" ||
                args.data.interestState === "finished")
            ) {
              // Original manual command policy clock, preceding the actual native
              // collector samples; no existing session or release is rewritten.
              args.data.interestRenewedAt = releasedAt;
              args.data.interestReleasedAt = releasedAt;
            }
            return query(args);
          },
        },
      },
    });
    await new RequestInterestCommands(elapsedManualDb, {
      keepDays: 30,
    }).execute(f.user, crypto.randomUUID(), {
      schemaVersion: 1,
      requestId: expired.id,
      expectedVersion: expired.version,
      expectedInterestRevision: expired.interestRevision,
      action: mode === "manual_drop" ? "drop" : "finished",
    });
  }
  const { mapping, claim, clock } = await prepareExpiredPlayback(f, mode);
  if (mapping.serverAccountId === null)
    throw new Error("Expected exact playback account");
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.rootId, edition: "default" } },
  });
  const bucket = `renewal:${crypto.randomUUID()}`;
  await queueRetentionCheck(f.transport.context, f.rootId, bucket);
  const operation = await f.db.operation.findUniqueOrThrow({
    where: {
      idempotencyKey: `retention:${f.rootId}:${String(target.generation)}:${bucket}`,
    },
  });
  const retentionInput = z
    .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
    .parse(operation.payload);
  const retention = createRetentionActivities(f.transport.context);
  const before = await retention.evaluateMediaRetention(retentionInput);
  expect(before.status).toBe("warning");
  if (before.decisionId === null)
    throw new Error("Expected genuine Leaving Soon decision");

  await collectExpiredPlayback(f, mode, {
    mapping,
    ratingKey: claim.ratingKey,
    clock,
  });
  // No interest page has run since the collected sample. The final native
  // retention evaluator must protect even after the session stops.
  const pending = await retention.evaluateMediaRetention(retentionInput);
  if (mode === "resumed")
    expect(pending).toMatchObject({
      status: "protected",
      reason: "requester_playback_renewal_pending",
    });
  else {
    expect(pending.status).toBe("warning");
    const beforeSweep = await f.read();
    expect(beforeSweep.interestState).toBe(expectedPlaybackState(mode));
  }
  const stableTarget = await f.db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.rootId, edition: "default" } },
  });
  expect(stableTarget.generation).toBe(target.generation);
  expect(
    await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: before.decisionId },
    }),
  ).toMatchObject({ state: "warning_pending", generation: target.generation });
  if (mode !== "resumed") expect(pending.decisionId).toBe(before.decisionId);
  await f.sweep();
  const renewed = await f.read();
  if (mode === "resumed") {
    expect(renewed).toMatchObject({
      interestState: "following",
      interestReleasedAt: null,
      interestReleaseReason: null,
      interestNoticeEventId: null,
      interestNoticeRevision: null,
      interestNoticeAcceptedAt: null,
      interestNoticeViewedAt: null,
    });
    expect(renewed.interestRevision).toBe(expired.interestRevision + 1);
    expect(renewed.lastMeaningfulProgressAt?.getTime()).toBeGreaterThan(
      expired.interestReleasedAt?.getTime() ?? Infinity,
    );
    const renewedTarget = await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.rootId, edition: "default" } },
    });
    expect(renewedTarget.generation).toBe(target.generation + 1);
    expect(
      await f.db.retentionDecision.findUniqueOrThrow({
        where: { id: before.decisionId },
      }),
    ).toMatchObject({ state: "cancelled" });
    expect(
      await retention.evaluateMediaRetention(retentionInput),
    ).toMatchObject({ status: "obsolete", reason: "intent_obsolete" });
    expect(
      await f.db.$transaction((tx) =>
        noticeAcceptance(tx, renewed, new Date()),
      ),
    ).toBeNull();
    await f.sweep();
    const afterAnotherSweep = await f.read();
    expect(afterAnotherSweep.interestState).toBe("following");
    expect(
      await f.db.applicationEvent.count({
        where: { mediaId: f.rootId, kind: "request_interest_playback_renewed" },
      }),
    ).toBe(1);
  } else {
    expect(renewed.interestState).toBe(expectedPlaybackState(mode));
    expect(
      await f.db.applicationEvent.count({
        where: { mediaId: f.rootId, kind: "request_interest_playback_renewed" },
      }),
    ).toBe(0);
  }
  if (mode === "manual_finished")
    await assertNativeUnwatchCancels(f, {
      decisionId: before.decisionId,
      generation: target.generation,
      retentionInput,
    });
  expect(
    await f.db.applicationEvent.findUniqueOrThrow({
      where: { id: noticeEventId },
    }),
  ).toMatchObject({ kind: "interest_check" });
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.published.entry.assetId },
    }),
  ).toMatchObject({ state: "published", owned: true });
}

async function assertNativeUnwatchCancels(
  f: Awaited<ReturnType<typeof fixture>>,
  input: {
    decisionId: string;
    generation: number;
    retentionInput: {
      operationId: string;
      mediaId: string;
      generation: number;
    };
  },
) {
  // Even a released requester must retain true→false unwatch protection.
  await f.observe(true);
  await f.observe(false);
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.rootId, edition: "default" } },
  });
  expect(target.generation).toBe(input.generation + 1);
  expect(
    await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: input.decisionId },
    }),
  ).toMatchObject({ state: "cancelled" });
  expect(
    await createRetentionActivities(f.transport.context).evaluateMediaRetention(
      input.retentionInput,
    ),
  ).toMatchObject({ status: "obsolete", reason: "intent_obsolete" });
  expect(
    await f.db.applicationEvent.findFirstOrThrow({
      where: { mediaId: f.rootId, kind: "media_marked_unwatched" },
      orderBy: { createdAt: "desc" },
    }),
  ).toMatchObject({ payload: { generation: target.generation } });
}

function expectedPlaybackState(mode: PlaybackControl) {
  return mode === "manual_drop"
    ? "dropped"
    : mode === "manual_finished"
      ? "finished"
      : "expired";
}

async function collectExpiredPlayback(
  f: Awaited<ReturnType<typeof fixture>>,
  mode: PlaybackControl,
  input: {
    mapping: Awaited<ReturnType<typeof prepareExpiredPlayback>>["mapping"];
    ratingKey: string;
    clock: { now: Date };
  },
) {
  const { mapping, ratingKey, clock } = input;
  if (mapping.serverAccountId === null)
    throw new Error("Expected native account mapping");
  let account = mapping.serverAccountId;
  if (mode === "other_user") {
    const other = await f.db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Other native viewer",
      },
    });
    account = crypto.randomUUID();
    await f.db.plexIdentityMapping.create({
      data: {
        ...mapping,
        userId: other.id,
        serverAccountId: account,
        homeUserId: null,
      },
    });
  }
  const session: PlexPlaybackSession = {
    sessionId: crypto.randomUUID(),
    serverAccountId: account,
    ratingKey,
    title: "Synthetic current native playback",
    seriesTitle: null,
    mediaType: "movie",
    platform: "tvOS",
    playerId: crypto.randomUUID(),
    state: "playing",
    durationMs: 3_600_000,
    progressMs: 0,
    decision: "direct_play",
  };
  let sessions = mode === "historical" ? [] : [session];
  const collector = new PrismaPlaybackCollector(
    f.db,
    { sessions: () => Promise.resolve(sessions) },
    mapping.serverMachineId,
    () => clock.now,
  );
  clock.now = new Date(clock.now.getTime() + 1);
  await collector.reconcile();
  for (let sample = 0; sample < 2; sample++) {
    clock.now = new Date(clock.now.getTime() + 60_000);
    session.progressMs += 60_000;
    await collector.reconcile();
  }
  sessions = [];
  clock.now = new Date(clock.now.getTime() + 1);
  await collector.reconcile();
  if (mode !== "historical")
    expect(
      await f.db.playbackSessionIdentity.findUniqueOrThrow({
        where: {
          source_sourceInstanceId_sourceSessionId: {
            source: "plex",
            sourceInstanceId: mapping.serverMachineId,
            sourceSessionId: session.sessionId,
          },
        },
        include: { session: true },
      }),
    ).toMatchObject({
      session: {
        state: "stopped",
        watchedMs: 120_000,
        meaningfulProgressAt: new Date(clock.now.getTime() - 1),
      },
    });
}

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
  const refreshServing = async (watched: boolean) => {
    // Catalog growth changes the complete numbering digest. Obtain a new
    // native binding and watch observation instead of reusing stale authority.
    const queued = await queueExistingPlexBinding(
      transport.context,
      published.entry.assetId,
    );
    if (queued.status !== "queued")
      throw new Error(`Fixture binding refresh protected: ${queued.reason}`);
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: queued.operationId },
    });
    expect(
      await createPlexBindingActivities(transport.context).reverify(
        ReverifyPlexBindingInputSchema.parse(operation.payload),
        transport.context.plexBindingExecution(),
      ),
    ).toEqual({ status: "verified", bindingCount: ids.length });
    await observe(watched);
  };
  const read = () =>
    db.mediaRequest.findUniqueOrThrow({ where: { id: request.id } });
  const facts = async () =>
    db.$transaction(async (tx) =>
      nativeInterestFacts(tx, await read(), new Date()),
    );
  const sweep = async (database = db) => {
    // One production sweep page is intentionally one request. Drain pages so
    // sibling leaf claims cannot hide the root under test.
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const result = await reconcileRequestInterests(database, { cursor });
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
    refreshServing,
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
    const priorProfile = await db.qualityProfileDefault.findUnique({
      where: { kind: "movie" },
    });
    await new PrismaMediaApplication(db, { keepDays: 30 }).setProfileDefault(
      owner,
      crypto.randomUUID(),
      "movie",
      {
        expectedVersion: priorProfile?.version ?? 0,
        profileId: base.profile.id,
      },
    );
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
  expect(await f.facts()).toMatchObject({ watchedComplete: null });
  await f.refreshServing(true);
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
      expect(await f.facts()).toMatchObject({ watchedComplete: null });
      await f.refreshServing(false);
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
  expect(await f.facts()).toMatchObject({ watchedComplete: null });
  await f.refreshServing(true);
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

test.each([
  "fresh",
  "elapsed",
  "renewed",
  "historical",
  "resumed",
  "other_user",
  "manual_drop",
  "manual_finished",
  "pre_expiry",
] as const)(
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
    const playbackControl =
      mode === "resumed" ||
      mode === "historical" ||
      mode === "other_user" ||
      mode === "manual_drop" ||
      mode === "manual_finished" ||
      mode === "pre_expiry";
    const releasedAt = new Date(
      Date.now() - (mode === "pre_expiry" ? 60_000 : DAY),
    );
    const policyDb = queryFixtureDatabase(f.db, {
      query: {
        mediaRequest: {
          async update({ args, query }) {
            // Elapsed policy time at the ORIGINAL release producer, not a
            // fabricated session/projection or a rewritten existing release.
            if (
              playbackControl &&
              args.where.id === f.request.id &&
              args.data.interestState === "expired"
            )
              args.data.interestReleasedAt = releasedAt;
            return query(args);
          },
        },
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
    await f.sweep(policyDb);
    expect(await f.read()).toMatchObject({
      interestState:
        mode === "elapsed" || playbackControl ? "expired" : "following",
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
    if (playbackControl) {
      const expired = await f.read();
      await exerciseExpiredPlayback(f, mode, expired, delivery.eventId);
    }
  },
  60_000,
);
