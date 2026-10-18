import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { afterAll, beforeAll, expect, test } from "vitest";
import { readFile, rm, access, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { createHash } from "node:crypto";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { fileFixture } from "./test-support.ts";
import { createMediaFileActivities } from "./activities.ts";
import { FilePlanSchema } from "./types.ts";
import { stageEmbedded } from "./embedded.ts";
import { runMediaTool, inspectMedia } from "#filesystem/media-tools.ts";

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
async function fixture(episode = false) {
  const series = episode
    ? await cluster.database.mediaItem.create({
        data: { kind: "series", title: "Coastlines", year: 2026, tmdbId: 1234 },
      })
    : null;
  const value = await fileFixture(
    cluster.database,
    series === null ? undefined : { seriesId: series.id },
  );
  directories.push(value.directory);
  return value;
}

test("an interrupted publication converges without duplicating the owned asset", async () => {
  const f = await fixture();
  const acquired = await f.acquisition();
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  let fail = true;
  f.context.checkpoint = (phase) => {
    if (phase === "published" && fail) {
      fail = false;
      return Promise.reject(new Error("simulated process interruption"));
    }
    return Promise.resolve();
  };
  await expect(activities.promoteMediaFiles(acquired.input)).rejects.toThrow(
    "simulated process interruption",
  );
  expect(
    await cluster.database.libraryAsset.count({
      where: { coverage: { some: { mediaId: f.media.id } } },
    }),
  ).toBe(0);
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const assets = await cluster.database.libraryAsset.findMany({
    where: { coverage: { some: { mediaId: f.media.id, current: true } } },
  });
  expect(assets).toHaveLength(1);
  expect(await readFile(assets[0]?.path ?? "", "utf8")).toBe(acquired.content);
});

test("a new generation after staging prevents publication", async () => {
  const f = await fixture();
  const acquired = await f.acquisition();
  const activities = createMediaFileActivities(f.context);
  await activities.inspectAndStageMedia(acquired.input);
  await cluster.database.mediaIntent.update({
    where: targetWhere(defaultScope(f.media.id)),
    data: { generation: { increment: 1 } },
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "obsolete",
    reason: "intent_obsolete",
  });
  const attempt = await cluster.database.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  await expect(
    access(nodePath.join(f.roots.library, entry?.libraryPath ?? "missing")),
  ).rejects.toThrow();
});

test("a partial season publication followed by Keep compensates every uncommitted file", async () => {
  const f = await fixture(true);
  const db = cluster.database;
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
  const acquired = await f.acquisition(undefined, [f.media.id, second.id]);
  const files = ["Coastlines.S01E01.mkv", "Coastlines.S01E02.mkv"];
  for (const name of files)
    await writeFile(nodePath.join(f.roots.downloads, name), acquired.content);
  await db.torrent.update({
    where: { id: acquired.attempt.torrentId ?? "" },
    data: {
      observation: {
        torrent: { progress: 1, save_path: f.roots.downloads },
        files: files.map((name) => ({
          name,
          size: Buffer.byteLength(acquired.content),
          progress: 1,
        })),
      },
    },
  });
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  let firstPublished = false;
  f.context.checkpoint = (phase) => {
    if (phase === "publication-authorization" && firstPublished)
      return Promise.reject(new Error("second file interrupted"));
    if (phase === "published") firstPublished = true;
    return Promise.resolve();
  };
  await expect(activities.promoteMediaFiles(acquired.input)).rejects.toThrow(
    "second file interrupted",
  );
  expect(
    await db.libraryAsset.count({
      where: {
        coverage: { some: { mediaId: { in: [f.media.id, second.id] } } },
      },
    }),
  ).toBe(0);
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const plan = FilePlanSchema.parse(attempt.filePlan);
  await db.mediaIntent.update({
    where: targetWhere(defaultScope(second.id)),
    data: { generation: 1 },
  });
  f.context.checkpoint = () => Promise.resolve();
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "obsolete",
    reason: "intent_obsolete",
  });
  for (const entry of plan)
    await expect(
      access(nodePath.join(f.roots.library, entry.libraryPath)),
    ).rejects.toThrow();
  const first = plan[0];
  if (first === undefined) throw new Error("Fixture plan missing");
  expect(
    await readFile(
      nodePath.join(f.roots.control, "quarantine", first.assetId),
      "utf8",
    ),
  ).toBe(acquired.content);
  expect(
    await db.acquisitionReservation.count({
      where: { attemptId: acquired.attempt.id },
    }),
  ).toBe(0);
});

