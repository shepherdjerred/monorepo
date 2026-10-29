import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { expect, test } from "vitest";
import { IntegrationError } from "#integrations/http.ts";
import { createAcquisitionActivities } from "./acquisition.ts";
import { automationTestHarness } from "#testing/automation.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { retentionPlexContext } from "#automation/retention/fixtures/plex.ts";
import { createMediaFileActivities } from "./files/activities.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { createPublicationActivities } from "./publication.ts";
import { createOutboxActivities } from "./store.ts";
import { rm } from "node:fs/promises";
import { grantTestRequesterAccess } from "#testing/authority.ts";
const { database, context, fixture, cipher } = automationTestHarness();

test("Retry after committed promotion adopts the coordinator and verifies Plex without republishing", async () => {
  const f = await mappedPublicationFixture(database());
  try {
    const p = await f.published();
    const before = await database().libraryAsset.findUniqueOrThrow({
      where: { id: p.entry.assetId },
    });
    const plan = await database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: p.attempt.id },
    });
    await database().qualityProfileVersion.create({
      data: {
        profileId: f.profile.id,
        version: f.profile.version,
        rules: QualityRulesSchema.parse(f.profile.rules),
      },
    });
    await database().operation.update({
      where: { id: p.attempt.operationId },
      data: { status: "running" },
    });
    await createOutboxActivities(database(), async () => {
      throw new Error("Unexpected dispatch");
    }).finishMediaOperation({
      operationId: p.attempt.operationId,
      status: "reconciling",
      reason: "acquisition_failed",
    });
    await database().acquisitionReservation.create({
      data: { mediaId: f.media.id, attemptId: p.attempt.id, generation: 0 },
    });
    const item = await database().mediaItem.findUniqueOrThrow({
      where: { id: f.media.id },
    });
    await grantTestRequesterAccess(database(), f.user.id, "fixture-server");
    const retry = await new PrismaMediaCommands(database(), {
      keepDays: 30,
      serverMachineId: "fixture-server",
    }).act(f.user, crypto.randomUUID(), f.media.id, {
      action: "retry",
      expectedVersion: item.version,
    });
    if (retry.operationId === undefined)
      throw new Error("Retry operation missing");
    const intent = await database().mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.media.id)),
    });
    const { context: ctx } = await retentionPlexContext(database(), context(), [
      f.media.id,
    ]);
    const acquisition = createAcquisitionActivities(ctx);
    expect(
      await acquisition.reconcileMediaIntent({
        operationId: retry.operationId,
        mediaId: f.media.id,
        generation: intent.generation,
      }),
    ).toMatchObject({ status: "acquire", attemptId: p.attempt.id });
    const input = { operationId: retry.operationId, attemptId: p.attempt.id };
    expect(await acquisition.submitMediaTorrent(input)).toMatchObject({
      status: "submitted",
      reason: "resume_committed_publication",
    });
    expect(await acquisition.observeMediaAcquisition(input)).toMatchObject({
      status: "ready",
      reason: "resume_committed_publication",
    });
    const files = createMediaFileActivities(f.context);
    expect(await files.inspectAndStageMedia(input)).toEqual({
      status: "staged",
    });
    expect(await files.promoteMediaFiles(input)).toEqual({
      status: "published",
    });
    expect(
      await database().libraryAsset.findUnique({ where: { id: before.id } }),
    ).toMatchObject({
      version: before.version,
      checksum: before.checksum,
      state: "published",
    });
    expect(
      await database().acquisitionAttempt.findUnique({
        where: { id: p.attempt.id },
      }),
    ).toMatchObject({
      filePlan: plan.filePlan,
      state: "imported",
      coordinatorOperationId: retry.operationId,
    });
    const publication = createPublicationActivities(ctx);
    expect(await publication.publishMediaToPlex(input)).toEqual({
      status: "available",
      reason: null,
    });
    await publication.finalizeMediaAcquisition(input);
    expect(
      await database().mediaItem.findUnique({ where: { id: f.media.id } }),
    ).toMatchObject({ availability: "available" });
    expect(
      await database().acquisitionAttempt.findUnique({
        where: { id: p.attempt.id },
      }),
    ).toMatchObject({ state: "completed" });
    expect(
      await database().acquisitionReservation.count({
        where: { attemptId: p.attempt.id },
      }),
    ).toBe(0);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
