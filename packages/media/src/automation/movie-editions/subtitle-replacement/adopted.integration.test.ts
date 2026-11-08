import { afterEach, beforeAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createAdoptedMovieReplacementFixture } from "#testing/movie-workflow/subtitles/adopted-replacement-fixture.ts";
import { MovieReplacementReceiptV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { MovieReplacementCaptionNoticeV4Schema } from "#shared/movie-editions/notifications-v4.ts";
import { replacementPaths } from "#automation/subtitle-replacement/files.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test("a genuinely adopted unverified sidecar gains only its actual scoped replacement lineage and personal ready delivery", async () => {
  const f = await createAdoptedMovieReplacementFixture(bytes);
  closers.push(f.close);
  expect(f.old).toMatchObject({
    state: "installed",
    qualityStatus: "unverified",
    providerId: "migration",
  });
  const original = await f.db.mediaHandoffReceipt.findUniqueOrThrow({
    where: { id: f.original.receiptId },
  });
  const plan = await f.db.mediaHandoffPlan.findUniqueOrThrow({
    where: { id: original.planId },
  });
  const binding = await f.db.plexBindingCurrent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
    },
  });
  expect(
    await f.db.applicationEvent.count({
      where: { mediaId: f.scope.mediaId, kind: "subtitles_ready" },
    }),
  ).toBe(0);
  const input = await f.approve();
  expect(await f.invoke("applySubtitleReplacement", input)).toEqual({
    state: "applied",
  });
  const row = await f.row();
  const receipt = MovieReplacementReceiptV2Schema.parse(row.receipt?.evidence);
  expect(receipt.source).toMatchObject({
    kind: "video_baseline",
    publication: {
      kind: "movie_library_adoption_v2",
      receiptId: original.id,
      assetId: f.asset.id,
      assetVersion: 0,
      scope: f.scope,
    },
  });
  expect(receipt.before.old.qualityStatus).toBe("unverified");
  expect(receipt.after.candidate).toMatchObject({
    id: f.candidate.id,
    qualityStatus: "accepted",
    state: "installed",
  });
  const paths = replacementPaths(f.files, row);
  expect(hash(await readFile(paths.target))).toBe(hash(Buffer.from(f.text)));
  expect(hash(await readFile(paths.oldArchive))).toBe(
    hash(Buffer.from(f.oldText)),
  );
  const video = await readFile(paths.video);
  expect({ size: video.byteLength, checksum: hash(video) }).toEqual({
    size: bytes.byteLength,
    checksum: hash(bytes),
  });
  const budget = new PublicationAuthorityReadBudget();
  const asset = await snapshotMoviePublicationAssetV2(
    f.db,
    f.scope,
    f.asset.id,
    budget,
  );
  const parent = await findMoviePublicationReferenceV2(
    f.db,
    { scope: f.scope, asset },
    budget,
  );
  expect(parent).toMatchObject({
    kind: "movie_library_adoption_v2",
    receiptId: original.id,
    subtitleLineage: {
      replacements: [{ beforeId: f.old.id, afterId: f.candidate.id }],
    },
  });
  expect(() => budget.consume(0)).not.toThrow();
  const event = await f.db.applicationEvent.findFirstOrThrow({
    where: { mediaId: f.scope.mediaId, kind: "subtitles_ready" },
  });
  const notice = MovieReplacementCaptionNoticeV4Schema.parse(event.payload);
  expect(notice).toMatchObject({
    kind: "movie_subtitle_replacement",
    source: {
      schemaVersion: 2,
      scope: f.scope,
      replacementId: row.id,
      assetId: f.asset.id,
      subtitleId: f.candidate.id,
    },
    captionHash: identityHash(receipt),
    request: { id: f.request.requestId },
  });
  const delivery = await f.db.notificationDelivery.findFirstOrThrow({
    where: { eventId: event.id, userId: f.owner.id, channel: "email" },
  });
  const operation = await f.db.operation.findFirstOrThrow({
    where: {
      kind: "deliver_notification",
      payload: { path: ["notificationId"], equals: delivery.id },
    },
  });
  const messageInput = {
    operationId: operation.id,
    notificationId: delivery.id,
  };
  const execution = testPlexBindingExecution();
  const allowance = new PublicationAuthorityReadBudget();
  const context = {
    ...f.context,
    plexBindingExecution: () => execution,
    movieManagement: { execution, budget: allowance },
  };
  expect(
    await createNotificationActivities(context).deliverMediaNotification(
      messageInput,
    ),
  ).toEqual({ status: "accepted", reason: null });
  expect(() => allowance.consume(0)).not.toThrow();
  expect(f.messages).toHaveLength(1);
  const message = f.messages[0];
  expect(message).toMatchObject({
    recipient: "caption-owner@example.test",
    channel: "email",
  });
  const actual = z
    .object({ subject: z.string(), text: z.string() })
    .parse(message);
  expect(`${actual.subject}\n${actual.text}`).toContain(
    movieEditionDisplayLabel(f.scope.edition),
  );
  const link = new URL(
    z.string().parse(/http:\/\/\S+/u.exec(actual.text)?.[0]),
  );
  const page = await fetch(link);
  expect(page.status).toBe(200);
  expect(
    await createNotificationActivities({
      ...f.context,
      permittedSections: () =>
        Promise.reject(
          new Error(
            "Historical caption acknowledgement precedes current configuration",
          ),
        ),
    }).deliverMediaNotification(messageInput),
  ).toEqual({ status: "accepted", reason: null });
  expect(await f.invoke("applySubtitleReplacement", input)).toEqual({
    state: "applied",
  });
  expect(f.messages).toHaveLength(1);
  expect(
    await f.db.applicationEvent.count({
      where: { mediaId: f.scope.mediaId, kind: "subtitles_ready" },
    }),
  ).toBe(1);
  expect(
    await f.db.notificationDeliveryAttempt.count({
      where: { deliveryId: delivery.id },
    }),
  ).toBe(1);
  expect(
    await f.db.mediaHandoffReceipt.findUniqueOrThrow({
      where: { id: original.id },
    }),
  ).toEqual(original);
  expect(
    await f.db.mediaHandoffPlan.findUniqueOrThrow({ where: { id: plan.id } }),
  ).toEqual(plan);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(f.asset);
  expect(
    await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
  ).toEqual(binding);
  expect(
    await f.db.acquisitionAttempt.count({
      where: { mediaIds: { has: f.scope.mediaId } },
    }),
  ).toBe(0);
}, 60_000);