test("restore recovers a quarantine filesystem effect whose database commit was interrupted", async () => {
  const f = await fixture();
  const original = await f.published();
  const retention = await f.retention();
  const activities = createMediaFileActivities(f.context);
  f.context.checkpoint = (phase) =>
    phase === "move-unlinked"
      ? Promise.reject(new Error("quarantine interrupted"))
      : Promise.resolve();
  await expect(
    activities.quarantineMediaFiles(retention.input),
  ).rejects.toThrow("quarantine interrupted");
  const intent = await cluster.database.mediaIntent.update({
    where: targetWhere(defaultScope(f.media.id)),
    data: { generation: 1 },
  });
  await cluster.database.retentionDecision.update({
    where: { id: retention.decision.id },
    data: { state: "cancelled" },
  });
  const operation = await cluster.database.operation.create({
    data: {
      kind: "restore_media",
      payload: { mediaId: f.media.id, generation: intent.generation },
    },
  });
  f.context.checkpoint = () => Promise.resolve();
  expect(
    await activities.restoreMediaFiles({
      mediaId: f.media.id,
      operationId: operation.id,
    }),
  ).toEqual({ status: "restored" });
  expect(
    await readFile(
      nodePath.join(f.roots.library, original.entry.libraryPath),
      "utf8",
    ),
  ).toBe(original.content);
});

test("failed Plex upgrade verification restores the previous file and coverage", async () => {
  const f = await fixture();
  const original = await f.published();
  const upgraded = await f.acquisition("Upgraded fixture media contents");
  const target = await cluster.database.mediaIntent.findUniqueOrThrow({
    where: targetWhere(defaultScope(f.media.id)),
  });
  const activities = createMediaFileActivities(f.context);
  const inspect = f.context.inspect;
  if (inspect === undefined) throw new Error("Fixture inspector missing");
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
  const subtitle = await cluster.database.subtitleAsset.create({
    data: {
      assetId: original.entry.assetId,
      language: "en",
      providerId: "fixture",
      state: "validated",
      ownershipEpoch: 0,
      qualityStatus: "accepted",
      storageKind: "sidecar",
      videoChecksum: original.entry.checksum,
      videoVersion: 0,
      checksum: createHash("sha256")
        .update("1\n00:00:01,000 --> 00:00:02,000\nHello there.\n")
        .digest("hex"),
      content: Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nHello there.\n"),
      provenance: {
        filename: "fixture.srt",
        description: "Human subtitle",
        format: "srt",
      },
      matchingEvidence: {
        assetVersion: 0,
        assetChecksum: original.entry.checksum,
        exactMediaMatch: true,
        videoVersionMatch: true,
        recoveryEpoch: 0,
        generations: { [f.media.id]: target.generation },
      },
    },
  });
  const subtitleOperation = await cluster.database.operation.create({
    data: {
      kind: "install_subtitle",
      payload: { subtitleId: subtitle.id, recoveryEpoch: 0 },
    },
  });
  expect(
    await activities.installMediaSubtitles({
      subtitleId: subtitle.id,
      operationId: subtitleOperation.id,
    }),
  ).toEqual({ status: "installed" });
  const installed = await cluster.database.subtitleAsset.findUniqueOrThrow({
    where: { id: subtitle.id },
  });
  expect(await activities.inspectAndStageMedia(upgraded.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(upgraded.input)).toEqual({
    status: "published",
  });
  expect(
    await readFile(
      nodePath.join(f.roots.library, original.entry.libraryPath),
      "utf8",
    ),
  ).toBe(upgraded.content);
  await expect(access(installed.path ?? "")).rejects.toThrow();
  const rollback = { ...upgraded.input, operationId: crypto.randomUUID() };
  expect(await activities.rollbackMediaPromotion(rollback)).toEqual({
    status: "rolled_back",
  });
  expect(await activities.rollbackMediaPromotion(rollback)).toEqual({
    status: "rolled_back",
  });
  expect(
    await readFile(
      nodePath.join(f.roots.library, original.entry.libraryPath),
      "utf8",
    ),
  ).toBe(original.content);
  expect(await readFile(installed.path ?? "", "utf8")).toContain(
    "Hello there.",
  );
  expect(
    subtitleAccepted({
      subtitle: await cluster.database.subtitleAsset.findUniqueOrThrow({
        where: { id: subtitle.id },
      }),
      asset: await cluster.database.libraryAsset.findUniqueOrThrow({
        where: { id: original.entry.assetId },
      }),
      epoch: 0,
    }),
  ).toBe(true);
  expect(
    await cluster.database.assetCoverage.findUniqueOrThrow({
      where: {
        assetId_mediaId: {
          assetId: original.entry.assetId,
          mediaId: f.media.id,
        },
      },
    }),
  ).toMatchObject({ current: true });
});

test("quarantine and restore preserve exact content and invalidated deletion stays protected", async () => {
  const f = await fixture();
  const original = await f.published();
  const retention = await f.retention();
  const activities = createMediaFileActivities(f.context);
  expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
    status: "quarantined",
  });
  await expect(
    access(nodePath.join(f.roots.library, original.entry.libraryPath)),
  ).rejects.toThrow();
  const intent = await cluster.database.mediaIntent.update({
    where: targetWhere(defaultScope(f.media.id)),
    data: { generation: { increment: 1 } },
  });
  const operation = await cluster.database.operation.create({
    data: {
      kind: "restore_media",
      payload: { mediaId: f.media.id, generation: intent.generation },
    },
  });
  expect(
    await activities.restoreMediaFiles({
      mediaId: f.media.id,
      operationId: operation.id,
    }),
  ).toEqual({ status: "restored" });
  expect(
    await activities.restoreMediaFiles({
      mediaId: f.media.id,
      operationId: operation.id,
    }),
  ).toEqual({ status: "restored" });
  expect(
    await readFile(
      nodePath.join(f.roots.library, original.entry.libraryPath),
      "utf8",
    ),
  ).toBe(original.content);
  expect(
    await activities.purgeMediaFiles({
      ...retention.input,
      operationId: crypto.randomUUID(),
    }),
  ).toMatchObject({ status: "protected" });
});