test("concurrent acquisitions reserve a media item exactly once", async () => {
  const data = await fixture();
  const second = await database().operation.create({
    data: {
      kind: "acquire_release",
      payload: { releaseId: data.release.id },
    },
  });
  const activities = createAcquisitionActivities(context());
  const results = await Promise.all([
    activities.reconcileMediaIntent(data.input),
    activities.reconcileMediaIntent({
      ...data.input,
      operationId: second.id,
    }),
  ]);
  expect(results.filter((result) => result.status === "acquire")).toHaveLength(
    1,
  );
  expect(
    await database().acquisitionReservation.count({
      where: { mediaId: data.media.id, edition: "default" },
    }),
  ).toBe(1);
  expect(
    await database().acquisitionAttempt.count({
      where: { mediaIds: { has: data.media.id } },
    }),
  ).toBe(1);
});

test("a lost torrent submission response is never blindly resubmitted", async () => {
  const data = await fixture();
  let submissions = 0;
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", {
        headers: { "set-cookie": "SID=fixture; HttpOnly" },
      });
    if (url.pathname.endsWith("/torrents/info")) return Response.json([]);
    if (url.pathname.endsWith("/torrents/add")) {
      submissions++;
      throw new Error("Response lost");
    }
    throw new Error("Unexpected request");
  });
  const activities = createAcquisitionActivities(ctx);
  const reserved = await activities.reconcileMediaIntent(data.input);
  if (reserved.attemptId === null) throw new Error("Attempt missing");
  const input = {
    operationId: data.input.operationId,
    attemptId: reserved.attemptId,
  };
  expect(await activities.submitMediaTorrent(input)).toMatchObject({
    status: "blocked",
    reason: "outcome-unknown",
  });
  expect(await activities.submitMediaTorrent(input)).toMatchObject({
    status: "blocked",
    reason: "submission_outcome_unknown",
  });
  expect(submissions).toBe(1);
});

test("request generation adoption keeps the original reservation and torrent identity", async () => {
  const data = await fixture();
  const activities = createAcquisitionActivities(context());
  const first = await activities.reconcileMediaIntent(data.input);
  await database().mediaIntent.update({
    where: targetWhere(defaultScope(data.media.id)),
    data: { generation: 2 },
  });
  const joining = await database().operation.create({
    data: { kind: "reconcile_media", payload: {} },
  });
  const second = await activities.reconcileMediaIntent({
    ...data.input,
    generation: 2,
    operationId: joining.id,
  });
  expect(second).toMatchObject({
    status: "waiting",
    reason: "existing_acquisition",
  });
  const reservation = await database().acquisitionReservation.findUniqueOrThrow(
    {
      where: targetWhere(defaultScope(data.media.id)),
    },
  );
  expect(reservation).toMatchObject({
    attemptId: first.attemptId,
    generation: 2,
  });
});

test("retrying a committed reservation after a lost Activity response resumes the same attempt", async () => {
  const data = await fixture();
  const activities = createAcquisitionActivities(context());
  const first = await activities.reconcileMediaIntent(data.input);
  const retried = await activities.reconcileMediaIntent(data.input);
  expect(retried).toMatchObject({
    status: "acquire",
    attemptId: first.attemptId,
    reason: "resume_existing_acquisition",
  });
  expect(
    await database().acquisitionAttempt.count({
      where: { mediaIds: { has: data.media.id } },
    }),
  ).toBe(1);
});

test("only one new coordinator can resume a blocked acquisition", async () => {
  const data = await fixture();
  const activities = createAcquisitionActivities(context());
  await activities.reconcileMediaIntent(data.input);
  await database().operation.update({
    where: { id: data.input.operationId },
    data: { status: "reconciling" },
  });
  const first = await database().operation.create({
    data: { kind: "reconcile_media", payload: {} },
  });
  const second = await database().operation.create({
    data: { kind: "reconcile_media", payload: {} },
  });
  const results = await Promise.all([
    activities.reconcileMediaIntent({ ...data.input, operationId: first.id }),
    activities.reconcileMediaIntent({
      ...data.input,
      operationId: second.id,
    }),
  ]);
  expect(results.filter((result) => result.status === "acquire")).toHaveLength(
    1,
  );
  expect(results.filter((result) => result.status === "waiting")).toHaveLength(
    1,
  );
});

