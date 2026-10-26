import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { Torrent } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { visibilityPublicationContext } from "./plex.test-support.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { StoredTorrentObservationSchema } from "#integrations/qbittorrent.ts";

export async function completeTvObservation(db: Database, torrent: Torrent) {
  const raw = z.record(z.string(), z.json()).parse(torrent.observation);
  const prior = z
    .object({
      progress: z.number().min(0).max(1),
      save_path: z.string(),
    })
    .parse(raw["torrent"]);
  const members = z
    .array(z.object({ name: z.string(), size: z.number().int().nonnegative() }))
    .min(1)
    .parse(raw["files"]);
  const member = members[0];
  if (member === undefined) throw new Error("TV fixture has no torrent files");
  // Complete synthetic qBit telemetry around the actual fixture's files.
  // Preserve its exact files array, save path, bytes, progress and torrent hash.
  const observation = StoredTorrentObservationSchema.parse({
    hash: torrent.infoHash,
    infohash_v1: torrent.infoHash,
    infohash_v2: "",
    name: member.name,
    state: "stoppedUP",
    category: "media",
    tags: "fixture",
    progress: prior.progress,
    ratio: { kind: "finite", value: 0 },
    seeding_time: 0,
    size: members.reduce((total, file) => total + file.size, 0),
    save_path: prior.save_path,
    content_path: path.join(prior.save_path, member.name),
    ratio_limit: -1,
    seeding_time_limit: -1,
    inactive_seeding_time_limit: -1,
    max_ratio: -1,
    max_seeding_time: -1,
    max_inactive_seeding_time: -1,
    share_limit_action: "Stop",
    auto_tmm: false,
    force_start: false,
  });
  return db.torrent.update({
    where: { id: torrent.id },
    data: {
      observation: { ...raw, torrent: observation },
      observedAt: new Date(),
    },
  });
}

async function singleTvFixture(db: Database) {
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
  return mappedPublicationFixture(db, { seriesId: series.id });
}

async function tvVisibilityFixture(db: Database, shared: boolean) {
  const file = await (shared
    ? sharedTvFileFixture(db, mappedPublicationFixture)
    : singleTvFixture(db));
  try {
    const series = await db.mediaItem.findUniqueOrThrow({
      where: { id: z.uuid().parse(file.media.parentId) },
    });
    const episodes = await db.mediaItem.findMany({
      where: { parentId: series.id, kind: "episode" },
      orderBy: { id: "asc" },
    });
    await db.mediaItem.update({
      where: { id: series.id },
      data: { externalIds: { plexSectionId: "2" } },
    });
    const sectionFor = (mediaId: string) =>
      shared && mediaId !== file.media.id ? "9" : "2";
    for (const episode of episodes)
      await db.mediaItem.update({
        where: { id: episode.id },
        data: {
          externalIds: {
            plexSectionId: sectionFor(episode.id),
            seriesTmdb: series.tmdbId,
          },
        },
      });
    if (shared)
      await db.plexIdentityMapping.update({
        where: { userId: file.user.id },
        data: { permittedSectionIds: ["1", "2", "9"] },
      });
    const acquired = await file.acquisition();
    const observedTorrent = await db.torrent.findUniqueOrThrow({
      where: { id: z.uuid().parse(acquired.attempt.torrentId) },
    });
    const torrent = await completeTvObservation(db, observedTorrent);
    const app = new PrismaMediaApplication(db, {
      keepDays: 30,
      serverMachineId: "fixture-server",
      visibilitySections: { movie: "1", series: "2" },
    });
    async function publish(network: MediaAutomationContext) {
      const activities = createMediaFileActivities(file.context);
      const staged = await activities.inspectAndStageMedia(acquired.input);
      if (staged.status !== "staged")
        throw new Error(
          `TV visibility staging failed: ${JSON.stringify(staged)}`,
        );
      const promoted = await activities.promoteMediaFiles(acquired.input);
      if (promoted.status !== "published")
        throw new Error(
          `TV visibility promotion failed: ${JSON.stringify(promoted)}`,
        );
      const coverage = await db.assetCoverage.findMany({
        where: { mediaId: { in: acquired.attempt.mediaIds }, current: true },
      });
      if (
        coverage.length !== episodes.length ||
        new Set(coverage.map((row) => row.assetId)).size !== 1
      )
        throw new Error(
          "TV visibility fixture requires complete single-file coverage",
        );
      const fixture = await visibilityPublicationContext(
        db,
        network,
        acquired.attempt.mediaIds,
      );
      const published = await createPublicationActivities(
        fixture.context,
      ).publishMediaToPlex(acquired.input);
      if (published.status !== "available")
        throw new Error(
          `TV visibility Plex publication failed: ${JSON.stringify(published)}`,
        );
      return fixture;
    }
    async function cover(actor: MediaActor) {
      const result = await app.createRequest(actor, crypto.randomUUID(), {
        mediaId: series.id,
        subtitleLanguages: [],
        includeSpecials: false,
      });
      const requestId = z.uuid().parse(result.requestId);
      const root = await db.mediaRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
      const expanded = await createCoverageActivities({
        db,
      }).expandMediaRequest({
        requestId,
        operationId: z.uuid().parse(result.operationId),
        requestVersion: root.version,
        cursor: null,
      });
      if (
        expanded.processed !== episodes.length ||
        expanded.nextCursor !== null
      )
        throw new Error("TV visibility root coverage was incomplete");
      return root;
    }
    return {
      db,
      file,
      series,
      episodes,
      media: file.media,
      member: file.user,
      request: file.request,
      attempt: acquired.attempt,
      torrent,
      app,
      publish,
      cover,
    };
  } catch (error) {
    await rm(file.directory, { recursive: true, force: true });
    throw error;
  }
}

export async function withTvVisibility(
  db: Database,
  shared: boolean,
  action: (
    fixture: Awaited<ReturnType<typeof tvVisibilityFixture>>,
  ) => Promise<void>,
) {
  const fixture = await tvVisibilityFixture(db, shared);
  try {
    await action(fixture);
  } finally {
    await rm(fixture.file.directory, { recursive: true, force: true });
  }
}
