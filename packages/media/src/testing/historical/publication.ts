import type { Database } from "#infrastructure/database.ts";
import {
  grantTestLease,
  grantTestRequesterAccess,
} from "#testing/authority.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { captureMovieAttemptChoice } from "#infrastructure/movie-editions/authority.ts";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import { chooseHistoricalTestMovieEdition } from "./movie-choice.ts";

/** Literal pre023 stored publication format, not a modern physical grant.
 * The real historical movie choice/attempt INSERT triggers still enforce birth.
 * No bytes, current Plex proof, or current publication authority are fabricated. */
export async function historicalPublicationFixture(db: Database) {
  await grantTestLease(db);
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 0 },
  });
  const user = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Historical member",
    },
  });
  await grantTestRequesterAccess(db, user.id, "fixture-server");
  const media = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Historical publication",
      tmdbId: 42,
      externalIds: {},
    },
  });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [{ mediaId: media.id, edition: "default" }], {
      createMissing: true,
    }),
  );
  const access = { serverMachineId: "fixture-server", movieSectionId: "1" };
  const chosen = await chooseHistoricalTestMovieEdition(db, {
    actor: { ...user, role: "member" },
    mediaId: media.id,
    access,
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
  });
  const birth = await captureMovieAttemptChoice(db, {
    sponsorRequestId: chosen.result.requestId,
    scope: { rootMediaId: media.id, mediaId: media.id, edition: "default" },
    access,
  });
  const asset = await db.libraryAsset.create({
    data: {
      path: `/data/movies/historical-${media.id}.mkv`,
      sizeBytes: 10n,
      checksum: "d".repeat(64),
      properties: {},
      editionRootId: media.id,
      state: "published",
      owned: true,
      ownershipEpoch: 0,
      coverage: { create: { mediaId: media.id, current: true } },
    },
  });
  const release = await db.releaseCandidate.create({
    data: {
      providerId: "historical",
      providerReleaseId: crypto.randomUUID(),
      title: "Literal historical source",
      attributes: {},
      evaluation: {},
      mediaIds: [media.id],
    },
  });
  const operationId = chosen.result.operationId;
  if (operationId === null)
    throw new Error("Historical default command did not queue");
  const entry = FilePlanEntrySchema.parse({
    assetId: asset.id,
    mediaIds: [media.id],
    generations: { [media.id]: target.generation },
    libraryKind: "movies",
    downloadPath: `/downloads/historical-${media.id}.mkv`,
    libraryPath: asset.path,
    checksum: asset.checksum,
    sizeBytes: String(asset.sizeBytes),
    properties: asset.properties,
    operationId,
    previousAssetId: null,
    previousChecksum: null,
    previousVersion: null,
    previousSidecars: [],
    embeddedSubtitles: [],
  });
  const attempt = await db.acquisitionAttempt.create({
    data: {
      ...birth,
      releaseId: release.id,
      sponsorRequestId: chosen.result.requestId,
      mediaIds: [media.id],
      generations: entry.generations,
      operationId,
      state: "published",
      recoveryEpoch: 0,
      filePlan: [entry],
    },
  });
  return {
    user,
    media,
    published: {
      attempt,
      entry,
      input: { operationId, attemptId: attempt.id },
    },
  };
}
