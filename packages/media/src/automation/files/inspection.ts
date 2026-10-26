import nodePath from "node:path";
import { workerFilePath } from "./paths/locations.ts";
import { ownedSubtitleSidecars } from "./subtitle-lifecycle/ownership.ts";
import { lstat, realpath } from "node:fs/promises";
import { z } from "zod";
import { inspectMedia, type MediaProbe } from "#filesystem/media-tools.ts";
import { sha256File } from "#filesystem/operations-io.ts";
import { parseReleaseName } from "#domain/release-parser.ts";
import { effectiveCandidate } from "#domain/acquisition-identity/effective.ts";
import { AcquisitionIdentitySnapshotSchema } from "#shared/acquisition/identity.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import {
  fileIdentityEvidence,
  IdentityTorrentFileSchema,
  type IdentityTorrentFile,
} from "./acquisition-identity/evidence.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import {
  FileGuardError,
  FilePlanSchema,
  GenerationsSchema,
  type FileContext,
  type FilePlanEntry,
} from "./types.ts";
import { assertAcquisition } from "./guards.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { stageAuthorizedPlan } from "./editions/staging.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { stageEmbedded } from "./embedded.ts";
import { assertMeasuredUpgrade } from "./quality-guard.ts";
import { newLibraryPath, type NamingItem } from "./library-path.ts";
import { resumeCommittedPublication } from "./committed-publication.ts";
import { measureResolvedEvidence } from "./resolved-measurement.ts";
import {
  assertObservedEdition,
  assertPlanEdition,
} from "./editions/acquisition.ts";

const ObservationSchema = z.object({
  torrent: z.object({ progress: z.literal(1), save_path: z.string() }),
  files: z.array(IdentityTorrentFileSchema),
});
type MediaFileItem = {
  id: string;
  kind: string;
  title: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  year: number | null;
};

export function fileCoverage(
  name: string,
  media: readonly MediaFileItem[],
): string[] {
  const movies = media.filter((item) => item.kind === "movie");
  if (movies.length === 1 && media.length === 1)
    return movies.map((item) => item.id);
  const parsed = parseReleaseName(nodePath.basename(name));
  if (parsed.season === null || parsed.episodes.length === 0) return [];
  const matches = media.filter(
    (item) =>
      item.kind === "episode" &&
      item.seasonNumber === parsed.season &&
      item.episodeNumber !== null &&
      parsed.episodes.includes(item.episodeNumber),
  );
  return matches.length === parsed.episodes.length
    ? matches.map((item) => item.id)
    : [];
}

export function probeAttributes(
  probe: MediaProbe,
  sourceQuality: string,
): { quality: string; codec: string; audioLanguages: string[] } {
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  if (video?.width === undefined || video.height === undefined)
    throw new FileGuardError("video_dimensions_missing");
  const width = video.width;
  const resolution =
    width >= 3800
      ? "2160p"
      : width >= 1900
        ? "1080p"
        : width >= 1200
          ? "720p"
          : "480p";
  const source = sourceQuality.replace(/-(?:2160p|1080p|720p|480p)$/u, "");
  const codecs: Record<string, string> = {
    h264: "H264",
    hevc: "HEVC",
    av1: "AV1",
  };
  const languages: Record<string, string> = {
    eng: "en",
    jpn: "ja",
    zho: "zh",
    chi: "zh",
    spa: "es",
    fre: "fr",
    fra: "fr",
    ger: "de",
    deu: "de",
    kor: "ko",
  };
  const audioLanguages = probe.streams
    .filter((stream) => stream.codec_type === "audio")
    .flatMap((stream) => {
      const code = stream.tags?.language?.toLowerCase();
      if (code === undefined) return [];
      const language =
        languages[code] ?? (/^[a-z]{2}$/u.test(code) ? code : undefined);
      return language === undefined ? [] : [language];
    });
  return {
    quality: `${source}-${resolution}`,
    codec: codecs[video.codec_name ?? ""] ?? "unknown",
    audioLanguages: [...new Set(audioLanguages)],
  };
}

export async function safeDownloadPath(
  root: string,
  savePath: string,
  name: string,
): Promise<{ relative: string; absolute: string }> {
  if (
    nodePath.isAbsolute(name) ||
    name
      .split(/[\\/]/u)
      .some((part) => part === ".." || part === "" || part === ".")
  )
    throw new FileGuardError("download_path_unsafe");
  const absolute = nodePath.resolve(savePath, name);
  const relative = nodePath.relative(root, absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(relative) ||
    (await realpath(absolute)) !== absolute ||
    (await realpath(root)) !== nodePath.resolve(root)
  )
    throw new FileGuardError("download_path_unsafe");
  const file = await lstat(absolute);
  if (!file.isFile()) throw new FileGuardError("download_not_regular");
  return { relative, absolute };
}

