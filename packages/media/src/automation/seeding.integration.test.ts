import { expect, test } from "vitest";
import { createSeedingActivities } from "./seeding.ts";
import { automationTestHarness } from "#testing/automation.ts";

const { database, context, fixture } = automationTestHarness();

async function seededTorrent() {
  const data = await fixture();
  const request = await database().mediaRequest.findFirstOrThrow({
    where: { mediaId: data.media.id },
  });
  const torrent = await database().torrent.create({
    data: {
      infoHash: data.source.infoHash,
      providerId: "knaben",
      owned: true,
      ownershipEpoch: 0,
      seedingPolicy: { kind: "public" },
      state: "seeding",
    },
  });
  const attempt = await database().acquisitionAttempt.create({
    data: {
      operationId: data.input.operationId,
      releaseId: data.release.id,
      sponsorRequestId: request.id,
      mediaIds: [data.media.id],
      generations: { [data.media.id]: 1 },
      state: "completed",
      torrentId: torrent.id,
    },
  });
  const isolated = `/downloads/media/${attempt.id}`;
  const observed = {
    hash: torrent.infoHash,
    infohash_v1: torrent.infoHash,
    infohash_v2: "",
    name: "Example.mkv",
    state: "uploading",
    category: "media",
    tags: `media-${data.input.operationId},media-attempt-${attempt.id}`,
    progress: 1,
    ratio: 2,
    ratio_limit: -1,
    seeding_time_limit: -1,
    inactive_seeding_time_limit: -1,
    max_ratio: -1,
    max_seeding_time: -1,
    max_inactive_seeding_time: -1,
    share_limit_action: "Stop",
    auto_tmm: false,
    force_start: false,
    seeding_time: 100,
    size: 1000,
    save_path: isolated,
    content_path: `${isolated}/Example.mkv`,
  };
  return { ...data, torrent, observed };
}

test("a disabled final cleanup gate releases a pre-effect claim and later retries safely", async () => {
  const data = await seededTorrent();
  let deletes = 0;
  let gateReads = 0;
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", { headers: { "set-cookie": "SID=fixture" } });
    if (url.pathname.endsWith("/torrents/info"))
      return Response.json([data.observed]);
    if (url.pathname.endsWith("/torrents/files")) return Response.json([]);
    if (url.pathname.endsWith("/torrents/delete")) {
      deletes++;
      return new Response();
    }
    throw new Error("Unexpected request");
  });
  ctx.gates.sourceCleanup = async () => {
    gateReads++;
    return gateReads !== 2;
  };
  const activities = createSeedingActivities(ctx);
  const input = {
    operationId: data.input.operationId,
    torrentId: data.torrent.id,
  };
  expect(await activities.removeMediaTorrent(input)).toMatchObject({
    status: "protected",
    reason: "source_dependencies_changed",
  });
  expect(
    await database().torrent.findUnique({ where: { id: data.torrent.id } }),
  ).toMatchObject({ state: "seeding" });
  expect(deletes).toBe(0);
  expect(await activities.removeMediaTorrent(input)).toMatchObject({
    status: "removed",
  });
  expect(deletes).toBe(1);
});

test("a foreign torrent sharing the isolated source directory prevents file deletion", async () => {
  const data = await seededTorrent();
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", { headers: { "set-cookie": "SID=fixture" } });
    if (url.pathname.endsWith("/torrents/info"))
      return Response.json(
        url.searchParams.has("hashes")
          ? [data.observed]
          : [
              data.observed,
              {
                ...data.observed,
                hash: "a".repeat(40),
                infohash_v1: "a".repeat(40),
                category: "unmanaged",
                tags: "",
              },
            ],
      );
    if (url.pathname.endsWith("/torrents/files")) return Response.json([]);
    throw new Error("Unexpected mutation");
  });
  expect(
    await createSeedingActivities(ctx).removeMediaTorrent({
      operationId: data.input.operationId,
      torrentId: data.torrent.id,
    }),
  ).toMatchObject({ status: "protected", reason: "source_directory_shared" });
  expect(
    await database().torrent.findUnique({ where: { id: data.torrent.id } }),
  ).toMatchObject({ state: "seeding" });
});

test("a late native-limit writer prevents removal and releases the pre-effect claim", async () => {
  const data = await seededTorrent();
  let reads = 0;
  let deletes = 0;
  const ctx = context(async (url) => {
    if (url.pathname.endsWith("/auth/login"))
      return new Response(null, {
        status: 204,
        headers: { "set-cookie": "SID=fixture" },
      });
    if (url.pathname.endsWith("/torrents/info")) {
      reads++;
      return Response.json([
        {
          ...data.observed,
          ...(reads > 1
            ? { seeding_time_limit: 123, max_seeding_time: 123 }
            : {}),
        },
      ]);
    }
    if (url.pathname.endsWith("/torrents/files")) return Response.json([]);
    if (url.pathname.endsWith("/torrents/delete")) deletes++;
    throw new Error("Unexpected mutation");
  });
  expect(
    await createSeedingActivities(ctx).removeMediaTorrent({
      operationId: data.input.operationId,
      torrentId: data.torrent.id,
    }),
  ).toEqual({ status: "protected", reason: "torrent_policy_drift" });
  expect(deletes).toBe(0);
  expect(
    await database().torrent.findUniqueOrThrow({
      where: { id: data.torrent.id },
    }),
  ).toMatchObject({ state: "seeding" });
});
