import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { createAcquisitionActivities } from "./acquisition.ts";
import { reconcileUnconfirmedSubmission } from "./acquisition-submission.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";

const { database, context, fixture } = automationTestHarness();

test("an uncertain add remains reconcilable after cancellation and never submits twice", async () => {
  const f = await fixture();
  let added: Record<string, unknown> | null = null;
  let visible = false;
  let adds = 0;
  const ctx = context(async (url, init) => {
    if (url.pathname.endsWith("/login"))
      return new Response(null, {
        status: 204,
        headers: { "set-cookie": "SID=fixture" },
      });
    if (url.pathname.endsWith("/info"))
      return Response.json(visible && added !== null ? [added] : []);
    if (
      !url.pathname.endsWith("/add") ||
      !(init.body instanceof URLSearchParams)
    )
      throw new Error("Unexpected effect");
    adds++;
    added = {
      hash: f.source.infoHash,
      infohash_v1: f.source.infoHash,
      infohash_v2: "",
      name: "fixture",
      state: "downloading",
      category: "media",
      tags: init.body.get("tags"),
      save_path: init.body.get("savepath"),
      content_path: `${String(init.body.get("savepath"))}/fixture.mkv`,
      progress: 0,
      ratio: 0,
      seeding_time: 0,
      size: 1000,
      ratio_limit: -1,
      seeding_time_limit: -1,
      inactive_seeding_time_limit: -1,
      max_ratio: -1,
      max_seeding_time: -1,
      max_inactive_seeding_time: -1,
      share_limit_action: "Stop",
      auto_tmm: false,
      force_start: false,
    };
    throw new Error("Response lost");
  });
  const activities = createAcquisitionActivities(ctx);
  const reserved = await activities.reconcileMediaIntent(f.input);
  if (reserved.attemptId === null) throw new Error("Missing attempt");
  expect(
    await activities.submitMediaTorrent({
      operationId: f.input.operationId,
      attemptId: reserved.attemptId,
    }),
  ).toMatchObject({ status: "blocked", reason: "outcome-unknown" });
  const request = await database().mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: f.user.id,
        mediaId: f.media.id,
        edition: "default",
      },
    },
  });
  await new PrismaMediaApplication(database(), { keepDays: 7 }).cancelRequest(
    { ...f.user, role: "member" },
    crypto.randomUUID(),
    request.id,
    request.version,
  );
  await reconcileUnconfirmedSubmission(ctx, reserved.attemptId);
  expect(
    await database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: reserved.attemptId },
    }),
  ).toMatchObject({ state: "submission_unknown", torrentId: null });
  visible = true;
  await reconcileUnconfirmedSubmission(ctx, reserved.attemptId);
  const torrent = await database().torrent.findUniqueOrThrow({
    where: { infoHash: f.source.infoHash },
  });
  expect(torrent).toMatchObject({
    owned: true,
    qbittorrentId: f.source.infoHash,
  });
  expect(
    await database().operation.count({
      where: { idempotencyKey: `seed:${torrent.id}` },
    }),
  ).toBe(1);
  expect(adds).toBe(1);
});