export async function inspectAndStage(
  initialContext: FileContext,
  attemptId: string,
): Promise<void> {
  const execution = initialContext.publicationExecution?.();
  execution?.assertActive();
  if (!(await initialContext.enabled.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  const attempt = await initialContext.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { release: true, torrent: true },
  });
  if (await resumeCommittedPublication({ context: initialContext, attemptId }))
    return;
  const context = publicationInvocation(
    initialContext,
    requirePublicationExecution(execution),
  );
  const movieAccess = await fileMovieAccess(context, attempt.mediaIds);
  const alreadyCommitted = await authorizeInspection(context, attemptId, {
    mediaIds: attempt.mediaIds,
    movieAccess,
  });
  if (alreadyCommitted) return;
  let plan =
    attempt.filePlan === null ? null : FilePlanSchema.parse(attempt.filePlan);
  if (plan === null) {
    if (attempt.torrent?.owned !== true)
      throw new FileGuardError("torrent_unowned");
    const observation = ObservationSchema.parse(attempt.torrent.observation);
    const media = await context.db.mediaItem.findMany({
      where: { id: { in: attempt.mediaIds } },
      include: { parent: { include: { parent: true } } },
    });
    const candidates = observation.files.filter(
      (file) =>
        /\.(?:mkv|mp4|m4v|avi)$/iu.test(file.name) &&
        !/(?:^|[/._ -])(?:sample|extras|featurettes|trailer)(?:[/._ -]|$)/iu.test(
          file.name,
        ),
    );
    assertCandidateCount(media, candidates.length);
    await assertObservedEdition(context.db, attempt, candidates);
    plan = [];
    for (const file of candidates)
      plan.push(
        await inspectEntry({
          context,
          attempt,
          file,
          media,
          savePath: observation.torrent.save_path,
          movieAccess,
        }),
      );
    const coverage = plan.flatMap((entry) => entry.mediaIds);
    if (
      new Set(coverage).size !== coverage.length ||
      attempt.mediaIds.some((id) => !coverage.includes(id))
    )
      throw new FileGuardError("file_coverage_incomplete");
    const committed = plan;
    plan = await context.db.$transaction(async (tx) => {
      await lockAcquisitionMedia(tx, attempt.mediaIds);
      await assertAcquisition(tx, attemptId, {
        serverMachineId: context.serverMachineId,
        movieAccess,
      });
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      await assertPlanEdition(tx, current, committed);
      if (current.filePlan !== null)
        return FilePlanSchema.parse(current.filePlan);
      await tx.acquisitionAttempt.update({
        where: { id: attemptId },
        data: { filePlan: committed, state: "validating" },
      });
      return committed;
    });
  }
  await assertPlanEdition(context.db, attempt, plan);
  await stageAuthorizedPlan(context, {
    attemptId,
    mediaIds: attempt.mediaIds,
    plan,
    movieAccess,
  });
}

type AttemptWithRelease = Prisma.AcquisitionAttemptGetPayload<{
  include: { release: true; torrent: true };
}>;

function assertCandidateCount(
  media: readonly MediaFileItem[],
  count: number,
): void {
  if (count === 0) throw new FileGuardError("video_missing");
  if (count !== 1 && media.some((item) => item.kind === "movie"))
    throw new FileGuardError("movie_files_ambiguous");
}