test("subtitle providers are never queried by torrent discovery", async () => {
  const data = await fixture();
  await database().mediaProvider.upsert({
    where: { id: "opensubtitles" },
    create: { id: "opensubtitles", enabled: true },
    update: { enabled: true },
  });
  await database().operation.update({
    where: { id: data.input.operationId },
    data: { payload: {} },
  });
  const queried: string[] = [];
  const ctx = context();
  ctx.providers = {
    withProvider: async (providerId, work) => {
      queried.push(providerId);
      return work({ search: async () => [] });
    },
  };
  await createAcquisitionActivities(ctx).reconcileMediaIntent(data.input);
  expect(queried).toContain("knaben");
  expect(queried).not.toContain("opensubtitles");
});

test("private provider throttling before torrent download leaves a safely retryable reservation", async () => {
  const data = await fixture();
  const source = {
    ...data.source,
    providerId: "privatehd",
    download: {
      kind: "torrent",
      value: "https://privatehd.fixture/download/private",
    },
  };
  await database().releaseCandidate.update({
    where: { id: data.release.id },
    data: {
      providerId: source.providerId,
      encryptedSource: cipher.encrypt(
        JSON.stringify(source),
        `release:${source.providerId}:${source.providerReleaseId}`,
      ),
    },
  });
  let mutations = 0;
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", {
        headers: { "set-cookie": "SID=fixture" },
      });
    if (url.pathname.endsWith("/torrents/info")) return Response.json([]);
    mutations++;
    throw new Error("Unexpected qBittorrent mutation");
  });
  ctx.providers = {
    withProvider: async () => {
      throw new IntegrationError("privatehd", "rate-limited", 429, 60);
    },
  };
  const activities = createAcquisitionActivities(ctx);
  const reserved = await activities.reconcileMediaIntent(data.input);
  if (reserved.attemptId === null) throw new Error("Attempt missing");
  expect(
    await activities.submitMediaTorrent({
      operationId: data.input.operationId,
      attemptId: reserved.attemptId,
    }),
  ).toMatchObject({ status: "waiting", reason: "rate-limited" });
  expect(
    await database().acquisitionAttempt.findUnique({
      where: { id: reserved.attemptId },
    }),
  ).toMatchObject({ state: "reserved" });
  expect(mutations).toBe(0);
});

test("last requester cancellation settles an unsubmitted reservation without calling qBittorrent", async () => {
  const data = await fixture();
  const activities = createAcquisitionActivities(context());
  const reserved = await activities.reconcileMediaIntent(data.input);
  if (reserved.attemptId === null) throw new Error("Attempt missing");
  const request = await database().mediaRequest.findFirstOrThrow({
    where: { mediaId: data.media.id, userId: data.user.id },
  });
  await new PrismaMediaCommands(database(), { keepDays: 30 }).cancelRequest(
    { ...data.user, role: "member" },
    crypto.randomUUID(),
    request.id,
    request.version,
  );
  expect(
    await activities.submitMediaTorrent({
      operationId: data.input.operationId,
      attemptId: reserved.attemptId,
    }),
  ).toMatchObject({ status: "obsolete" });
  expect(
    await database().acquisitionReservation.count({
      where: { mediaId: data.media.id },
    }),
  ).toBe(0);
  expect(
    await database().acquisitionAttempt.findUnique({
      where: { id: reserved.attemptId },
    }),
  ).toMatchObject({ state: "cancelled" });
});

test("restore epoch invalidates a previously active attempt before external submission", async () => {
  const data = await fixture();
  const activities = createAcquisitionActivities(context());
  const first = await activities.reconcileMediaIntent(data.input);
  if (first.attemptId === null) throw new Error("Attempt missing");
  await database().mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  expect(
    await activities.submitMediaTorrent({
      operationId: data.input.operationId,
      attemptId: first.attemptId,
    }),
  ).toMatchObject({ status: "obsolete" });
});
