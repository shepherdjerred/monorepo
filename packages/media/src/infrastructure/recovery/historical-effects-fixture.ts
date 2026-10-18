import type { MediaActor } from "#application/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { grantTestLease } from "#testing/authority.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";
import { historicalRequestSelect } from "#infrastructure/native-recovery/historical-request.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { PrismaRecovery } from "./service.ts";

async function historicalHousehold(db: Database) {
  const owner: MediaActor = await db.mediaUser.create({
    data: { plexAccountId: "100", displayName: "Owner", role: "owner" },
  });
  const member: MediaActor = await db.mediaUser.create({
    data: { plexAccountId: "200", displayName: "Member", role: "member" },
  });
  for (const user of [owner, member])
    await db.plexIdentityMapping.create({
      data: {
        userId: user.id,
        kind: "account",
        homeUserId: null,
        serverMachineId: "fixture",
        permittedSectionIds: ["1", "2"],
        permittedMediaKinds: ["movie", "series"],
        plexRestricted: false,
        verifiedAt: new Date(),
      },
    });
  const media = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Restored film",
      externalIds: { plexSectionId: "1" },
      availability: "available",
    },
  });
  await createTestDefaultTarget(db, media.id, {
    automationEpoch: 0,
    generation: 1,
  });
  const requestId = crypto.randomUUID();
  await db.$executeRaw`INSERT INTO "MediaRequest"
    ("id", "mediaId", "userId", "version", "subtitleLanguages", "createdAt", "updatedAt")
    VALUES (${requestId}::uuid, ${media.id}::uuid, ${member.id}::uuid, 0, ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  const claim = await db.mediaRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: historicalRequestSelect,
  });
  return { owner, member, media, claim };
}

async function seedHistoricalEffects(
  db: Database,
  household: Awaited<ReturnType<typeof historicalHousehold>>,
) {
  const { owner, member, media, claim } = household;
  const pin = await db.retentionHold.create({
    data: { userId: owner.id, mediaId: media.id, isPin: true },
  });
  const event = await db.applicationEvent.create({
    data: { mediaId: media.id, kind: "media_available", payload: {} },
  });
  const delivery = await db.notificationDelivery.create({
    data: {
      userId: member.id,
      channel: "email",
      state: "pending",
      recoveryEpoch: 0,
      eventId: event.id,
    },
  });
  const release = await db.releaseCandidate.create({
    data: {
      providerId: "fixture",
      providerReleaseId: crypto.randomUUID(),
      title: "old",
      mediaIds: [media.id],
      attributes: {},
      evaluation: {},
    },
  });
  const attempt = await db.acquisitionAttempt.create({
    data: {
      releaseId: release.id,
      sponsorRequestId: claim.id,
      mediaIds: [media.id],
      generations: { [media.id]: 1 },
      state: "failed",
      operationId: crypto.randomUUID(),
      recoveryEpoch: 0,
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
  return { pin, delivery, originalAttempt: attempt };
}

/** Compare every original column;022's three nullable additions are the only exclusion. */
export async function originalAttemptJson(db: Database, attemptId: string) {
  const rows = await db.$queryRaw<{ row: string }[]>`SELECT
    (to_jsonb(attempt) - ARRAY['movieEditionChoiceId', 'movieEditionChoiceRevision', 'movieEditionAuthority'])::text AS row
    FROM "AcquisitionAttempt" AS attempt WHERE id = ${attemptId}::text`;
  const row = rows[0]?.row;
  if (row === undefined) throw new Error("Historical attempt missing");
  return row;
}

async function restoredHouseholdAuthority(db: Database, mediaId: string) {
  await grantTestLease(db, 3);
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: {
      mode: "active",
      ownershipConfirmed: true,
      recoveryEpoch: 3,
      version: 7,
    },
  });
  const target = await db.mediaIntent.update({
    where: targetWhere(defaultScope(mediaId)),
    data: {
      automationEpoch: 3,
      generation: 4,
      desiredPresence: true,
      monitoring: true,
    },
  });
  if (target.editionRootId === null)
    throw new Error("Historical movie lineage missing");
  await db.recoveryHold.create({
    data: {
      mediaId,
      recoveryEpoch: 3,
      reason: "recovery_request_history_unconfirmed",
    },
  });
  await db.libraryAsset.create({
    data: {
      path: `/fixture/${mediaId}.mkv`,
      editionRootId: target.editionRootId,
      sizeBytes: 100,
      checksum: "a".repeat(64),
      owned: true,
      ownershipEpoch: 3,
      state: "published",
      properties: {},
      coverage: { create: { mediaId, current: true } },
    },
  });
}

/** Seed old schema history, then migrate before exercising the current recovery service. */
export async function historicalEffectsFixture() {
  const cluster = await startMediaTestPostgres({
    migrationCeiling: "20261017002100_publication_compensation",
  });
  const db = cluster.database;
  try {
    const household = await historicalHousehold(db);
    const history = await seedHistoricalEffects(db, household);
    const beforeMigration = await originalAttemptJson(
      db,
      history.originalAttempt.id,
    );
    cluster.applyMigration("20261017002200_movie_edition_choice");
    const afterMigration = await originalAttemptJson(
      db,
      history.originalAttempt.id,
    );
    const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: history.originalAttempt.id },
    });
    const migratedClaim = await db.mediaRequest.findUniqueOrThrow({
      where: { id: household.claim.id },
      select: historicalRequestSelect,
    });
    await restoredHouseholdAuthority(db, household.media.id);
    return {
      ...household,
      ...history,
      db,
      attempt,
      migratedClaim,
      beforeMigration,
      afterMigration,
      service: new PrismaRecovery(db, "fixture"),
      close: () => cluster.close(),
    };
  } catch (error) {
    await cluster.close();
    throw error;
  }
}
