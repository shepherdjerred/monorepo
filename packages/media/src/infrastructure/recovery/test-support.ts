import { beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { grantTestLease } from "#testing/authority.ts";
import type { MediaActor } from "#application/auth.ts";
import { PrismaRecovery } from "./service.ts";

export function recoveryHarness() {
  let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
  let owner: MediaActor;
  let member: MediaActor;
  beforeAll(async () => {
    cluster = await startMediaTestPostgres();
    owner = await cluster.database.mediaUser.create({
      data: { plexAccountId: "100", displayName: "Owner", role: "owner" },
    });
    member = await cluster.database.mediaUser.create({
      data: { plexAccountId: "200", displayName: "Member", role: "member" },
    });
  }, 60_000);
  afterAll(async () => {
    await cluster.close();
  });
  async function fixture() {
    const db = cluster.database;
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
    for (const user of [owner, member]) {
      await db.mediaUser.update({
        where: { id: user.id },
        data: { restricted: false, role: user.role },
      });
      const permission = {
        kind: "account",
        homeUserId: null,
        serverMachineId: "fixture",
        permittedSectionIds: ["1", "2"],
        permittedMediaKinds: ["movie", "series"],
        plexRestricted: false,
        verifiedAt: new Date(),
      };
      await db.plexIdentityMapping.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...permission },
        update: permission,
      });
    }
    const media = await db.mediaItem.create({
      data: {
        kind: "movie",
        title: "Restored film",
        externalIds: { plexSectionId: "1" },
        availability: "available",
        intent: { create: { automationEpoch: 3, generation: 4 } },
        recoveryHold: {
          create: {
            recoveryEpoch: 3,
            reason: "recovery_request_history_unconfirmed",
          },
        },
      },
    });
    const claim = await db.mediaRequest.create({
      data: { userId: member.id, mediaId: media.id },
    });
    const asset = await db.libraryAsset.create({
      data: {
        path: `/fixture/${media.id}.mkv`,
        sizeBytes: 100,
        checksum: "a".repeat(64),
        owned: true,
        ownershipEpoch: 3,
        state: "published",
        properties: {},
        coverage: { create: { mediaId: media.id, current: true } },
      },
    });
    const service = new PrismaRecovery(db, "fixture");
    async function prepare() {
      const result = await service.prepare(owner, crypto.randomUUID(), {
        mediaIds: [media.id],
      });
      return service.detail(owner, z.uuid().parse(result.recoveryReviewId));
    }
    async function responses(id: string) {
      const review = await service.detail(owner, id);
      for (const user of [owner, member])
        await service.respond(user, crypto.randomUUID(), id, {
          scopeHash: review.scopeHash,
          acknowledgePending: true,
          declarations: review.scope.media.map((item) => ({
            mediaId: item.id,
            intent: "request",
          })),
        });
      return service.detail(owner, id);
    }
    return {
      db,
      owner,
      member,
      media,
      asset,
      claim,
      service,
      prepare,
      responses,
    };
  }
  return { fixture };
}

export function releaseInput(review: {
  scopeHash: string;
  responseHash: string | null;
  version: number;
}) {
  return {
    expectedVersion: review.version,
    scopeHash: review.scopeHash,
    responseHash: z.string().parse(review.responseHash),
    confirmHouseholdBaseline: true as const,
    confirmExistingPins: true as const,
    acknowledgeMissingHistory: true as const,
  };
}
