import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { completeTvObservation } from "./tv.test-support.ts";

/** One real three-leaf attempt: a two-episode file plus an independent third file. */
export async function mixedVisibilityFixture(db: Database) {
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Coastlines",
      year: 2026,
      tmdbId:
        (z.int().parse(crypto.getRandomValues(new Uint32Array(1))[0]) %
          1_000_000_000) +
        1,
      externalIds: { plexSectionId: "2" },
    },
  });
  const file = await mappedPublicationFixture(db, { seriesId: series.id });
  try {
    const siblings = await Promise.all(
      [2, 3].map((episodeNumber) =>
        db.mediaItem.create({
          data: {
            kind: "episode",
            parentId: series.id,
            title: `Coastline ${String(episodeNumber)}`,
            seasonNumber: 1,
            episodeNumber,
          },
        }),
      ),
    );
    const mediaIds = [file.media.id, ...siblings.map((row) => row.id)].sort();
    await db.$transaction(async (tx) => {
      await lockDefaultScopes(
        tx,
        mediaIds.map((id) => defaultScope(id)),
        {
          createMissing: true,
        },
      );
      for (const sibling of siblings) {
        await tx.mediaIntent.update({
          where: { mediaId_edition: defaultScope(sibling.id) },
          data: {
            profileId: file.profile.id,
            automationEpoch: 0,
            desiredPresence: true,
            monitoring: true,
          },
        });
        await tx.mediaRequest.create({
          data: {
            mediaId: sibling.id,
            userId: file.user.id,
            sponsorRequestId: file.request.id,
          },
        });
      }
      for (const id of mediaIds)
        await tx.mediaItem.update({
          where: { id },
          data: {
            externalIds: { seriesTmdb: series.tmdbId, plexSectionId: "2" },
          },
        });
    });
    const acquired = await file.acquisition(
      "Visibility three-leaf pack",
      mediaIds,
    );
    const names = [
      `Coastlines.S01E01E02.${acquired.attempt.id}.mkv`,
      `Coastlines.S01E03.${acquired.attempt.id}.mkv`,
    ];
    for (const name of names)
      await writeFile(path.join(file.roots.downloads, name), acquired.content);
    const torrent = await db.torrent.update({
      where: { id: z.uuid().parse(acquired.attempt.torrentId) },
      data: {
        observation: {
          torrent: {
            progress: 1,
            save_path: storedFilePath(file.context, "tv", "downloads", ""),
          },
          files: names.map((name, index) => ({
            index,
            name,
            size: Buffer.byteLength(acquired.content),
            progress: 1,
          })),
        },
      },
    });
    await completeTvObservation(db, torrent);
    const activities = createMediaFileActivities(file.context);
    const staged = await activities.inspectAndStageMedia(acquired.input);
    if (staged.status !== "staged")
      throw new Error(
        `Mixed fixture staging failed: ${JSON.stringify(staged)}`,
      );
    const promoted = await activities.promoteMediaFiles(acquired.input);
    if (promoted.status !== "published")
      throw new Error(
        `Mixed fixture publication failed: ${JSON.stringify(promoted)}`,
      );
    const coverage = await db.assetCoverage.findMany({
      where: { mediaId: { in: mediaIds }, current: true },
    });
    if (
      coverage.length !== 3 ||
      new Set(coverage.map((row) => row.assetId)).size !== 2
    )
      throw new Error(
        "Mixed fixture did not produce its exact three-leaf/two-file coverage",
      );
    return { file, series, mediaIds, acquired, coverage };
  } catch (error) {
    await rm(file.directory, { recursive: true, force: true });
    throw error;
  }
}
