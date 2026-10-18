import path from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import type { NativeArchiveObserverContext } from "#migration/native-archive/evidence.ts";
import type { PlexItem } from "#integrations/plex.ts";

export function sharedTvDownloadName(attemptId: string) {
  return `Coastlines.S01E01E02.attempt-${attemptId}.mkv`;
}

/** Every A/B/C publication is produced by the actual inspection/promotion Activities. */
export async function sharedTvFileFixture(
  db: Database,
  fileFactory: typeof fileFixture = fileFixture,
) {
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Coastlines",
      year: 2026,
      tmdbId:
        1 +
        (z.int().parse(crypto.getRandomValues(new Uint32Array(1))[0]) %
          1_000_000_000),
    },
  });
  const f = await fileFactory(db, { seriesId: series.id });
  try {
    const second = await db.mediaItem.create({
      data: {
        kind: "episode",
        parentId: series.id,
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
        where: { mediaId_edition: defaultScope(second.id) },
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
    const mediaIds = [f.media.id, second.id].sort();
    async function acquisition(content?: string) {
      const acquired = await f.acquisition(content, mediaIds);
      const filename = sharedTvDownloadName(acquired.attempt.id);
      await writeFile(path.join(f.roots.downloads, filename), acquired.content);
      await db.releaseCandidate.update({
        where: { id: acquired.attempt.releaseId },
        data: {
          mediaIds,
          attributes: {
            mediaIds,
            identityConfidence: "exact",
            quality: "WEB-1080p",
            codec: "H264",
            audioLanguages: ["en"],
            sizeBytes: Buffer.byteLength(acquired.content),
            scoreTags: [],
          },
        },
      });
      await db.torrent.update({
        where: { id: z.uuid().parse(acquired.attempt.torrentId) },
        data: {
          observation: {
            torrent: { progress: 1, save_path: f.roots.downloads },
            files: [
              {
                index: 0,
                name: filename,
                size: Buffer.byteLength(acquired.content),
                progress: 1,
              },
            ],
          },
        },
      });
      return acquired;
    }
    async function published() {
      const acquired = await acquisition();
      const activities = createMediaFileActivities(f.context);
      const staged = await activities.inspectAndStageMedia(acquired.input);
      if (staged.status !== "staged")
        throw new Error(`Shared TV staging failed: ${JSON.stringify(staged)}`);
      const promoted = await activities.promoteMediaFiles(acquired.input);
      if (promoted.status !== "published")
        throw new Error(
          `Shared TV promotion failed: ${JSON.stringify(promoted)}`,
        );
      await db.acquisitionReservation.deleteMany({
        where: { attemptId: acquired.attempt.id },
      });
      const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: acquired.attempt.id },
      });
      const entry = FilePlanSchema.parse(attempt.filePlan)[0];
      if (entry?.mediaIds.length !== 2)
        throw new Error("Actual shared TV publication is incomplete");
      return { ...acquired, entry };
    }
    return { ...f, acquisition, published };
  } catch (error) {
    await rm(f.directory, { recursive: true, force: true });
    throw error;
  }
}

export async function configureArchiveTvPlex(
  db: Database,
  context: Pick<NativeArchiveObserverContext, "plex">,
  input: { mediaIds: string[]; canonicalPath: string; sizeBytes: bigint },
) {
  const media = await db.mediaItem.findMany({
    where: { id: { in: input.mediaIds } },
    include: { parent: true },
    orderBy: { id: "asc" },
  });
  const series = media[0]?.parent;
  if (
    series?.kind !== "series" ||
    series.tmdbId === null ||
    media.some((item) => item.parentId !== series.id)
  )
    throw new Error("Shared TV fixture requires one exact canonical series");
  const show: PlexItem = {
    ratingKey: "native-series",
    type: "show",
    title: series.title,
    Guid: [{ id: `tmdb://${String(series.tmdbId)}` }],
  };
  const items: PlexItem[] = [];
  for (const episode of media) {
    const ratingKey = `native-${episode.id}`;
    await db.mediaItem.update({
      where: { id: episode.id },
      data: {
        externalIds: {
          seriesTmdb: series.tmdbId,
          plexSectionId: "2",
          plexRatingKey: ratingKey,
        },
        availability: "available",
      },
    });
    items.push({
      ratingKey,
      type: "episode",
      title: episode.title,
      index: z.int().parse(episode.episodeNumber),
      parentIndex: z.int().parse(episode.seasonNumber),
      grandparentRatingKey: show.ratingKey,
      Media: [
        {
          Part: [
            {
              id: items.length + 1,
              file: input.canonicalPath,
              size: Number(input.sizeBytes),
            },
          ],
        },
      ],
    });
  }
  context.plex.sections = () =>
    Promise.resolve([
      { key: "1", title: "Movies", type: "movie" },
      { key: "2", title: "TV", type: "show" },
    ]);
  context.plex.metadata = (key) => {
    const item =
      key === show.ratingKey
        ? show
        : items.find((candidate) => candidate.ratingKey === key);
    return item === undefined
      ? Promise.reject(new Error("Unexpected fixture Plex key"))
      : Promise.resolve(item);
  };
  context.plex.libraryPage = ({ sectionId }) =>
    Promise.resolve(
      sectionId === "2"
        ? { total: items.length, items }
        : { total: 0, items: [] },
    );
}
