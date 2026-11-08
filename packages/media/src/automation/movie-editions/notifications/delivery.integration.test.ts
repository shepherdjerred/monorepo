import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { moviePlexV4Fixture } from "#testing/movie-plex-v4.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { publishMoviePlexV4 } from "#automation/movie-editions/plex-publication.ts";
import { finalizeMovieAcquisitionV4 } from "#automation/movie-editions/finalization.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import {
  MovieEditionKeySchema,
  movieEditionDisplayLabel,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";

const h = automationTestHarness();
const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0)) await close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function enableMail(userId: string) {
  await h.database().mediaUser.update({
    where: { id: userId },
    data: { email: `${userId}@example.com`, emailVerifiedAt: new Date() },
  });
  await h.database().notificationPreference.upsert({
    where: { userId },
    create: { userId, emailEnabled: true, upgrades: true },
    update: { emailEnabled: true, upgrades: true },
  });
}

async function fixture(edition: MovieEditionKey = "directors_cut") {
  const f = await moviePlexV4Fixture(
    h.database(),
    h.context(),
    await h.fixture(),
    { edition, bytes },
  );
  directories.push(f.files.directory);
  await enableMail(f.result.subjectUserId);
  expect(
    await publishMoviePlexV4(f.network, f.input, testPlexBindingExecution()),
  ).toEqual({ status: "available", reason: null });
  const page = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === `/media/${f.media.id}`
        ? new Response("Synthetic Media detail route", { status: 200 })
        : new Response(null, { status: 404 }),
  });
  closers.push(async () => {
    await page.stop(true);
  });
  const sent: Parameters<MediaAutomationContext["notify"]>[0][] = [];
  const context: MediaAutomationContext = {
    ...f.network,
    publicOrigin: page.url.origin,
    notify: (message, mutation) => {
      mutation?.beforeMutation();
      sent.push(message);
      return Promise.resolve({
        receipt: `synthetic:${message.idempotencyKey}`,
      });
    },
  };
  return {
    ...f,
    context,
    sent,
    finalize: () =>
      finalizeMovieAcquisitionV4(context, f.input, testPlexBindingExecution()),
  };
}

async function delivery(
  f: Awaited<ReturnType<typeof fixture>>,
  userId = f.result.subjectUserId,
) {
  return h.database().notificationDelivery.findFirstOrThrow({
    where: {
      userId,
      channel: "email",
      event: {
        mediaId: f.media.id,
        payload: { path: ["kind"], equals: "movie_publication" },
      },
    },
    include: { event: true },
  });
}

async function deliver(
  activities: ReturnType<typeof createNotificationActivities>,
  notificationId: string,
) {
  const operation = await h.database().operation.findFirstOrThrow({
    where: { kind: "deliver_notification", targetId: notificationId },
  });
  const input = z
    .object({
      operationId: z.uuid(),
      notificationId: z.uuid(),
      kind: z.literal("deliver_notification"),
    })
    .parse(operation.payload);
  expect(input).toMatchObject({ operationId: operation.id, notificationId });
  return activities.deliverMediaNotification({
    operationId: input.operationId,
    notificationId: input.notificationId,
  });
}

test.each(MovieEditionKeySchema.options)(
  "actual %s finalization delivers its exact-cut email and retains the accepted retry",
  async (edition) => {
    const f = await fixture(edition);
    await f.finalize();
    const notice = await delivery(f);
    const activities = createNotificationActivities(f.context);
    expect(await deliver(activities, notice.id)).toEqual({
      status: "accepted",
      reason: null,
    });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({
      channel: "email",
      recipient: `${f.result.subjectUserId}@example.com`,
    });
    expect(f.sent[0]?.subject).toContain(movieEditionDisplayLabel(edition));
    expect(f.sent[0]?.text).toContain(movieEditionDisplayLabel(edition));
    const target = new URL(
      `/media/${f.media.id}`,
      f.context.publicOrigin,
    ).toString();
    expect(f.sent[0]?.text).toContain(target);
    const response = await fetch(target);
    expect(response.status).toBe(200);
    await expect(
      h.database().applicationEvent.update({
        where: { id: notice.eventId },
        data: { payload: {} },
      }),
    ).rejects.toThrow("Movie notification source is immutable");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
    await h.database().mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "observe", ownershipConfirmed: false },
    });
    f.context.permittedSections = () =>
      Promise.reject(
        new Error("Accepted retry must not resolve current configuration"),
      );
    expect(await deliver(activities, notice.id)).toEqual({
      status: "accepted",
      reason: null,
    });
    expect(f.sent).toHaveLength(1);
  },
);

test("publication fanout includes same-cut requesters and excludes another cut", async () => {
  const f = await fixture();
  const same = await h.fixture();
  const other = await h.fixture();
  await enableMail(same.user.id);
  await enableMail(other.user.id);
  await requestTestMovieV4(
    h.database(),
    { ...same.user, role: "member" },
    f.media.id,
    "directors_cut",
  );
  await requestTestMovieV4(
    h.database(),
    { ...other.user, role: "member" },
    f.media.id,
    "theatrical_cut",
  );
  await f.finalize();
  const notices = await h.database().notificationDelivery.findMany({
    where: {
      event: {
        mediaId: f.media.id,
        payload: { path: ["kind"], equals: "movie_publication" },
      },
    },
  });
  expect(notices.map((notice) => notice.userId).sort()).toEqual(
    [f.result.subjectUserId, same.user.id].sort(),
  );
  for (const notice of notices)
    expect(
      await deliver(createNotificationActivities(f.context), notice.id),
    ).toEqual({ status: "accepted", reason: null });
  expect(f.sent.map((message) => message.recipient).sort()).toEqual(
    [
      `${f.result.subjectUserId}@example.com`,
      `${same.user.id}@example.com`,
    ].sort(),
  );
  const first = notices[0];
  if (first === undefined) throw new Error("Expected actual source delivery");
  await expect(
    h.database().notificationDelivery.update({
      where: { id: first.id },
      data: { userId: other.user.id },
    }),
  ).rejects.toThrow("Movie notification recipient and source are immutable");
});

