import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { afterAll, expect, test } from "vitest";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { workerFilePath } from "./paths/locations.ts";
import { fileFixture } from "./test-support.ts";
import { createMediaFileActivities } from "./activities.ts";
import { FilePlanSchema } from "./types.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture(episode = false) {
  const series = episode
    ? await harness.database().mediaItem.create({
        data: {
          kind: "series",
          title: "Coastlines",
          year: 2026,
          tmdbId: Math.floor(Math.random() * 1_000_000_000),
        },
      })
    : null;
  const result = await fileFixture(
    harness.database(),
    series === null ? undefined : { seriesId: series.id },
  );
  directories.push(result.directory);
  return result;
}

async function episodePack(f: Awaited<ReturnType<typeof fixture>>) {
  const db = harness.database();
  const seriesId = f.media.parentId;
  if (seriesId === null) throw new Error("Episode fixture has no series");
  const second = await db.mediaItem.create({
    data: {
      kind: "episode",
      parentId: seriesId,
      title: "Second Episode",
      seasonNumber: 1,
      episodeNumber: 2,
    },
  });
  await db.$transaction(async (tx) => {
    await lockDefaultScopes(tx, [defaultScope(second.id)], {
      createMissing: true,
    });
    await tx.mediaIntent.update({
      where: targetWhere(defaultScope(second.id)),
      data: {
        profileId: f.profile.id,
        automationEpoch: 0,
        desiredPresence: true,
        monitoring: true,
      },
    });
    await tx.mediaRequest.create({
      data: {
        mediaId: second.id,
        userId: f.user.id,
        sponsorRequestId: f.request.id,
      },
    });
  });
  const acquired = await f.acquisition("Improved episode content", [
    f.media.id,
    second.id,
  ]);
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
  return { second, acquired };
}

test("mixed pack rollback restores old playback and quarantines first publications across an interruption", async () => {
  const f = await fixture(true);
  const original = await f.published();
  const { second, acquired } = await episodePack(f);
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
  const attempt = await harness
    .database()
    .acquisitionAttempt.findUniqueOrThrow({
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
    await harness.database().assetCoverage.findMany({
      where: { mediaId: f.media.id, current: true },
    }),
  ).toMatchObject([{ assetId: original.entry.assetId }]);
  expect(
    await harness.database().assetCoverage.count({
      where: { mediaId: second.id, current: true },
    }),
  ).toBe(0);
  expect(
    await harness.database().mediaItem.findUniqueOrThrow({
      where: { id: second.id },
    }),
  ).toMatchObject({ availability: "wanted" });
  expect(
    await harness.database().acquisitionReservation.count({
      where: { attemptId: acquired.attempt.id },
    }),
  ).toBe(2);
  expect(
    await harness.database().mediaItem.findUniqueOrThrow({
      where: { id: f.media.id },
    }),
  ).toMatchObject({ availability: "importing" });
  expect(
    await harness.database().acquisitionAttempt.findUniqueOrThrow({
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
  const db = harness.database();
  const f = await sharedTvFileFixture(db, mappedPublicationFixture);
  directories.push(f.directory);
  const original = await preparePhysicalPublication(f);
  const bound = await prepareBoundRetention(f, original, harness.context());
  const retention = bound.retention;
  const siblingId = original.entry.mediaIds.find((id) => id !== f.media.id);
  if (siblingId === undefined)
    throw new Error("Actual shared publication omitted its sibling");
  const second = await db.mediaItem.findUniqueOrThrow({
    where: { id: siblingId },
  });
  const activities = createMediaFileActivities(f.context);
  expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
    status: "quarantined",
  });
  const operations = [];
  for (const mediaId of [f.media.id, second.id]) {
    const intent = await harness.database().mediaIntent.update({
      where: targetWhere(defaultScope(mediaId)),
      data: { generation: { increment: 1 } },
    });
    const operation = await harness.database().operation.create({
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
  const asset = await harness.database().libraryAsset.findUniqueOrThrow({
    where: { id: original.entry.assetId },
  });
  for (const input of operations) {
    const operation = await harness.database().operation.findUniqueOrThrow({
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
  expect(await readFile(workerFilePath(f.context, asset.path), "utf8")).toBe(
    original.content,
  );
  const newerIntent = await harness.database().mediaIntent.update({
    where: targetWhere(defaultScope(second.id)),
    data: { generation: { increment: 1 } },
  });
  const laterOperation = await harness.database().operation.create({
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
    await harness.database().libraryAsset.findUniqueOrThrow({
      where: { id: asset.id },
    }),
  ).toMatchObject({ version: asset.version, checksum: asset.checksum });
  const laterReceipt = await harness.database().operation.findUniqueOrThrow({
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
  await harness.database().mediaIntent.update({
    where: targetWhere(defaultScope(second.id)),
    data: { generation: { increment: 1 }, desiredPresence: false },
  });
  expect(await activities.restoreMediaFiles(first)).toEqual({
    status: "protected",
    reason: "restore_generation_changed",
  });
});