test("stale playback evidence protects a fully watched and notified asset", async () => {
  const f = await fixture();
  await f.published();
  const retention = await f.retention();
  f.advance(61_000);
  expect(
    await createMediaFileActivities(f.context).quarantineMediaFiles(
      retention.input,
    ),
  ).toEqual({ status: "protected", reason: "evidence_stale" });
});

test("the same retention operation quarantines then purges only after seven days and fresh watch evidence", async () => {
  const f = await fixture();
  const original = await f.published();
  const retention = await f.retention();
  const activities = createMediaFileActivities(f.context);
  await activities.quarantineMediaFiles(retention.input);
  const input = retention.input;
  expect(await activities.purgeMediaFiles(input)).toEqual({
    status: "protected",
    reason: "retention_not_due",
  });
  f.advance(8 * 86_400_000);
  const timestamp = f.context.now?.();
  if (timestamp === undefined) throw new Error("Missing fixture clock");
  const decision = await cluster.database.retentionDecision.findUniqueOrThrow({
    where: { id: retention.decision.id },
  });
  const evidence = decision.evidence;
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    Array.isArray(evidence)
  )
    throw new Error("Invalid fixture evidence");
  await cluster.database.retentionDecision.update({
    where: { id: decision.id },
    data: {
      evidence: { ...evidence, authorizedAt: timestamp.toISOString() },
    },
  });
  expect(await activities.purgeMediaFiles(input)).toEqual({
    status: "protected",
    reason: "watch_unconfirmed",
  });
  await cluster.database.watchState.update({
    where: {
      userId_mediaId_edition: {
        edition: "default",
        userId: f.user.id,
        mediaId: f.media.id,
      },
    },
    data: { observedAt: timestamp },
  });
  expect(await activities.purgeMediaFiles(input)).toMatchObject({
    status: "protected",
    reason: "warning_unconfirmed",
  });
  await cluster.database.notificationDelivery.updateMany({
    where: { event: { mediaId: f.media.id }, userId: f.user.id },
    data: { reconciledAt: timestamp },
  });
  expect(await activities.purgeMediaFiles(input)).toEqual({
    status: "purged",
  });
  expect(await activities.purgeMediaFiles(input)).toEqual({
    status: "purged",
  });
  expect(
    await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { id: original.entry.assetId },
    }),
  ).toMatchObject({ state: "purged" });
});

test("a missing accepted warning and a changed runtime epoch each protect files", async () => {
  const f = await fixture();
  await f.published();
  const retention = await f.retention();
  const activities = createMediaFileActivities(f.context);
  await cluster.database.notificationDelivery.updateMany({
    where: { userId: f.user.id },
    data: { state: "unknown", acceptedAt: null },
  });
  expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
    status: "protected",
    reason: "warning_unconfirmed",
  });
  await cluster.database.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  expect(await activities.quarantineMediaFiles(retention.input)).toEqual({
    status: "protected",
    reason: "runtime_protected",
  });
});

