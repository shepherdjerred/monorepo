import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { commandFixture } from "#infrastructure/editions/command-test-support.ts";
import { PrismaPlexAdministration } from "#infrastructure/plex-admin.ts";
import { CredentialCipher } from "#application/security.ts";
import { DefaultCommandResultV2Schema } from "#shared/editions/commands.ts";
import { createMediaApp, type MediaAppDependencies } from "#server/app.ts";

export async function verifyDefaultReplayHttp(
  dependencies: MediaAppDependencies,
  headers: Record<string, string>,
) {
  const cluster = await startMediaTestPostgres();
  try {
    const db = cluster.database;
    const f = await commandFixture(db, "owner");
    const managed = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Managed requester",
      },
    });
    await db.plexIdentityMapping.create({
      data: {
        userId: managed.id,
        kind: "managed",
        homeUserId: "fixture-home",
        serverMachineId: "command-server",
        serverAccountId: managed.plexAccountId,
        permittedSectionIds: ["1"],
        permittedMediaKinds: ["movie"],
        verifiedAt: new Date(),
      },
    });
    const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
    await db.credential.create({
      data: {
        userId: managed.id,
        kind: "plex",
        ciphertext: cipher.encrypt(
          JSON.stringify({ token: "fixture", serverToken: "fixture" }),
          `plex:${managed.plexAccountId}`,
        ),
      },
    });
    let refreshCalls = 0;
    const admin = new PrismaPlexAdministration(
      db,
      cipher,
      {
        resolveServerAccess: () => {
          refreshCalls++;
          return Promise.resolve({
            accountId: managed.plexAccountId,
            serverMachineId: "command-server",
            serverToken: "fixture",
            permittedSectionIds: ["1"],
            permittedMediaKinds: ["movie"],
            plexRestricted: false,
          });
        },
      },
      { serverUrl: "http://plex.fixture", serverMachineId: "command-server" },
    );
    dependencies.media = f.service;
    dependencies.plexAdmin.refreshProfileAccess = (actor, userId) =>
      admin.refreshProfileAccess(actor, userId);
    dependencies.auth.authenticate = async () => ({
      actor: await db.mediaUser.findUniqueOrThrow({
        where: { id: f.actor.id },
      }),
      csrfHash: "csrf-hash",
    });
    const app = createMediaApp(dependencies);
    const input = await f.command({
      action: "request",
      requesterUserId: managed.id,
    });
    const key = crypto.randomUUID();
    const post = (idempotencyKey = key, body: unknown = input) =>
      app.request(`/api/v2/media/${f.media.id}/commands`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      });
    const first = await post();
    expect(first.status).toBe(200);
    const original = DefaultCommandResultV2Schema.parse(await first.json());
    expect(refreshCalls).toBe(1);
    const v1Key = crypto.randomUUID();
    await f.service.createRequest(f.actor, v1Key, {
      mediaId: f.media.id,
      subtitleLanguages: [],
      includeSpecials: false,
    });
    const count = await db.operation.count({ where: { targetId: f.media.id } });
    const outboxCount = await db.outboxCommand.count();
    await db.mediaUser.update({
      where: { id: f.actor.id },
      data: { role: "member" },
    });
    const demotedReplay = await post();
    expect(demotedReplay.status).toBe(200);
    expect(await demotedReplay.json()).toEqual(original);
    const freshDemoted = await post(crypto.randomUUID());
    expect(freshDemoted.status).toBe(403);
    dependencies.requestsEnabled = () => Promise.resolve(false);
    const gatedReplay = await post();
    expect(gatedReplay.status).toBe(200);
    expect(await gatedReplay.json()).toEqual(original);
    const freshGated = await post(crypto.randomUUID());
    expect(freshGated.status).toBe(503);
    const conflict = await post(key, {
      ...input,
      command: { ...input.command, subtitleLanguages: ["zh-Hans"] },
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: "idempotency_conflict" },
    });
    const crossProtocol = await post(v1Key);
    expect(crossProtocol.status).toBe(409);
    expect(await crossProtocol.json()).toMatchObject({
      error: { code: "idempotency_conflict" },
    });
    expect(refreshCalls).toBe(1);
    expect(await db.operation.count({ where: { targetId: f.media.id } })).toBe(
      count,
    );
    expect(await db.outboxCommand.count()).toBe(outboxCount);
    expect(dependencies.onError).not.toHaveBeenCalled();
  } finally {
    await cluster.close();
  }
}
