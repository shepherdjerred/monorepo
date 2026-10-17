import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { PrismaRecovery } from "#infrastructure/recovery/service.ts";
import { nativeFileFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test.each(["request", "no_longer_request"] as const)(
  "native physical receipt permits exact household %s declaration without reviving old effects",
  async (intent) => {
    const db = harness.database();
    const f = await nativeFileFixture(db, harness.context().cipher);
    directories.push(f.file.directory);
    const approved = await f.review();
    await f.observe();
    await f.activities.applyNativeRecoveryFiles({
      planId: f.planId,
      operationId: z.uuid().parse(approved.operationId),
    });
    const users = await db.mediaUser.findMany();
    for (const user of users) {
      const relevant =
        user.id === f.prior.actor.id || user.id === f.file.user.id;
      const mapping = {
        serverMachineId: "server",
        kind: "account",
        permittedSectionIds: relevant ? ["1"] : ["2"],
        permittedMediaKinds: relevant ? ["movie"] : ["series"],
        plexRestricted: false,
        verifiedAt: new Date(),
      };
      await db.plexIdentityMapping.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...mapping },
        update: { ...mapping, version: { increment: 1 } },
      });
    }
    await db.retentionHold.create({
      data: { mediaId: f.file.media.id, userId: f.prior.actor.id, isPin: true },
    });
    const service = new PrismaRecovery(db, "server");
    const prepared = await service.prepare(f.prior.actor, crypto.randomUUID(), {
      mediaIds: [f.file.media.id],
    });
    const id = z.uuid().parse(prepared.recoveryReviewId);
    const initial = await service.detail(f.prior.actor, id);
    expect(initial.scope.blockers).toEqual([]);
    expect(initial.scope.nativeReceipts).toHaveLength(1);
    expect(initial.scope.users.map((user) => user.id).sort()).toEqual(
      [f.prior.actor.id, f.file.user.id].sort(),
    );
    for (const actor of [f.prior.actor, f.file.user]) {
      await service.respond(actor, crypto.randomUUID(), id, {
        scopeHash: initial.scopeHash,
        declarations: [{ mediaId: f.file.media.id, intent }],
        acknowledgePending: true,
      });
    }
    const final = await service.detail(f.prior.actor, id);
    await service.release(f.prior.actor, crypto.randomUUID(), id, {
      expectedVersion: final.version,
      scopeHash: final.scopeHash,
      responseHash: z.string().parse(final.responseHash),
      confirmHouseholdBaseline: true,
      confirmExistingPins: true,
      acknowledgeMissingHistory: true,
    });
    expect(
      await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId: f.file.media.id },
      }),
    ).toMatchObject({
      automationEpoch: intent === "request" ? 1 : 0,
      monitoring: intent === "request",
    });
    const released = await db.recoveryHold.findUniqueOrThrow({
      where: { mediaId: f.file.media.id },
    });
    expect(released.releasedAt).not.toBeNull();
    expect(
      await db.retentionHold.findUniqueOrThrow({
        where: {
          userId_mediaId: {
            userId: f.prior.actor.id,
            mediaId: f.file.media.id,
          },
        },
      }),
    ).toMatchObject({ isPin: true });
    expect(
      await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.published.attempt.id },
      }),
    ).toMatchObject({ recoveryEpoch: 0 });
    const newWork = await db.operation.findMany({
      where: { idempotencyKey: `recovery-restore:${id}:${f.file.media.id}` },
    });
    expect(newWork).toHaveLength(intent === "request" ? 1 : 0);
  },
);
