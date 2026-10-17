import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import { nativeNetworkFixture } from "#migration/native-network/test-fixture.ts";
import { createNativeRecoveryObserver } from "#migration/native-network/producer.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import { textDigest } from "#automation/plex-exclusion/evidence.ts";
import { TorrentObservationSchema } from "#integrations/qbittorrent.ts";
import { TorrentPolicySchema } from "#integrations/qbittorrent-policy.ts";
import protocol from "#integrations/fixtures/qbittorrent-5.2.4.json";
import { PrismaNativeRecovery } from "#infrastructure/native-recovery/service.ts";
import { createNativeFileActivities } from "./activities.ts";

export async function nativeFileFixture(
  db: Database,
  cipher: CredentialCipher,
  sourceState: "seeding" | "removed" = "seeding",
) {
  const prior = await nativeNetworkFixture(db, cipher);
  const file = await fileFixture(db);
  const published = await file.published();
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { id: published.entry.assetId },
  });
  const canonicalPath = `/data/movies/${published.entry.libraryPath}`;
  await db.libraryAsset.update({
    where: { id: asset.id },
    data: { path: canonicalPath },
  });
  const policy = await db.mediaSubtitlePolicyVersion.create({
    data: {
      mediaId: file.media.id,
      version: 0,
      recoveryEpoch: 0,
      actorId: prior.actor.id,
      source: { kind: "prior_native_owner_choice" },
      rules: {
        schemaVersion: 1,
        protectedReasons: [],
        targets: [
          {
            sourceItemId: 1,
            language: "en",
            audioLanguage: "en",
            forced: false,
            hearingImpaired: "any",
            audio: "any",
          },
        ],
      },
    },
  });
  const sidecar = canonicalPath.replace(/\.[^.]+$/u, ".en.srt");
  const subtitleText = "1\n00:00:00,000 --> 00:00:01,000\nSynthetic subtitle\n";
  await writeFile(
    path.join(
      file.context.roots.movies.library,
      path.relative("/data/movies", sidecar),
    ),
    subtitleText,
  );
  const subtitle = await db.subtitleAsset.create({
    data: {
      assetId: asset.id,
      language: "en",
      providerId: "fixture",
      state: "installed",
      storageKind: "sidecar",
      qualityStatus: "accepted",
      path: sidecar,
      checksum: createHash("sha256").update(subtitleText).digest("hex"),
      videoChecksum: asset.checksum,
      videoVersion: asset.version,
      ownershipEpoch: 0,
      forced: false,
      hearingImpaired: false,
      provenance: { source: "original validated fixture" },
      matchingEvidence: { exactMediaMatch: true, videoVersionMatch: true },
    },
  });
  await db.acquisitionAttempt.update({
    where: { id: published.attempt.id },
    data: { state: "completed" },
  });
  const observation = TorrentObservationSchema.parse({
    ...TorrentPolicySchema.parse(protocol.explicitMinutes),
    ...protocol.uploads.find((item) => item.kind === "hybrid"),
    name: "Synthetic torrent",
    state: "stoppedUP",
    category: "media",
    tags: "media-owned",
    progress: 1,
    ratio: 1,
    seeding_time: 100,
    size: Number(asset.sizeBytes),
    save_path: `/downloads/media/${published.attempt.id}`,
    content_path: `/downloads/media/${published.attempt.id}/video.mkv`,
  });
  observation.infohash_v1 = createHash("sha1")
    .update(published.attempt.id)
    .digest("hex");
  observation.infohash_v2 = createHash("sha256")
    .update(published.attempt.id)
    .digest("hex");
  observation.hash = observation.infohash_v2.slice(0, 40);
  await db.torrent.update({
    where: { id: z.string().parse(asset.torrentId) },
    data: {
      state: sourceState,
      infoHash: z.string().parse(observation.infohash_v1),
      qbittorrentId: observation.hash,
      observation: { torrent: observation },
    },
  });
  await db.mediaItem.update({
    where: { id: file.media.id },
    data: {
      externalIds: { plexRatingKey: "native", plexSectionId: "1" },
      availability: "available",
    },
  });
  const item = {
    ratingKey: "native",
    title: file.media.title,
    type: "movie",
    Guid: [{ id: `tmdb://${String(file.media.tmdbId)}` }],
    Media: [
      { Part: [{ id: 1, file: canonicalPath, size: Number(asset.sizeBytes) }] },
    ],
  };
  prior.context.plex.metadata = () => Promise.resolve(item);
  prior.context.plex.libraryPage = () =>
    Promise.resolve({ total: 1, items: [item] });
  prior.context.qbittorrent.listAll = () =>
    Promise.resolve(sourceState === "removed" ? [] : [observation]);
  const recoveryId = crypto.randomUUID();
  await prepareMediaRestore(db, {
    recoveryId,
    expectedEpoch: 0,
    reason: "Published native asset fixture",
  });
  const restore = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `restore-observe:${recoveryId}` },
  });
  const proofs = await grantTestExclusionProofs(db, prior.actor.id);
  const tv = {
    library: path.join(file.directory, "tv"),
    control: path.join(file.directory, "tv-control"),
    downloads: file.context.roots.movies.downloads,
  };
  await mkdir(tv.library);
  await mkdir(tv.control);
  file.context.roots.tv = tv;
  for (const proof of proofs) {
    const roots =
      proof.libraryRoot === "/data/movies" ? file.context.roots.movies : tv;
    await writeFile(
      path.join(roots.library, ".plexignore"),
      proof.rootMarkerAfter,
    );
    await writeFile(
      path.join(roots.control, ".plexignore"),
      proof.controlMarkerAfter,
    );
  }
  file.context.verifyPlexExclusion = async (roots) => {
    const library =
      roots.library === file.context.roots.movies.library
        ? "/data/movies"
        : roots.library === tv.library
          ? "/data/tv"
          : null;
    if (library === null) throw new Error("Unknown fixture executor root");
    const proof = await requirePlexExclusionDatabaseProof(db, {
      library,
      control: `${library}/.media-control`,
    });
    if (
      textDigest(
        await readFile(path.join(roots.library, ".plexignore"), "utf8"),
      ) !== proof.rootMarkerSha256 ||
      textDigest(
        await readFile(path.join(roots.control, ".plexignore"), "utf8"),
      ) !== proof.controlMarkerSha256
    )
      throw new Error("Actual fixture exclusion marker changed");
  };
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const service = new PrismaNativeRecovery(db);
  const prepared = await service.prepare(prior.actor, crypto.randomUUID(), {
    restoreOperationId: restore.id,
    recoveryEpoch: runtime.recoveryEpoch,
    runtimeVersion: runtime.version,
    activation: "activate",
    assetIds: [asset.id],
  });
  const planId = z.uuid().parse(prepared.nativeRecoveryId);
  const context = {
    files: file.context,
    workerPodUid: z.string().parse(prior.canonical.mounts[0]?.podUid),
  };
  const observe = () => createNativeRecoveryObserver(prior.context)(planId);
  const activities = createNativeFileActivities(context);
  async function review() {
    await observe();
    await activities.prepareNativeRecoveryFiles({
      planId,
      operationId: z.uuid().parse(prepared.operationId),
    });
    const detail = await service.detail(prior.actor, planId);
    return service.apply(prior.actor, crypto.randomUUID(), planId, {
      expectedVersion: detail.version,
      planHash: z.string().parse(detail.planHash),
      recoveryEpoch: runtime.recoveryEpoch,
      runtimeVersion: runtime.version,
      acknowledgePhysicalOwnershipOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSubtitlePolicies: true,
    });
  }
  return {
    prior,
    file,
    published,
    asset,
    policy,
    subtitle,
    canonicalPath,
    observation,
    service,
    context,
    planId,
    observe,
    activities,
    review,
    runtime,
  };
}