test("cancelling the actual edition request between claim and send prevents mail", async () => {
  const f = await fixture();
  await f.finalize();
  const notice = await delivery(f);
  const activities = createNotificationActivities({
    ...f.context,
    checkpoint: async () => {
      const user = await h
        .database()
        .mediaUser.findUniqueOrThrow({ where: { id: f.result.subjectUserId } });
      const request = await h
        .database()
        .mediaRequest.findUniqueOrThrow({ where: { id: f.result.requestId } });
      const target = await h.database().mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: {
            mediaId: f.media.id,
            edition: f.input.scope.edition,
          },
        },
      });
      await f.commands.cancelMovieEditionRequest(
        { ...user, role: "member" },
        crypto.randomUUID(),
        {
          schemaVersion: 3,
          action: "cancel_request",
          subjectUserId: user.id,
          scope: f.input.scope,
          requestId: request.id,
          expected: {
            targetVersion: target.version,
            requestVersion: request.version,
            choiceRevision: request.movieEditionChoiceRevision,
          },
        },
      );
    },
  });
  expect(await deliver(activities, notice.id)).toEqual({
    status: "failed",
    reason: "authority_changed_before_send",
  });
  expect(f.sent).toEqual([]);
});

test("renewing a writer lease after claim cannot extend the original notice deadline", async () => {
  const f = await fixture();
  await f.finalize();
  const notice = await delivery(f);
  const expiry = Date.now() + 1000;
  await h.database().legacyWriterLease.update({
    where: { id: "singleton" },
    data: { expiresAt: new Date(expiry) },
  });
  const activities = createNotificationActivities({
    ...f.context,
    checkpoint: async () => {
      vi.spyOn(Date, "now").mockReturnValue(expiry + 1);
      await h.database().legacyWriterLease.update({
        where: { id: "singleton" },
        data: {
          observedAt: new Date(expiry + 1),
          expiresAt: new Date(expiry + 90_000),
        },
      });
    },
  });
  expect(await deliver(activities, notice.id)).toEqual({
    status: "failed",
    reason: "authority_changed_before_send",
  });
  expect(f.sent).toEqual([]);
});

test("a changed configured movie section after claim prevents mail", async () => {
  const f = await fixture();
  await f.finalize();
  const notice = await delivery(f);
  const activities = createNotificationActivities({
    ...f.context,
    checkpoint: () => {
      f.context.permittedSections = () =>
        Promise.resolve({ movie: "2", series: "2" });
      return Promise.resolve();
    },
    permittedSections: () => f.context.permittedSections(),
  });
  expect(await deliver(activities, notice.id)).toEqual({
    status: "failed",
    reason: "authority_changed_before_send",
  });
  expect(f.sent).toEqual([]);
});

test("renewing a Plex identity mapping cannot extend the original notice deadline", async () => {
  const f = await fixture();
  await f.finalize();
  const notice = await delivery(f);
  const expiry = Date.now() + 30_000;
  await h.database().plexIdentityMapping.updateMany({
    where: { userId: f.result.subjectUserId },
    data: { verifiedAt: new Date(expiry - 300_000) },
  });
  const activities = createNotificationActivities({
    ...f.context,
    checkpoint: async () => {
      vi.spyOn(Date, "now").mockReturnValue(expiry + 1);
      await h.database().plexIdentityMapping.updateMany({
        where: { userId: f.result.subjectUserId },
        data: { verifiedAt: new Date(expiry + 1) },
      });
    },
  });
  expect(await deliver(activities, notice.id)).toEqual({
    status: "failed",
    reason: "authority_changed_before_send",
  });
  expect(f.sent).toEqual([]);
});

test("an exhausted original invocation prevents claiming a new notice", async () => {
  const f = await fixture();
  await f.finalize();
  const notice = await delivery(f);
  const execution = testPlexBindingExecution();
  f.context.plexBindingExecution = () => ({
    ...execution,
    observed: {
      wall: execution.observed.wall - 60_001,
      monotonic: execution.observed.monotonic - 60_001,
    },
    expiresAtMs: execution.expiresAtMs - 60_001,
  });
  expect(
    await deliver(createNotificationActivities(f.context), notice.id),
  ).toEqual({ status: "failed", reason: "verification_expired" });
  expect(f.sent).toEqual([]);
  expect(
    await h
      .database()
      .notificationDeliveryAttempt.count({ where: { deliveryId: notice.id } }),
  ).toBe(0);
});

test("an unknown provider outcome reconciles the original notice without resending", async () => {
  const f = await fixture();
  await f.finalize();
  const notice = await delivery(f);
  f.context.notify = (message, mutation) => {
    mutation?.beforeMutation();
    f.sent.push(message);
    return Promise.reject(new Error("Synthetic lost provider response"));
  };
  const activities = createNotificationActivities(f.context);
  expect(await deliver(activities, notice.id)).toEqual({
    status: "unknown",
    reason: "delivery_outcome_unknown",
  });
  f.context.permittedSections = () =>
    Promise.reject(
      new Error("Unknown outcome must not authorize another send"),
    );
  expect(await deliver(activities, notice.id)).toEqual({
    status: "unknown",
    reason: "delivery_receipt_required",
  });
  expect(f.sent).toHaveLength(1);
});
