import { afterAll, beforeAll, expect, test } from "vitest";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { fileFixture } from "./test-support.ts";
import { createMediaFileActivities } from "./activities.ts";
import { FilePlanSchema } from "./types.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const result = await fileFixture(cluster.database);
  directories.push(result.directory);
  return result;
}

async function episodePack(
  f: Awaited<ReturnType<typeof fixture>>,
  acquired: Awaited<ReturnType<typeof f.acquisition>>,
) {
  const db = cluster.database;
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Coastlines", year: 2026, tmdbId: 1234 },
  });
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: {
      kind: "episode",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  const second = await db.mediaItem.create({
    data: {
      kind: "episode",
      parentId: series.id,
      title: "Second Episode",
      seasonNumber: 1,
      episodeNumber: 2,
      intent: { create: { profileId: f.profile.id, automationEpoch: 0 } },
      requests: {
        create: { userId: f.user.id, sponsorRequestId: f.request.id },
      },
    },
  });
  const names = ["Coastlines.S01E01.mkv", "Coastlines.S01E02.mkv"];
  for (const name of names)
    await writeFile(nodePath.join(f.roots.downloads, name), acquired.content);
  await db.torrent.update({
    where: { id: acquired.attempt.torrentId ?? "" },
    data: {
      observation: {
        torrent: { progress: 1, save_path: f.roots.downloads },
        files: names.map((name) => ({
          name,
          size: Buffer.byteLength(acquired.content),
          progress: 1,
        })),
      },
    },
  });
  await db.acquisitionAttempt.update({
    where: { id: acquired.attempt.id },
    data: {
      mediaIds: [f.media.id, second.id],
      generations: { [f.media.id]: 0, [second.id]: 0 },
      reservations: { create: { mediaId: second.id, generation: 0 } },
    },
  });
  return second;
}

test("mixed pack rollback restores old playback and quarantines first publications across an interruption", async () => {
  const f = await fixture();
  const original = await f.published();
  const acquired = await f.acquisition("Improved episode content");
  const second = await episodePack(f, acquired);
  const inspect = f.context.inspect;
  if (inspect === undefined) throw new Error("Inspector missing");
  f.context.inspect = async (path) => {
    const probe = await inspect(path);
    return {
      ...probe,
      streams: probe.streams.map((stream) =>
        stream.codec_type === "video"
          ? { ...stream, width: 3840, height: 1600 }
          : stream,
      ),
    };
  };
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const attempt = await cluster.database.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const plan = FilePlanSchema.parse(attempt.filePlan);
  const newEntry = plan.find((entry) => entry.previousAssetId === null);
  if (newEntry === undefined)
    throw new Error("Expected initial episode publication");
  let interrupted = false;
  f.context.checkpoint = (phase) => {
    if (phase === "move-unlinked" && !interrupted) {
      interrupted = true;
      return Promise.reject(new Error("rollback interrupted"));
    }
    return Promise.resolve();
  };
  await expect(
    activities.rollbackMediaPromotion(acquired.input),
  ).rejects.toThrow("rollback interrupted");
  expect(await activities.rollbackMediaPromotion(acquired.input)).toEqual({
    status: "protected",
    reason: "new_publications_quarantined",
  });
  expect(await activities.rollbackMediaPromotion(acquired.input)).toEqual({
    status: "protected",
    reason: "new_publications_quarantined",
  });
  expect(
    await readFile(
      nodePath.join(f.roots.library, original.entry.libraryPath),
      "utf8",
    ),
  ).toBe(original.content);
  await expect(
    access(nodePath.join(f.roots.library, newEntry.libraryPath)),
  ).rejects.toThrow();
  expect(
    await readFile(
      nodePath.join(f.roots.control, "quarantine", newEntry.assetId),
      "utf8",
    ),
  ).toBe(acquired.content);
  expect(
    await cluster.database.assetCoverage.findMany({
      where: { mediaId: f.media.id, current: true },
    }),
  ).toMatchObject([{ assetId: original.entry.assetId }]);
  expect(
    await cluster.database.assetCoverage.count({
      where: { mediaId: second.id, current: true },
    }),
  ).toBe(0);
  expect(
    await cluster.database.mediaItem.findUniqueOrThrow({
      where: { id: second.id },
    }),
  ).toMatchObject({ availability: "wanted" });
  expect(
    await cluster.database.acquisitionReservation.count({
      where: { attemptId: acquired.attempt.id },
    }),
  ).toBe(2);
  expect(
    await cluster.database.mediaItem.findUniqueOrThrow({
      where: { id: f.media.id },
    }),
  ).toMatchObject({ availability: "importing" });
  expect(
    await cluster.database.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    }),
  ).toMatchObject({
    state: "rolled_back",
    failure: {
      rollbackReceipt: {
        recoveryEpoch: 0,
        mediaIds: [f.media.id],
        assets: [{ assetId: original.entry.assetId }],
      },
    },
  });
});

