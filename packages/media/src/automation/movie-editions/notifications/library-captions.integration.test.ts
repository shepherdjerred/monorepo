import { afterEach, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { libraryBindingFixture } from "#automation/plex-binding/library.test-fixture.ts";
import { verifyLibraryPlexBinding } from "#automation/plex-binding/library.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import {
  MovieEditionKeySchema,
  movieEditionDisplayLabel,
} from "#shared/movie-editions/registry.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import { MovieCaptionNoticeV4Schema } from "#shared/movie-editions/notifications-v4.ts";
import { queueMovieSubtitleTargetsV4 } from "#automation/movie-editions/subtitles/queue.ts";
import { findMovieSubtitlesV4 } from "#automation/movie-editions/subtitles/network.ts";
import { installMovieSubtitlesV4 } from "#automation/files/movie-editions/subtitles.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { readMovieSubtitleReceiptV4 } from "#infrastructure/movie-editions/subtitle-receipt.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { captionProviderFixture } from "./caption-provider.test-fixture.ts";

const h = automationTestHarness();
const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];
const downloadOperations: string[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
  const operations = downloadOperations.splice(0);
  if (operations.length > 0)
    await h.database().applicationEvent.deleteMany({
      where: {
        kind: "subtitle_download_requested",
        OR: operations.map((operationId) => ({
          payload: { path: ["operationId"], equals: operationId },
        })),
      },
    });
});

test.each(MovieEditionKeySchema.options)(
  "an adopted %s movie notifies its real requester without constructing an acquisition history",
  async (edition) => {
    const db = h.database();
    const f = await libraryBindingFixture(
      db,
      edition,
      (directory) => {
        directories.push(directory);
      },
      { bytes },
    );
    const scope = {
      mediaId: f.network.media.id,
      rootMediaId: f.network.media.id,
      edition,
    };
    const requester = await h.fixture();
    const request = await requestTestMovieV4(
      db,
      requester.user,
      scope.mediaId,
      edition,
    );
    await db.mediaUser.update({
      where: { id: request.result.subjectUserId },
      data: { email: "synthetic@example.com", emailVerifiedAt: new Date() },
    });
    await db.notificationPreference.upsert({
      where: { userId: request.result.subjectUserId },
      create: { userId: request.result.subjectUserId, emailEnabled: true },
      update: { emailEnabled: true },
    });
    const bindingOperation = await db.operation.findUniqueOrThrow({
      where: { idempotencyKey: `library-plex:${f.receiptId}:${f.asset.id}:0` },
    });
    const verify = async () => {
      expect(
        await verifyLibraryPlexBinding(
          f.context,
          LibraryPlexBindingInputV1Schema.parse(bindingOperation.payload),
          testPlexBindingExecution(),
        ),
      ).toEqual({ status: "verified", bindingCount: 1 });
    };
    // Exercise both completion orders against the real adoption/report and installed-caption producers.
    const captionsFirst =
      edition !== "default" &&
      edition !== "extended_cut" &&
      edition !== "final_cut";
    if (!captionsFirst) await verify();
    await db.$transaction((tx) =>
      queueMovieSubtitleTargetsV4(tx, {
        scope,
        assetId: f.asset.id,
        epoch: 0,
        access: { serverMachineId: "fixture-server", movieSectionId: "1" },
      }),
    );
    const rows = await db.operation.findMany({
      where: { kind: "acquire_movie_subtitles_v4", targetId: f.asset.id },
      orderBy: { id: "asc" },
    });
    expect(rows).toHaveLength(2);
    downloadOperations.push(...rows.map((row) => row.id));
    const sources = await captionProviderFixture(f.context);
    for (const row of rows) {
      const target = MovieSubtitleOperationV4Schema.parse(
        z.object(MovieSubtitleOperationV4Schema.shape).parse(row.payload),
      );
      await db.providerLease.deleteMany({
        where: { providerId: "opensubtitles" },
      });
      const found = await findMovieSubtitlesV4(f.context, target, sources);
      expect(found).toMatchObject({ status: "found", reason: null });
      const input = {
        schemaVersion: 4 as const,
        operationId: row.id,
        scope,
        assetId: f.asset.id,
        subtitleId: z.uuid().parse(found.subtitleId),
      };
      await installMovieSubtitlesV4(f.files, input);
      expect(
        await readMovieSubtitleReceiptV4(
          db,
          input,
          new PublicationAuthorityReadBudget(),
        ),
      ).toMatchObject({
        publication: {
          kind: "movie_library_adoption_v2",
          receiptId: f.receiptId,
        },
      });
    }
    const notices = () =>
      db.notificationDelivery.findMany({
        where: {
          event: {
            mediaId: scope.mediaId,
            payload: { path: ["kind"], equals: "movie_subtitles" },
          },
        },
        include: { event: true },
      });
    if (captionsFirst) {
      expect(await notices()).toHaveLength(0);
      await verify();
    }
    const [notice] = await notices();
    expect(await notices()).toHaveLength(1);
    if (notice === undefined)
      throw new Error("Actual library caption delivery missing");
    const payload = MovieCaptionNoticeV4Schema.parse(notice.event.payload);
    expect(payload.request.id).toBe(request.result.requestId);
    expect(
      await db.acquisitionAttempt.count({
        where: { mediaIds: { has: scope.mediaId } },
      }),
    ).toBe(0);
    expect(await db.torrent.count()).toBe(0);
    const page = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("Synthetic library detail", { status: 200 }),
    });
    closers.push(async () => {
      await page.stop(true);
    });
    const sent: string[] = [];
    const operation = await db.operation.findFirstOrThrow({
      where: { kind: "deliver_notification", targetId: notice.id },
    });
    expect(
      await createNotificationActivities({
        ...f.context,
        publicOrigin: page.url.origin,
        notify: (message, mutation) => {
          mutation?.beforeMutation();
          sent.push(message.text);
          return Promise.resolve({ receipt: "synthetic-library-caption" });
        },
      }).deliverMediaNotification({
        operationId: operation.id,
        notificationId: notice.id,
      }),
    ).toEqual({ status: "accepted", reason: null });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(
      `${movieEditionDisplayLabel(edition)}) has requested subtitles ready`,
    );
    const response = await fetch(new URL(`/media/${scope.mediaId}`, page.url));
    expect(response.status).toBe(200);
  },
);