async function authorizeInspection(
  context: FileContext,
  attemptId: string,
  authority: { mediaIds: string[]; movieAccess: MovieChoiceAccess | undefined },
): Promise<boolean> {
  if (await resumeCommittedPublication({ context, attemptId })) return true;
  const committedWhileWaiting = await context.db.$transaction(
    async (tx) => {
      await lockAcquisitionMedia(tx, authority.mediaIds);
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      if (current.state === "imported") return true;
      await assertAcquisition(tx, attemptId, {
        serverMachineId: context.serverMachineId,
        movieAccess: authority.movieAccess,
      });
      return false;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  if (!committedWhileWaiting) return false;
  if (!(await resumeCommittedPublication({ context, attemptId })))
    throw new FileGuardError("committed_plan_changed");
  return true;
}
async function inspectEntry(input: {
  context: FileContext;
  attempt: AttemptWithRelease;
  file: IdentityTorrentFile;
  media: NamingItem[];
  savePath: string;
  movieAccess: MovieChoiceAccess | undefined;
}): Promise<FilePlanEntry> {
  const { context, attempt, file, media, savePath } = input;
  const identity =
    attempt.identityEvidence === null
      ? null
      : AcquisitionIdentitySnapshotSchema.parse(attempt.identityEvidence);
  const evidence =
    identity === null ? undefined : fileIdentityEvidence(identity, file);
  const mediaIds = evidence?.coverage ?? fileCoverage(file.name, media);
  if (mediaIds.length === 0 || file.progress !== 1)
    throw new FileGuardError("file_coverage_unconfirmed");
  const kind = media.some((item) => item.kind === "movie") ? "movies" : "tv";
  const source = await safeDownloadPath(
    context.roots[kind].downloads,
    workerFilePath(context, savePath),
    file.name,
  );
  await context.checkpoint("inspecting");
  const probe = await (context.inspect ?? inspectMedia)(source.absolute);
  if (Number(probe.format.size) !== file.size)
    throw new FileGuardError("file_size_changed");
  const attributes = PublicReleaseAttributesSchema.parse(
    attempt.release.attributes,
  );
  const original = {
    ...attributes,
    id: attempt.releaseId,
    providerId: attempt.release.providerId,
    title: attempt.release.title,
  };
  const measured = {
    ...(identity === null ? original : effectiveCandidate(original, identity)),
    ...probeAttributes(probe, attributes.quality),
    mediaIds,
    sizeBytes: file.size,
  };
  await measureResolvedEvidence({
    context,
    measured,
    filename: nodePath.basename(file.name),
  });
  const profileVersions = await assertMeasuredUpgrade(
    context.db,
    measured,
    mediaIds,
  );
  const checksum = await sha256File(source.absolute, async () => {
    await context.checkpoint("hashing");
  });
  const previous = await previousAsset(context, mediaIds);
  const libraryPath =
    previous === null
      ? newLibraryPath(
          media.filter((item) => mediaIds.includes(item.id)),
          file.name,
        )
      : nodePath.relative(
          context.roots[kind].library,
          workerFilePath(context, previous.path),
        );
  const previousSidecars = (
    previous === null ? [] : ownedSubtitleSidecars(previous)
  ).map((subtitle) => {
    if (subtitle.path === null)
      throw new FileGuardError("subtitle_path_missing");
    const subtitleChecksum = z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(subtitle.checksum);
    return {
      subtitleId: subtitle.id,
      libraryPath: nodePath.relative(
        context.roots[kind].library,
        workerFilePath(context, subtitle.path),
      ),
      checksum: subtitleChecksum,
      quarantineId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
    };
  });
  const assetId = crypto.randomUUID();
  // Member probing and hashing may outlive the original authorization. Recheck
  // the complete attempt before preparing extracted subtitle control bytes.
  await authorizeInspection(context, attempt.id, {
    mediaIds: attempt.mediaIds,
    movieAccess: input.movieAccess,
  });
  const embeddedSubtitles = await stageEmbedded({
    context,
    kind,
    source: source.absolute,
    probe,
    mediaIds,
    assetId,
  });
  return {
    ...(evidence === undefined ? {} : { identityEvidence: evidence }),
    assetId,
    mediaIds,
    generations: GenerationsSchema.parse(attempt.generations),
    libraryKind: kind,
    downloadPath: source.relative,
    libraryPath,
    checksum,
    sizeBytes: String(file.size),
    operationId: crypto.randomUUID(),
    properties: z.json().parse({
      ...measured,
      sourceQuality: attributes.quality,
      releaseId: attempt.releaseId,
      profileVersions,
      embeddedRejectedStreams: embeddedSubtitles.rejectedStreams,
    }),
    previousAssetId: previous?.id ?? null,
    previousChecksum: previous?.checksum ?? null,
    previousVersion: previous?.version ?? null,
    previousSidecars,
    embeddedSubtitles: embeddedSubtitles.subtitles,
  };
}

async function previousAsset(context: FileContext, mediaIds: string[]) {
  const coverage = await context.db.assetCoverage.findMany({
    where: { mediaId: { in: mediaIds }, edition: "default", current: true },
    include: {
      asset: {
        include: {
          coverage: { where: { current: true } },
          subtitles: { where: { state: "installed" } },
        },
      },
    },
  });
  if (coverage.length === 0) return null;
  for (const row of coverage)
    await assertDefaultPhysicalAsset(context.db, row.assetId);
  const asset = coverage[0]?.asset;
  if (
    asset === undefined ||
    !asset.owned ||
    asset.checksum === null ||
    coverage.some((value) => value.assetId !== asset.id) ||
    asset.coverage.some((value) => !mediaIds.includes(value.mediaId))
  )
    throw new FileGuardError("upgrade_coverage_conflict");
  return asset;
}

export function importDescriptor(
  entry: FilePlanEntry,
  stopAfterStaging = false,
) {
  return {
    operationId: entry.operationId,
    downloadPath: entry.downloadPath,
    libraryPath: entry.libraryPath,
    sha256: entry.checksum,
    stopAfterStaging,
    ...(entry.previousChecksum === null
      ? {}
      : { previousSha256: entry.previousChecksum }),
  };
}
import { assertDefaultPhysicalAsset } from "#infrastructure/handoff/default-edition.ts";