test("only an authenticated owner confirmation bypasses watch and notification grace", async () => {
  const f = await fixture();
  const published = await f.published();
  const db = cluster.database;
  await db.mediaUser.update({
    where: { id: f.user.id },
    data: { role: "owner" },
  });
  const media = await db.mediaItem.update({
    where: { id: f.media.id },
    data: { version: { increment: 1 } },
  });
  const intent = await db.mediaIntent.update({
    where: targetWhere(defaultScope(media.id)),
    data: { desiredPresence: false, generation: 1 },
  });
  const ownerOverride = {
    media: [
      {
        id: media.id,
        title: media.title,
        version: media.version,
        generation: intent.generation,
      },
    ],
    assets: [
      {
        id: published.entry.assetId,
        version: 0,
        checksum: published.entry.checksum,
      },
    ],
    ownerId: f.user.id,
  };
  const operation = await db.operation.create({
    data: {
      kind: "retain_media",
      userId: null,
      payload: {
        action: "remove",
        mediaId: media.id,
        generation: intent.generation,
        ownerOverride,
      },
    },
  });
  const timestamp = f.context.now?.();
  if (timestamp === undefined) throw new Error("Missing fixture clock");
  const decision = await db.retentionDecision.create({
    data: {
      mediaId: media.id,
      generation: intent.generation,
      state: "grace_period",
      graceUntil: timestamp,
      evidence: {
        ownerOverride: { ...ownerOverride, operationId: operation.id },
        authorizedAt: timestamp.toISOString(),
        activePlayback: false,
        recoveryEpoch: 0,
      },
    },
  });
  const input = { decisionId: decision.id, operationId: operation.id };
  const activities = createMediaFileActivities(f.context);
  expect(await activities.quarantineMediaFiles(input)).toEqual({
    status: "protected",
    reason: "owner_override_invalid",
  });
  await db.operation.update({
    where: { id: operation.id },
    data: { userId: f.user.id },
  });
  expect(await activities.quarantineMediaFiles(input)).toEqual({
    status: "quarantined",
  });
  expect(
    await activities.purgeMediaFiles({
      ...input,
      operationId: crypto.randomUUID(),
    }),
  ).toEqual({ status: "protected", reason: "retention_not_due" });
});

test("embedded extraction validates actual ffmpeg text tracks before provider fallback", async () => {
  const f = await fixture();
  await cluster.database.mediaRequest.update({
    where: { id: f.request.id },
    data: { subtitleLanguages: ["en", "zh-Hans"] },
  });
  const english = nodePath.join(f.roots.downloads, "english.srt");
  const chinese = nodePath.join(f.roots.downloads, "chinese.srt");
  await writeFile(
    english,
    "1\n00:00:00,000 --> 00:00:01,000\nHello from this exact video.\n",
  );
  await writeFile(
    chinese,
    "1\n00:00:00,000 --> 00:00:01,000\n這個測試字幕給我們。\n",
  );
  const source = nodePath.join(f.roots.downloads, "embedded.mkv");
  await runMediaTool(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=16x16:d=1",
      "-i",
      english,
      "-i",
      chinese,
      "-map",
      "0:v",
      "-map",
      "1:s",
      "-map",
      "2:s",
      "-c:v",
      "mpeg4",
      "-c:s",
      "srt",
      "-metadata:s:s:0",
      "language=eng",
      "-metadata:s:s:1",
      "language=chi",
      source,
    ],
    { maxBytes: 1024, timeoutMs: 30_000 },
  );
  const probe = await inspectMedia(source);
  const staged = await stageEmbedded({
    context: f.context,
    kind: "movies",
    source,
    probe,
    mediaIds: [f.media.id],
    assetId: crypto.randomUUID(),
  });
  expect(staged.subtitles).toHaveLength(1);
  expect(staged.subtitles[0]?.language).toBe("en");
  expect(staged.rejectedStreams).toHaveLength(1);
  expect(
    await readFile(
      nodePath.join(f.roots.control, staged.subtitles[0]?.relativePath ?? ""),
      "utf8",
    ),
  ).toContain("Hello from this exact video.");
});

test("an already owned release is not replaced by an equal-quality season candidate", async () => {
  const f = await fixture();
  await f.published();
  const acquired = await f.acquisition("Another release at the same quality");
  expect(
    await createMediaFileActivities(f.context).inspectAndStageMedia(
      acquired.input,
    ),
  ).toEqual({
    status: "blocked",
    reason: "measured_upgrade_rejected:no_improvement",
  });
});
