import { expect } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import {
  grantTestLease,
  grantTestRequesterAccess,
} from "#testing/authority.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { createMediaApp, type MediaAppDependencies } from "./app.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";

/** Real command and HTTP middleware; identity is deliberately stale across revocation. */
export async function verifyRevokedRetryHttp(
  dependencies: MediaAppDependencies,
  headers: Record<string, string>,
) {
  const cluster = await startMediaTestPostgres();
  const db = cluster.database;
  try {
    await grantTestLease(db, 2);
    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 2 },
    });
    const actor = await db.mediaUser.create({
      data: {
        plexAccountId: "900",
        displayName: "Previously authorized requester",
      },
    });
    await grantTestRequesterAccess(db, actor.id, "server");
    const media = await db.mediaItem.create({
      data: {
        kind: "movie",
        title: "Previously requested movie",
        externalIds: { plexSectionId: "1" },
      },
    });
    await createTestDefaultTarget(db, media.id, {
      automationEpoch: 1,
      generation: 4,
    });
    await db.mediaRequest.create({
      data: { mediaId: media.id, userId: actor.id },
    });
    dependencies.auth.authenticate = () =>
      Promise.resolve({
        actor,
        csrfHash: "csrf-hash",
      });
    dependencies.media = new PrismaMediaApplication(db, {
      keepDays: 30,
      serverMachineId: "server",
    });
    const app = createMediaApp(dependencies);
    const before = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
    });
    for (const restriction of [
      "restricted",
      "revoked",
      "wrong_section",
    ] as const) {
      await db.mediaUser.update({
        where: { id: actor.id },
        data: { restricted: restriction === "restricted" },
      });
      if (restriction !== "restricted")
        await new PrismaAuthStore(db).updateAccess(actor.id, {
          accountId: actor.plexAccountId,
          serverMachineId: "server",
          permittedSectionIds: restriction === "revoked" ? [] : ["2"],
          permittedMediaKinds: restriction === "revoked" ? [] : ["movie"],
          plexRestricted: false,
        });
      const response = await app.request(`/api/v1/media/${media.id}/actions`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ action: "retry", expectedVersion: 0 }),
      });
      expect(response.status).toBe(403);
      const rerequest = await app.request("/api/v1/requests", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ mediaId: media.id }),
      });
      expect(rerequest.status).toBe(403);
      expect(
        await db.mediaIntent.findUniqueOrThrow({
          where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
        }),
      ).toEqual(before);
      expect(
        await db.mediaItem.findUniqueOrThrow({ where: { id: media.id } }),
      ).toMatchObject({ version: 0 });
      expect(await db.operation.count({ where: { targetId: media.id } })).toBe(
        0,
      );
      expect(await db.outboxCommand.count()).toBe(0);
    }
    const keep = await app.request(`/api/v1/media/${media.id}/actions`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ action: "keep", expectedVersion: 0 }),
    });
    expect(keep.status).toBe(202);
    expect(
      await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: media.id, edition: "default" } },
      }),
    ).toMatchObject({ automationEpoch: 1 });
  } finally {
    await cluster.close();
  }
}
