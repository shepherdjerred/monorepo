import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "#infrastructure/database.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { mappedPublicationFixture } from "./test-fixture.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";

export async function seasonPublicationFixture(db: Database, count = 26) {
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new Error("Invalid bounded season fixture count");
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Coastlines",
      year: 2026,
      tmdbId: 926_001,
    },
  });
  const f = await mappedPublicationFixture(db, { seriesId: series.id });
  const siblings = await db.mediaItem.createManyAndReturn({
    data: Array.from({ length: count - 1 }, (_, index) => ({
      kind: "episode",
      title: `Episode ${String(index + 2)}`,
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: index + 2,
    })),
  });
  const media = [f.media, ...siblings].toSorted(
    (left, right) => (left.episodeNumber ?? 0) - (right.episodeNumber ?? 0),
  );
  const mediaIds = media.map((item) => item.id);
  await db.$transaction(async (tx) => {
    await lockDefaultScopes(
      tx,
      mediaIds.map((mediaId) => defaultScope(mediaId)),
      {
        createMissing: true,
      },
    );
    await tx.mediaIntent.updateMany({
      where: { mediaId: { in: mediaIds }, edition: "default" },
      data: {
        profileId: f.profile.id,
        automationEpoch: 0,
        desiredPresence: true,
        monitoring: true,
      },
    });
    await tx.mediaRequest.createMany({
      data: siblings.map((item) => ({ mediaId: item.id, userId: f.user.id })),
    });
  });
  // The shared file fixture establishes its requester mapping before any work.
  const mapping = await db.plexIdentityMapping.findUniqueOrThrow({
    where: { userId: f.user.id },
  });
  if (
    mapping.serverMachineId !== "fixture-server" ||
    !mapping.permittedSectionIds.includes("2") ||
    !mapping.permittedMediaKinds.includes("series")
  )
    throw new Error("Season fixture requester lacks exact TV access");
  async function acquisition(content = "Actual season fixture bytes") {
    const intents = await db.mediaIntent.findMany({
      where: { mediaId: { in: mediaIds }, edition: "default" },
    });
    const releaseKey = crypto.randomUUID();
    const files = media.map((item, index) => {
      const episode = String(item.episodeNumber).padStart(2, "0");
      const episodeContent = `${content}: episode ${episode}`;
      return {
        index,
        name: `Coastlines.S01E${episode}.1080p.WEB-DL.H264.ENG.${releaseKey}.mkv`,
        size: Buffer.byteLength(episodeContent),
        progress: 1,
        content: episodeContent,
      };
    });
    await Promise.all(
      files.map((file) =>
        writeFile(path.join(f.roots.downloads, file.name), file.content),
      ),
    );
    const release = await db.releaseCandidate.create({
      data: {
        providerId: "fixture",
        providerReleaseId: crypto.randomUUID(),
        title: "Coastlines.2026.S01.1080p.WEB-DL.H264.ENG",
        mediaIds,
        attributes: {
          mediaIds,
          identityConfidence: "exact",
          quality: "WEB-1080p",
          codec: "H264",
          audioLanguages: ["en"],
          sizeBytes: files.reduce((total, file) => total + file.size, 0),
          scoreTags: [],
        },
        evaluation: {},
      },
    });
    const torrent = await db.torrent.create({
      data: {
        providerId: "fixture",
        infoHash: crypto.randomUUID(),
        owned: true,
        ownershipEpoch: 0,
        state: "ready",
        seedingPolicy: { kind: "public" },
        observation: {
          torrent: {
            progress: 1,
            save_path: storedFilePath(f.context, "tv", "downloads", ""),
          },
          files: files.map(({ content: _content, ...file }) => file),
        },
      },
    });
    const operation = await db.operation.create({
      data: {
        idempotencyKey: crypto.randomUUID(),
        kind: "reconcile_media",
        targetId: f.media.id,
        userId: f.user.id,
        payload: { requestId: f.request.id, requestVersion: f.request.version },
      },
    });
    const attempt = await db.acquisitionAttempt.create({
      data: {
        releaseId: release.id,
        sponsorRequestId: f.request.id,
        mediaIds,
        generations: Object.fromEntries(
          intents.map((intent) => [intent.mediaId, intent.generation]),
        ),
        state: "ready",
        operationId: operation.id,
        torrentId: torrent.id,
        recoveryEpoch: 0,
        reservations: {
          create: intents.map((intent) => ({
            mediaId: intent.mediaId,
            generation: intent.generation,
          })),
        },
      },
    });
    return {
      files,
      attempt,
      content,
      input: { attemptId: attempt.id, operationId: attempt.operationId },
    };
  }
  async function published() {
    const acquired = await acquisition();
    const activities = createMediaFileActivities(f.context);
    const staged = await activities.inspectAndStageMedia(acquired.input);
    if (staged.status !== "staged")
      throw new Error(`Season staging failed: ${JSON.stringify(staged)}`);
    const result = await activities.promoteMediaFiles(acquired.input);
    if (result.status !== "published")
      throw new Error(`Season publication failed: ${JSON.stringify(result)}`);
    await db.acquisitionReservation.deleteMany({
      where: { attemptId: acquired.attempt.id },
    });
    const current = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    const plan = FilePlanSchema.parse(current.filePlan);
    if (
      plan.length !== count ||
      new Set(plan.flatMap((entry) => entry.mediaIds)).size !== count
    )
      throw new Error("Season publication lost full episode coverage");
    const entry = plan[0];
    if (entry === undefined)
      throw new Error("Season publication has no primary entry");
    return { ...acquired, entry };
  }
  return { ...f, mediaIds, acquisition, published };
}
