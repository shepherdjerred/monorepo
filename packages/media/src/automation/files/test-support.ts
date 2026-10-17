import { mkdir, mkdtemp, realpath, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import type { Database } from "#infrastructure/database.ts";
import type { FileContext } from "./types.ts";
import { createMediaFileActivities } from "./activities.ts";
import { FilePlanSchema } from "./types.ts";
import { grantTestLease } from "#testing/authority.ts";

export async function fileFixture(db: Database) {
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
  let clock = new Date();
  const context: FileContext = {
    db,
    roots: { movies: roots, tv: roots },
    now: () => clock,
    minimumFreeBytes: 0,
    enabled: {
      acquisition: () => Promise.resolve(true),
      quarantine: () => Promise.resolve(true),
      purge: () => Promise.resolve(true),
    },
    checkpoint: () => Promise.resolve(),
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
      intent: { create: { profileId: profile.id, automationEpoch: 0 } },
    },
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

  async function acquisition(content = "Fixture media contents") {
    const filename = `${crypto.randomUUID()}.mkv`;
    await writeFile(nodePath.join(roots.downloads, filename), content);
    const release = await db.releaseCandidate.create({
      data: {
        providerId: "fixture",
        providerReleaseId: crypto.randomUUID(),
        title: "Test.Film.2026.1080p.WEB-DL.H264.ENG",
        mediaIds: [media.id],
        attributes: {
          mediaIds: [media.id],
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
        infoHash: crypto.randomUUID(),
        owned: true,
        ownershipEpoch: 0,
        state: "ready",
        seedingPolicy: { kind: "public" },
        observation: {
          torrent: { progress: 1, save_path: roots.downloads },
          files: [
            { name: filename, size: Buffer.byteLength(content), progress: 1 },
          ],
        },
      },
    });
    const intent = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId: media.id },
    });
    const attempt = await db.acquisitionAttempt.create({
      data: {
        releaseId: release.id,
        sponsorRequestId: request.id,
        mediaIds: [media.id],
        generations: { [media.id]: intent.generation },
        state: "ready",
        operationId: crypto.randomUUID(),
        torrentId: torrent.id,
        recoveryEpoch: 0,
        reservations: {
          create: { mediaId: media.id, generation: intent.generation },
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
    await activities.inspectAndStageMedia(acquired.input);
    await activities.promoteMediaFiles(acquired.input);
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
    const acceptedAt = new Date(clock.getTime() - 8 * 86_400_000);
    await db.watchState.create({
      data: {
        mediaId: media.id,
        userId: user.id,
        watched: true,
        observedAt: clock,
        source: "fixture",
      },
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
      where: { mediaId: media.id },
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
    media,
    user,
    request,
    acquisition,
    published,
    retention,
    advance: (milliseconds: number) => {
      clock = new Date(clock.getTime() + milliseconds);
    },
  };
}
