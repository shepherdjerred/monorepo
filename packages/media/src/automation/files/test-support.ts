import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { mkdir, mkdtemp, realpath, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import type { Database } from "#infrastructure/database.ts";
import type { FileContext } from "./types.ts";
import { createMediaFileActivities } from "./activities.ts";
import { FilePlanSchema } from "./types.ts";
import {
  grantTestLease,
  grantTestRequesterAccess,
} from "#testing/authority.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import { captureMovieAttemptChoice } from "#infrastructure/movie-editions/authority.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { recordVerifiedPublication } from "#automation/reconciliation/upgrade-cleanup.ts";
import type { MediaUser } from "#generated/prisma/client.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { fixtureAcquisitionScope } from "./fixtures/acquisition.ts";

async function chooseFixtureMovie(
  db: Database,
  media: { id: string; kind: string },
  user: MediaUser,
) {
  if (media.kind !== "movie") return;
  await chooseTestMovieEdition(db, {
    actor: { ...user, role: "member" },
    mediaId: media.id,
    access: { serverMachineId: "fixture-server", movieSectionId: "1" },
  });
}

export async function fileFixture(
  db: Database,
  episode?: { seriesId: string; title?: string },
) {
  await grantTestLease(db);
  const directory = await realpath(
    await mkdtemp(nodePath.join(tmpdir(), "media-file-activity-")),
  );
  const roots = {
    downloads: nodePath.join(directory, "downloads"),
    library: nodePath.join(directory, "library"),
    control: nodePath.join(directory, "control"),
  };
  for (const root of Object.values(roots)) await mkdir(root);
  // Explicit synthetic fixture evidence; no live mount or Kubernetes attestation.
  for (const kind of ["movies", "tv"]) {
    const observedAt = new Date();
    const evidence = {
      recoveryEpoch: 0,
      pvcUid: `synthetic-${kind}`,
      volumeName: `synthetic-${kind}`,
      volumePath: roots.library,
      workerPodUid: "synthetic-files-worker",
      evidence: { source: "synthetic-file-fixture" },
      observedAt,
      expiresAt: new Date(observedAt.getTime() + 120_000),
      revokedAt: null,
    };
    await db.mediaStorageAuthority.upsert({
      where: { rootPath: `/data/${kind}` },
      create: { rootPath: `/data/${kind}`, ...evidence },
      // Native fixtures may already have an exact reviewed mount receipt. Preserve it.
      update: {},
    });
  }
  let clock = new Date();
  const context: FileContext = {
    db,
    serverMachineId: "fixture-server",
    permittedMovieSection: () => Promise.resolve("1"),
    roots: { movies: roots, tv: roots },
    now: () => clock,
    minimumFreeBytes: 0,
    enabled: {
      acquisition: () => Promise.resolve(true),
      quarantine: () => Promise.resolve(true),
      purge: () => Promise.resolve(true),
    },
    checkpoint: () => Promise.resolve(),
    publicationExecution: () => {
      const signal = new AbortController().signal;
      const wallDeadline = Date.now() + 300_000;
      const monotonicDeadline = performance.now() + 300_000;
      return {
        signal,
        checkpoint: () => Promise.resolve(),
        assertActive: () => {
          signal.throwIfAborted();
          if (
            Date.now() >= wallDeadline ||
            performance.now() >= monotonicDeadline
          )
            throw new Error("Synthetic publication invocation expired");
        },
      };
    },
    verifyStorageAuthority: () => Promise.resolve(),
    inspect: async (path) => {
      const info = await stat(path);
      return {
        streams: [
          {
            index: 0,
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 800,
          },
          {
            index: 1,
            codec_type: "audio",
            codec_name: "aac",
            tags: { language: "eng" },
          },
        ],
        format: {
          duration: "120",
          size: String(info.size),
          format_name: "matroska",
        },
      };
    },
  };
  const profile = await db.qualityProfile.create({
    data: {
      name: "Test",
      rules: {
        qualities: ["WEB-1080p", "WEB-2160p"],
        rejectedCodecs: ["unknown"],
        requiredAudioLanguages: ["en"],
        minimumBytes: 1,
        maximumBytes: 100_000,
        tagScores: {},
        cutoffQuality: "WEB-2160p",
        cutoffScore: 0,
        minimumScore: 0,
      },
    },
  });
  const media = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Test Film",
      year: 2026,
      tmdbId:
        (crypto.getRandomValues(new Uint32Array(1))[0] ?? 1) % 2_000_000_000,
      ...(episode === undefined
        ? {}
        : {
            kind: "episode",
            parentId: episode.seriesId,
            seasonNumber: 1,
            episodeNumber: 1,
            title: episode.title ?? "First Episode",
          }),
    },
  });
  await db.$transaction(async (tx) => {
    await lockDefaultScopes(tx, [defaultScope(media.id)], {
      createMissing: true,
    });
    await tx.mediaIntent.update({
      where: targetWhere(defaultScope(media.id)),
      data: {
        profileId: profile.id,
        automationEpoch: 0,
        desiredPresence: true,
        monitoring: true,
      },
    });
  });
  const user = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Test requester",
      role: "member",
    },
  });
  const request = await db.mediaRequest.create({
    data: { mediaId: media.id, userId: user.id },
  });
  await db.mediaRuntimeState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", mode: "active", ownershipConfirmed: true },
    update: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 0 },
  });
  await grantTestRequesterAccess(db, user.id, "fixture-server");
  await chooseFixtureMovie(db, media, user);

  async function acquisition(
    content = "Fixture media contents",
    mediaIds: readonly string[] = [media.id],
  ) {
    const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const intent = await db.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(media.id)),
    });
    const sponsor = await db.mediaRequest.findFirstOrThrow({
      where: { id: request.id, ...effectiveRequestWhere },
    });
    if (
      runtime.mode !== "active" ||
      !runtime.ownershipConfirmed ||
      intent.automationEpoch !== runtime.recoveryEpoch ||
      intent.editionRootId === null ||
      !intent.desiredPresence
    )
      throw new Error(
        "Fixture acquisition requires current positive target authority",
      );
    const scope = await fixtureAcquisitionScope(db, {
      mediaId: media.id,
      mediaIds,
      userId: user.id,
      epoch: runtime.recoveryEpoch,
    });
    const filename = `${media.kind === "episode" ? "Coastlines.S01E01." : ""}fixture-${crypto.randomUUID()}.mkv`;
    await writeFile(nodePath.join(roots.downloads, filename), content);
    const release = await db.releaseCandidate.create({
      data: {
        providerId: "fixture",
        providerReleaseId: crypto.randomUUID(),
        title: "Test.Film.2026.1080p.WEB-DL.H264.ENG",
        mediaIds: scope.mediaIds,
        attributes: {
          mediaIds: scope.mediaIds,
          identityConfidence: "exact",
          quality: "WEB-1080p",
          codec: "H264",
          audioLanguages: ["en"],
          sizeBytes: Buffer.byteLength(content),
          scoreTags: [],
        },
        evaluation: {},
      },
    });
    const torrent = await db.torrent.create({
      data: {
        providerId: "fixture",
        infoHash: `${crypto.randomUUID().replaceAll("-", "")}00000000`,
        owned: true,
        ownershipEpoch: runtime.recoveryEpoch,
        state: "ready",
        seedingPolicy: { kind: "public" },
        observation: {
          torrent: { progress: 1, save_path: roots.downloads },
          files: [
            {
              index: 0,
              name: filename,
              size: Buffer.byteLength(content),
              progress: 1,
            },
          ],
        },
      },
    });
    const operation = await db.operation.create({
      data: {
        idempotencyKey: crypto.randomUUID(),
        kind: "reconcile_media",
        targetId: media.id,
        userId: user.id,
        payload: {
          mediaId: media.id,
          generation: intent.generation,
          requestId: request.id,
          requestVersion: sponsor.version,
        },
      },
    });
    const movieAccess = await fileMovieAccess(context, scope.mediaIds);
    const choice =
      movieAccess === undefined
        ? {}
        : await captureMovieAttemptChoice(db, {
            sponsorRequestId: request.id,
            scope: {
              rootMediaId: media.id,
              mediaId: media.id,
              edition: "default",
            },
            access: movieAccess,
          });
    const attempt = await db.acquisitionAttempt.create({
      data: {
        ...choice,
        releaseId: release.id,
        sponsorRequestId: request.id,
        mediaIds: scope.mediaIds,
        generations: scope.generations,
        state: "ready",
        operationId: operation.id,
        torrentId: torrent.id,
        recoveryEpoch: runtime.recoveryEpoch,
        reservations: {
          create: scope.reservations,
        },
      },
    });
    return {
      attempt,
      input: { attemptId: attempt.id, operationId: attempt.operationId },
      content,
    };
  }

  async function published() {
    const acquired = await acquisition();
    const activities = createMediaFileActivities(context);
    const staged = await activities.inspectAndStageMedia(acquired.input);
    if (staged.status !== "staged")
      throw new Error(`Fixture staging failed: ${JSON.stringify(staged)}`);
    const promoted = await activities.promoteMediaFiles(acquired.input);
    if (promoted.status !== "published")
      throw new Error(
        `Fixture publication failed: ${JSON.stringify(promoted)}`,
      );
    await db.acquisitionReservation.deleteMany({
      where: { attemptId: acquired.attempt.id },
    });
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    const entry = FilePlanSchema.parse(attempt.filePlan)[0];
    if (entry === undefined) throw new Error("Missing fixture plan");
    return { ...acquired, entry };
  }

  async function retention() {
    // Explicit synthetic Plex readback precondition for retention fixtures only.
    // published() deliberately remains physical-only for unverified-publication tests.
    const coverage = await db.assetCoverage.findMany({
      where: { mediaId: media.id, edition: "default", current: true },
      include: { asset: true },
    });
    if (coverage.length !== 1 || coverage[0]?.asset.state !== "published")
      throw new Error(
        "Retention fixture requires one published physical asset",
      );
    const asset = coverage[0].asset;
    await db.$transaction(async (tx) => {
      await recordVerifiedPublication(tx, [asset.id], asset.ownershipEpoch);
      await tx.mediaItem.update({
        where: { id: media.id },
        data: {
          externalIds: {
            plexRatingKey: media.id,
            plexSectionId: episode === undefined ? "1" : "2",
          },
        },
      });
    });
    const acceptedAt = new Date(clock.getTime() - 8 * 86_400_000);
    await db.watchState.upsert({
      where: {
        userId_mediaId_edition: {
          mediaId: media.id,
          userId: user.id,
          edition: "default",
        },
      },
      create: {
        mediaId: media.id,
        userId: user.id,
        watched: true,
        observedAt: clock,
        source: "fixture",
      },
      update: { watched: true, observedAt: clock, source: "fixture" },
    });
    const event = await db.applicationEvent.create({
      data: {
        mediaId: media.id,
        kind: "removal_warning",
        payload: {},
        notifications: {
          create: {
            userId: user.id,
            channel: "email",
            state: "accepted",
            reconciledAt: clock,
            acceptedAt,
          },
        },
      },
    });
    const intent = await db.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(media.id)),
    });
    const decision = await db.retentionDecision.create({
      data: {
        mediaId: media.id,
        generation: intent.generation,
        state: "grace_period",
        warningAcceptedAt: acceptedAt,
        graceUntil: new Date(clock.getTime() - 86_400_000),
        evidence: {
          authorizedAt: clock.toISOString(),
          activePlayback: false,
          recoveryEpoch: 0,
          warningEventId: event.id,
        },
      },
    });
    return {
      decision,
      input: { decisionId: decision.id, operationId: crypto.randomUUID() },
    };
  }
  return {
    directory,
    roots,
    context,
    profile,
    media: await db.mediaItem.findUniqueOrThrow({ where: { id: media.id } }),
    user,
    request: await db.mediaRequest.findUniqueOrThrow({
      where: { id: request.id },
    }),
    acquisition,
    published,
    retention,
    advance: (milliseconds: number) => {
      clock = new Date(clock.getTime() + milliseconds);
    },
  };
}
