import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { moviePlexV4Fixture } from "#testing/movie-plex-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { publishMoviePlexV4 } from "#automation/movie-editions/plex-publication.ts";
import { finalizeMovieAcquisitionV4 } from "#automation/movie-editions/finalization.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { installMovieSubtitlesV4 } from "#automation/files/movie-editions/subtitles.ts";
import { findMovieSubtitlesV4 } from "#automation/movie-editions/subtitles/network.ts";
import { queueMovieSubtitleTargetsV4 } from "#automation/movie-editions/subtitles/queue.ts";
import { queueReadyMovieCaptionNoticesV4 } from "./captions.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import { MovieCaptionNoticeV4Schema } from "#shared/movie-editions/notifications-v4.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { NotificationContext } from "#automation/notifications/types.ts";
import {
  MovieEditionKeySchema,
  movieEditionDisplayLabel,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";

const h = automationTestHarness();
const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];
const access = { serverMachineId: "fixture-server", movieSectionId: "1" };
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

async function fixture(edition: MovieEditionKey = "directors_cut") {
  const f = await moviePlexV4Fixture(
    h.database(),
    h.context(),
    await h.fixture(),
    { edition, bytes },
  );
  directories.push(f.files.directory);
  await h.database().mediaUser.update({
    where: { id: f.result.subjectUserId },
    data: {
      email: `${f.result.subjectUserId}@example.com`,
      emailVerifiedAt: new Date(),
    },
  });
  await h.database().notificationPreference.upsert({
    where: { userId: f.result.subjectUserId },
    update: { emailEnabled: true },
    create: { userId: f.result.subjectUserId, emailEnabled: true },
  });
  const page = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === `/media/${f.media.id}`
        ? new Response("Synthetic detail page", { status: 200 })
        : new Response(null, { status: 404 }),
  });
  closers.push(async () => {
    await page.stop(true);
  });
  const sent: Parameters<MediaAutomationContext["notify"]>[0][] = [];
  const context: MediaAutomationContext &
    Pick<NotificationContext, "checkpoint"> = {
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
  const publish = async () => {
    expect(
      await publishMoviePlexV4(context, f.input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await finalizeMovieAcquisitionV4(
      context,
      f.input,
      testPlexBindingExecution(),
    );
  };
  const notices = () =>
    h.database().notificationDelivery.findMany({
      where: {
        event: {
          mediaId: f.media.id,
          payload: { path: ["kind"], equals: "movie_subtitles" },
        },
      },
      include: { event: true },
    });
  const install = async () => {
    await h.database().$transaction((tx) =>
      queueMovieSubtitleTargetsV4(tx, {
        scope: f.input.scope,
        assetId: f.asset.id,
        epoch: 0,
        access,
      }),
    );
    const operations = await h.database().operation.findMany({
      where: { kind: "acquire_movie_subtitles_v4", targetId: f.asset.id },
      orderBy: { id: "asc" },
    });
    expect(operations).toHaveLength(2);
    let installed = 0;
    for (const row of operations) {
      const target = MovieSubtitleOperationV4Schema.parse(
        z.object(MovieSubtitleOperationV4Schema.shape).parse(row.payload),
      );
      const found = await findMovieSubtitlesV4(context, target, {});
      expect(found.status).toBe("found");
      await installMovieSubtitlesV4(f.files.context, {
        schemaVersion: 4,
        operationId: target.operationId,
        scope: f.input.scope,
        assetId: f.asset.id,
        subtitleId: z.uuid().parse(found.subtitleId),
      });
      installed++;
      if (installed === 1) expect(await notices()).toHaveLength(0);
    }
  };
  const deliver = async () => {
    const [notice] = await notices();
    if (notice === undefined)
      throw new Error("Actual caption delivery missing");
    const operation = await h.database().operation.findFirstOrThrow({
      where: { kind: "deliver_notification", targetId: notice.id },
    });
    return createNotificationActivities(context).deliverMediaNotification({
      operationId: operation.id,
      notificationId: notice.id,
    });
  };
  return { ...f, context, sent, publish, install, notices, deliver };
}

test.each(MovieEditionKeySchema.options)(
  "%s notifies once after all actual caption installations and preserves the accepted acknowledgement",
  async (edition) => {
    const f = await fixture(edition);
    await f.publish();
    await f.install();
    expect(await f.notices()).toHaveLength(1);
    await h.database().$transaction(async (tx) => {
      const result = await queueReadyMovieCaptionNoticesV4(
        tx,
        { scope: f.input.scope, assetId: f.asset.id, epoch: 0, access },
        new PublicationAuthorityReadBudget(),
      );
      for (const guard of result.guards) guard.assertActive();
    });
    expect(await f.notices()).toHaveLength(1);
    expect(await f.deliver()).toEqual({ status: "accepted", reason: null });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]?.text).toContain(
      `${movieEditionDisplayLabel(edition)}) has requested subtitles ready`,
    );
    const response = await fetch(
      new URL(`/media/${f.media.id}`, f.context.publicOrigin),
    );
    expect(response.status).toBe(200);
    const [notice] = await f.notices();
    if (notice === undefined) throw new Error("Actual caption event missing");
    const payload = MovieCaptionNoticeV4Schema.parse(notice.event.payload);
    expect(payload.source.assetId).toBe(f.asset.id);
    await expect(
      h.database().applicationEvent.update({
        where: { id: notice.eventId },
        data: { actorId: crypto.randomUUID() },
      }),
    ).rejects.toThrow("immutable");
    await h.database().mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "observe", ownershipConfirmed: false },
    });
    f.context.permittedSections = () =>
      Promise.reject(
        new Error("Completed notice must not resolve configuration"),
      );
    expect(await f.deliver()).toEqual({ status: "accepted", reason: null });
    expect(f.sent).toHaveLength(1);
  },
);

test("captions installed before Plex publication defer mail and are queued by actual finalization", async () => {
  const f = await fixture();
  await f.install();
  expect(await f.notices()).toHaveLength(0);
  await f.publish();
  expect(await f.notices()).toHaveLength(1);
  expect(await f.deliver()).toEqual({ status: "accepted", reason: null });
});

test("a newly required forced caption between claim and send prevents a stale readiness notice", async () => {
  const f = await fixture();
  await f.publish();
  await f.install();
  f.context.checkpoint = async () => {
    await h.database().mediaSubtitlePolicyVersion.create({
      data: {
        mediaId: f.media.id,
        actorId: f.result.subjectUserId,
        edition: f.input.scope.edition,
        version: 0,
        recoveryEpoch: 0,
        source: { fixture: true },
        rules: {
          schemaVersion: 1,
          protectedReasons: [],
          targets: [
            {
              sourceItemId: 1,
              language: "en",
              forced: true,
              hearingImpaired: "any",
              audio: "any",
              audioLanguage: "en",
            },
          ],
        },
      },
    });
  };
  expect(await f.deliver()).toEqual({
    status: "failed",
    reason: "authority_changed_before_send",
  });
  expect(f.sent).toEqual([]);
});

test("cancelling the exact caption request between claim and send prevents mail", async () => {
  const f = await fixture();
  await f.publish();
  await f.install();
  f.context.checkpoint = async () => {
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
    await f.commands.cancelMovieEditionRequest(user, crypto.randomUUID(), {
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
    });
  };
  expect(await f.deliver()).toEqual({
    status: "failed",
    reason: "authority_changed_before_send",
  });
  expect(f.sent).toEqual([]);
});
