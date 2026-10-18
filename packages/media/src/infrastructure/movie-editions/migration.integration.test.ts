import { expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { historicalRequestSelect } from "#infrastructure/native-recovery/historical-request.ts";
import {
  nativeHousehold,
  nativeAttempt,
  nativeJson,
} from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { chooseTestMovieEdition } from "./test-support.ts";
import { captureMovieAttemptChoice } from "./authority.ts";

test("populated021 request/attempt projections remain literal; historical NULL birth can never be attached", async () => {
  const cluster = await startMediaTestPostgres({
    migrationCeiling: "20261017002100_publication_compensation",
  });
  const db = cluster.database;
  try {
    const actor = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Historical household",
        role: "owner",
      },
    });
    await grantTestRequesterAccess(db, actor.id, "migration-server");
    const media = await db.mediaItem.create({
      data: {
        kind: "movie",
        title: "Historical choice-less movie",
        externalIds: { plexSectionId: "1" },
      },
    });
    await db.$transaction((tx) =>
      lockDefaultScopes(tx, [defaultScope(media.id)], { createMissing: true }),
    );
    const requestId = crypto.randomUUID();
    await db.$executeRaw`INSERT INTO "MediaRequest"
      ("id", "mediaId", "userId", "version", "subtitleLanguages", "createdAt", "updatedAt")
      VALUES (${requestId}::uuid, ${media.id}::uuid, ${actor.id}::uuid, 4, ARRAY['en']::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
    const request = await db.mediaRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: historicalRequestSelect,
    });
    const release = await db.releaseCandidate.create({
      data: {
        providerId: "historical",
        providerReleaseId: crypto.randomUUID(),
        title: "Historical 1080p",
        attributes: {},
        evaluation: {},
        mediaIds: [media.id],
      },
    });
    const attempt = await db.acquisitionAttempt.create({
      data: {
        releaseId: release.id,
        sponsorRequestId: request.id,
        mediaIds: [media.id],
        generations: { [media.id]: 0 },
        state: "submitted",
        operationId: crypto.randomUUID(),
        recoveryEpoch: 0,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      select: {
        id: true,
        releaseId: true,
        sponsorRequestId: true,
        mediaIds: true,
        generations: true,
        state: true,
        torrentId: true,
        operationId: true,
        coordinatorOperationId: true,
        failure: true,
        filePlan: true,
        recoveryEpoch: true,
        createdAt: true,
        identityEvidence: true,
      },
    });
    const household = await db.$transaction((tx) =>
      nativeHousehold(tx, [media.id], []),
    );
    const originalHousehold = JSON.stringify(household);
    const originalAttempt = JSON.stringify(nativeAttempt(attempt));
    const originalHash = snapshotHash(nativeJson(household));
    cluster.applyMigration("20261017002200_movie_edition_choice");
    const migratedHousehold = await db.$transaction((tx) =>
      nativeHousehold(tx, [media.id], []),
    );
    expect(JSON.stringify(migratedHousehold)).toBe(originalHousehold);
    expect(snapshotHash(nativeJson(migratedHousehold))).toBe(originalHash);
    const migrated = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    expect(JSON.stringify(nativeAttempt(migrated))).toBe(originalAttempt);
    expect(migrated).toMatchObject({
      movieEditionChoiceId: null,
      movieEditionChoiceRevision: null,
      movieEditionAuthority: null,
      createdAt: attempt.createdAt,
      identityEvidence: attempt.identityEvidence,
    });
    expect(
      await db.mediaRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).toMatchObject({
      movieEditionChoiceId: null,
      movieEditionChoiceRevision: 0,
      version: 4,
    });
    const access = { serverMachineId: "migration-server", movieSectionId: "1" };
    const chosen = await chooseTestMovieEdition(db, {
      actor,
      mediaId: media.id,
      access,
    });
    const fields = await db.$transaction((tx) =>
      captureMovieAttemptChoice(tx, {
        sponsorRequestId: request.id,
        scope: { rootMediaId: media.id, mediaId: media.id, edition: "default" },
        access,
      }),
    );
    await expect(
      db.$transaction(async (tx) => {
        await tx.acquisitionAttempt.update({
          where: { id: attempt.id },
          data: { state: "ready" },
        });
        return tx.acquisitionAttempt.update({
          where: { id: attempt.id },
          data: fields,
        });
      }),
    ).rejects.toThrow();
    expect(
      await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      }),
    ).toEqual(migrated);
    expect(chosen.result.requestId).toBe(request.id);
    const fresh = await db.acquisitionAttempt.create({
      data: {
        ...fields,
        releaseId: release.id,
        sponsorRequestId: request.id,
        mediaIds: [media.id],
        generations: {
          [media.id]: fields.movieEditionAuthority.targetGenerationAtCapture,
        },
        state: "reserved",
        operationId: crypto.randomUUID(),
        createdAt: new Date(0),
      },
    });
    const choice = await db.movieEditionChoice.findUniqueOrThrow({
      where: { id: chosen.result.choiceId },
    });
    expect(fresh.createdAt.getTime()).toBeGreaterThanOrEqual(
      choice.createdAt.getTime(),
    );
    await expect(
      db.acquisitionAttempt.create({
        data: {
          ...fields,
          movieEditionAuthority: {
            ...fields.movieEditionAuthority,
            definitionDigest: "0".repeat(64),
          },
          releaseId: release.id,
          sponsorRequestId: request.id,
          mediaIds: [media.id],
          generations: {
            [media.id]: fields.movieEditionAuthority.targetGenerationAtCapture,
          },
          state: "reserved",
          operationId: crypto.randomUUID(),
        },
      }),
    ).rejects.toThrow();
  } finally {
    await cluster.close();
  }
});