test("concurrent sibling restore operations receive complete shared-file receipts without another filesystem move", async () => {
  const f = await fixture();
  const original = await f.published();
  const retention = await f.retention();
  const timestamp = f.context.now?.();
  if (timestamp === undefined) throw new Error("Fixture clock missing");
  const second = await cluster.database.mediaItem.create({
    data: {
      kind: "movie",
      title: "Shared part",
      availability: "available",
      intent: { create: { profileId: f.profile.id, automationEpoch: 0 } },
      requests: { create: { userId: f.user.id } },
      watchStates: {
        create: {
          userId: f.user.id,
          watched: true,
          observedAt: timestamp,
          source: "fixture",
        },
      },
      assets: {
        create: { assetId: original.entry.assetId, current: true },
      },
    },
  });
  const warning = await cluster.database.applicationEvent.create({
    data: {
      mediaId: second.id,
      kind: "removal_warning",
      payload: {},
      notifications: {
        create: {
          userId: f.user.id,
          channel: "email",
          state: "accepted",
          acceptedAt: retention.decision.warningAcceptedAt,
          reconciledAt: timestamp,
        },
      },
    },
  });
  await cluster.database.retentionDecision.create({
    data: {
      mediaId: second.id,
      generation: 0,
      state: "grace_period",
      graceUntil: retention.decision.graceUntil,
      warningAcceptedAt: retention.decision.warningAcceptedAt,
      evidence: {
        authorizedAt: timestamp.toISOString(),
        activePlayback: false,
        recoveryEpoch: 0,
        warningEventId: warning.id,
      },
    },
  });
  const activities = createMediaFileActivities(f.context);
  expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
    status: "quarantined",
  });
  const operations = [];
  for (const mediaId of [f.media.id, second.id]) {
    const intent = await cluster.database.mediaIntent.update({
      where: { mediaId },
      data: { generation: { increment: 1 } },
    });
    const operation = await cluster.database.operation.create({
      data: {
        kind: "restore_media",
        payload: { mediaId, generation: intent.generation },
        result: { plexCheck: { preserved: true } },
      },
    });
    operations.push({ mediaId, operationId: operation.id });
  }
  expect(
    await Promise.all(
      operations.map((operation) => activities.restoreMediaFiles(operation)),
    ),
  ).toEqual([{ status: "restored" }, { status: "restored" }]);
  const asset = await cluster.database.libraryAsset.findUniqueOrThrow({
    where: { id: original.entry.assetId },
  });
  for (const input of operations) {
    const operation = await cluster.database.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    expect(operation.result).toMatchObject({
      plexCheck: { preserved: true },
      restoreReceipt: {
        mediaIds: expect.arrayContaining([f.media.id, second.id]),
        recoveryEpoch: 0,
        assets: [
          {
            assetId: asset.id,
            assetVersion: asset.version,
            checksum: asset.checksum,
          },
        ],
      },
    });
    expect(await activities.restoreMediaFiles(input)).toEqual({
      status: "restored",
    });
  }
  expect(await readFile(asset.path, "utf8")).toBe(original.content);
  const newerIntent = await cluster.database.mediaIntent.update({
    where: { mediaId: second.id },
    data: { generation: { increment: 1 } },
  });
  const laterOperation = await cluster.database.operation.create({
    data: {
      kind: "restore_media",
      payload: { mediaId: second.id, generation: newerIntent.generation },
    },
  });
  expect(
    await activities.restoreMediaFiles({
      mediaId: second.id,
      operationId: laterOperation.id,
    }),
  ).toEqual({ status: "restored" });
  expect(
    await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { id: asset.id },
    }),
  ).toMatchObject({ version: asset.version, checksum: asset.checksum });
  const laterReceipt = await cluster.database.operation.findUniqueOrThrow({
    where: { id: laterOperation.id },
  });
  expect(laterReceipt.result).toMatchObject({
    restoreReceipt: {
      mediaIds: expect.arrayContaining([f.media.id, second.id]),
    },
  });
  const first = operations[0];
  if (first === undefined) throw new Error("Missing restore operation");
  expect(await activities.restoreMediaFiles(first)).toEqual({
    status: "restored",
  });
  await cluster.database.mediaIntent.update({
    where: { mediaId: second.id },
    data: { generation: { increment: 1 }, desiredPresence: false },
  });
  expect(await activities.restoreMediaFiles(first)).toEqual({
    status: "protected",
    reason: "restore_generation_changed",
  });
});
