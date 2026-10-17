import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { setTimeout } from "node:timers/promises";

const { database, context, fixture } = automationTestHarness();

test("cancellation cannot commit between the final authority guard and the external add", async () => {
  const f = await fixture();
  const db = database();
  const claim = await db.mediaRequest.findUniqueOrThrow({
    where: { userId_mediaId: { userId: f.user.id, mediaId: f.media.id } },
  });
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  let adds = 0;
  let added: Record<string, unknown> | null = null;
  const ctx = context(async (url, init) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", {
        headers: { "Set-Cookie": "SID=fixture; HttpOnly" },
      });
    if (url.pathname.endsWith("/torrents/info"))
      return Response.json(added === null ? [] : [added]);
    if (url.pathname.endsWith("/torrents/add")) {
      adds++;
      entered.resolve(undefined);
      await release.promise;
      if (!(init.body instanceof URLSearchParams))
        throw new TypeError("Expected form");
      added = {
        hash: f.source.infoHash,
        infohash_v1: f.source.infoHash,
        infohash_v2: "",
        tags: init.body.get("tags"),
        save_path: init.body.get("savepath"),
        content_path: `${String(init.body.get("savepath"))}/fixture.mkv`,
        name: "fixture",
        state: "downloading",
        category: "media",
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
      return Response.json({
        added_torrent_ids: [f.source.infoHash],
        success_count: 1,
        failure_count: 0,
        pending_count: 0,
      });
    }
    return new Response("Ok.");
  });
  const activities = createAcquisitionActivities(ctx);
  const reservation = await activities.reconcileMediaIntent(f.input);
  if (reservation.attemptId === null) throw new Error("Reservation absent");
  const submitted = activities.submitMediaTorrent({
    operationId: f.input.operationId,
    attemptId: reservation.attemptId,
  });
  await entered.promise;
  let cancelled = false;
  const cancel = async () => {
    await new PrismaMediaCommands(db, { keepDays: 30 }).cancelRequest(
      f.user,
      crypto.randomUUID(),
      claim.id,
      claim.version,
    );
    cancelled = true;
  };
  const cancellation = cancel();
  try {
    await setTimeout(20);
    expect(cancelled).toBe(false);
  } finally {
    release.resolve(undefined);
  }
  await Promise.all([submitted, cancellation]);
  expect(adds).toBe(1);
  expect(
    await db.mediaRequest.findUniqueOrThrow({ where: { id: claim.id } }),
  ).toMatchObject({ active: false });
  const torrent = await db.torrent.findUniqueOrThrow({
    where: { infoHash: f.source.infoHash },
  });
  expect(
    await db.operation.count({
      where: { idempotencyKey: `seed:${torrent.id}` },
    }),
  ).toBe(1);
});

test("cancellation during qBit lookup revokes the final submission authority", async () => {
  const f = await fixture();
  const db = database();
  const claim = await db.mediaRequest.findUniqueOrThrow({
    where: { userId_mediaId: { userId: f.user.id, mediaId: f.media.id } },
  });
  let adds = 0;
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", {
        headers: { "Set-Cookie": "SID=fixture; HttpOnly" },
      });
    if (url.pathname.endsWith("/torrents/info")) {
      await new PrismaMediaCommands(db, { keepDays: 30 }).cancelRequest(
        f.user,
        crypto.randomUUID(),
        claim.id,
        claim.version,
      );
      return Response.json([]);
    }
    if (url.pathname.endsWith("/torrents/add")) adds++;
    return new Response("Ok.");
  });
  const activities = createAcquisitionActivities(ctx);
  const reservation = await activities.reconcileMediaIntent(f.input);
  if (reservation.attemptId === null) throw new Error("Reservation absent");
  expect(
    await activities.submitMediaTorrent({
      operationId: f.input.operationId,
      attemptId: reservation.attemptId,
    }),
  ).toEqual({ status: "blocked", reason: "submission_authority_changed" });
  expect(adds).toBe(0);
  expect(
    await db.torrent.count({ where: { infoHash: f.source.infoHash } }),
  ).toBe(0);
});

test("a restore epoch fences old publication before Plex network effects and finalization", async () => {
  const f = await fixture();
  const ctx = context();
  const reservation = await createAcquisitionActivities(
    ctx,
  ).reconcileMediaIntent(f.input);
  if (reservation.attemptId === null) throw new Error("Reservation absent");
  await prepareMediaRestore(database(), {
    recoveryId: crypto.randomUUID(),
    expectedEpoch: 0,
    reason: "restore epoch test",
  });
  // Simulate a separately reviewed later ownership transfer, leaving old attempt untouched.
  await database().mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true },
  });
  const input = {
    operationId: f.input.operationId,
    attemptId: reservation.attemptId,
  };
  expect(
    await createPublicationActivities(ctx).publishMediaToPlex(input),
  ).toEqual({ status: "blocked", reason: "recovery_epoch_changed" });
  await expect(
    createPublicationActivities(ctx).finalizeMediaAcquisition(input),
  ).rejects.toThrow("Finalization recovery epoch changed");
});
