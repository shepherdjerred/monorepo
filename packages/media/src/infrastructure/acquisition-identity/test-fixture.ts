import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { storedFilePath } from "#automation/files/paths/locations.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { PrismaNumberingAdministration } from "#infrastructure/numbering-admin.ts";
import {
  searchCandidates,
  loadProfile,
} from "#automation/acquisition-candidates.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { QbittorrentClient } from "#integrations/qbittorrent.ts";
import { StoredCandidateSchema } from "#automation/providers.ts";
const MediaOperationSchema = z.object({
  operationId: z.uuid(),
  mediaId: z.uuid(),
  generation: z.number().int().nonnegative(),
});

export async function identityFixture(
  db: Database,
  base: MediaAutomationContext,
  absolute = false,
  options: {
    releaseTitle?: string | undefined;
    fileFactory?: typeof fileFixture;
  } = {},
) {
  const { releaseTitle, fileFactory = fileFixture } = options;
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Example Show",
      year: 2020,
      tmdbId: Math.floor(Math.random() * 1_000_000_000),
      catalogState: "ready",
    },
  });
  const files = await fileFactory(db, {
    seriesId: series.id,
    title: "First episode",
  });
  await db.mediaItem.update({
    where: { id: files.media.id },
    data: { externalIds: { plexSectionId: "2", seriesTmdb: series.tmdbId } },
  });
  const actor = await db.mediaUser.update({
    where: { id: files.user.id },
    data: { role: "owner" },
  });
  const mapping = await db.plexIdentityMapping.findUniqueOrThrow({
    where: { userId: actor.id },
  });
  if (
    mapping.serverMachineId !== "fixture-server" ||
    mapping.serverAccountId !== actor.plexAccountId ||
    mapping.kind !== "account" ||
    !mapping.permittedSectionIds.includes("2") ||
    !mapping.permittedMediaKinds.includes("series") ||
    mapping.verifiedAt === null
  )
    throw new Error("Identity fixture requires its original exact TV mapping");
  await db.qualityProfileVersion.create({
    data: {
      profileId: files.profile.id,
      version: 0,
      rules: z.record(z.string(), z.json()).parse(files.profile.rules),
    },
  });
  if (absolute)
    await new PrismaNumberingAdministration(db).save(
      actor,
      crypto.randomUUID(),
      files.media.id,
      {
        expectedVersion: 0,
        absoluteNumber: 123,
        evidence: "Owner verified episode 123 corresponds to S01E01",
      },
    );
  const source = StoredCandidateSchema.parse({
    providerId: "knaben",
    providerReleaseId: crypto.randomUUID(),
    title:
      releaseTitle ??
      (absolute
        ? "Example Show - 123 1080p WEB-DL H264 ENG"
        : "Example.Show.S01E01.1080p.WEB-DL.H264.ENG"),
    sizeBytes: 20,
    infoHash: randomBytes(20).toString("hex"),
    seeders: 5,
    detailsUrl: "https://provider.fixture/details",
    download: { kind: "magnet", value: "magnet:?xt=urn:btih:placeholder" },
  });
  source.download.value = `magnet:?xt=urn:btih:${source.infoHash}`;
  await db.mediaProvider.upsert({
    where: { id: "knaben" },
    create: { id: "knaben", enabled: true, seedingPolicy: { kind: "public" } },
    update: {},
  });
  let observed: Record<string, unknown> | null = null;
  let adds = 0;
  const network: MediaAutomationContext = {
    ...base,
    providers: {
      withProvider: async (_id, callback) =>
        callback({ search: () => Promise.resolve([source]) }),
    },
    qbittorrent: new QbittorrentClient(
      {
        baseUrl: "http://qbit.fixture",
        username: "fixture",
        password: "fixture",
        category: "media",
      },
      (url, init) => {
        if (url.pathname.endsWith("/login"))
          return Promise.resolve(
            new Response(null, {
              status: 204,
              headers: { "set-cookie": "SID=fixture" },
            }),
          );
        if (url.pathname.endsWith("/info"))
          return Promise.resolve(
            Response.json(observed === null ? [] : [observed]),
          );
        if (
          !url.pathname.endsWith("/add") ||
          !(init.body instanceof URLSearchParams)
        )
          throw new Error("Unexpected identity fixture network effect");
        adds++;
        observed = {
          hash: source.infoHash,
          infohash_v1: source.infoHash,
          infohash_v2: "",
          name: source.title,
          state: "downloading",
          category: "media",
          tags: init.body.get("tags"),
          save_path: init.body.get("savepath"),
          content_path: `${String(init.body.get("savepath"))}/episode.mkv`,
          progress: 0,
          ratio: 0,
          seeding_time: 0,
          size: 20,
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
        return Promise.resolve(
          Response.json({
            added_torrent_ids: [source.infoHash],
            failure_count: 0,
            pending_count: 0,
            success_count: 1,
          }),
        );
      },
    ),
  };
  const profile = await loadProfile(db, files.media.id);
  if (profile === null) throw new Error("Identity fixture profile missing");
  await searchCandidates(network, files.media.id, profile);
  const release = await db.releaseCandidate.findUniqueOrThrow({
    where: {
      providerId_providerReleaseId: {
        providerId: source.providerId,
        providerReleaseId: source.providerReleaseId,
      },
    },
  });
  const service = new PrismaMediaApplication(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
    plexAccess: network.plexAccess,
  });
  const review = () =>
    service.identityPreview(actor, files.media.id, release.id, {
      mediaIds: [files.media.id],
    });
  async function select() {
    const preview = await review();
    const result = await service.act(
      actor,
      crypto.randomUUID(),
      files.media.id,
      {
        action: "select_release",
        releaseId: release.id,
        expectedVersion: preview.media[0]?.version ?? -1,
        identityConfirmation: {
          previewDigest: preview.previewDigest,
          candidateDigest: preview.candidateDigest,
          numberingDigest: preview.numberingDigest,
          mediaIds: preview.media.map((row) => row.id),
          reason:
            "Owner verified this exact release belongs to the selected show",
          acknowledgeIdentity: true,
        },
      },
    );
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(result.operationId) },
    });
    return MediaOperationSchema.parse(operation.payload);
  }
  async function acquire() {
    const input = await select();
    const activities = createAcquisitionActivities(network);
    const result = await activities.reconcileMediaIntent(input);
    if (result.attemptId === null)
      throw new Error(
        `No identity acquisition: ${result.reason ?? result.status}`,
      );
    const activityInput = {
      operationId: input.operationId,
      attemptId: result.attemptId,
    };
    const submitted = await activities.submitMediaTorrent(activityInput);
    if (submitted.status !== "submitted")
      throw new Error(
        `Identity submission blocked: ${submitted.reason ?? submitted.status}`,
      );
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: result.attemptId },
    });
    const filename = absolute
      ? "Example Show - 123.mkv"
      : "Example.Show.S01E01.mkv";
    await writeFile(
      path.join(files.roots.downloads, filename),
      "Fixture media bytes!",
    );
    await db.torrent.update({
      where: { id: z.string().parse(attempt.torrentId) },
      data: {
        state: "ready",
        observation: {
          torrent: {
            progress: 1,
            save_path: storedFilePath(files.context, "tv", "downloads", ""),
          },
          files: [{ index: 0, name: filename, size: 20, progress: 1 }],
        },
      },
    });
    await db.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "ready" },
    });
    return { attempt, input: activityInput, operation: input, filename };
  }
  return {
    files,
    actor,
    series,
    release,
    source,
    service,
    review,
    select,
    acquire,
    network,
    adds: () => adds,
  };
}
