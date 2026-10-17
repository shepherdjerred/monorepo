import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { expect, test } from "vitest";
import {
  LegacyRecoveryScopeSchema,
  LegacyRespondRecoverySchema,
  RecoveryStoredResponseSchema,
} from "#shared/recovery.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { lockRecoveryScope, snapshotRecoveryScope } from "./scope.ts";
import { responseJson } from "./release.ts";
import { recoveryHarness, releaseInput } from "./test-support.ts";

const { fixture } = recoveryHarness();
test("unversioned v1 scope and response retain their original hashes and conservative self-only release", async () => {
  const f = await fixture();
  const initial = await f.db.$transaction(async (tx) => {
    await lockRecoveryScope(tx, [f.media.id]);
    const scope = LegacyRecoveryScopeSchema.parse(
      await snapshotRecoveryScope(tx, [f.media.id], "fixture", 1),
    );
    return tx.recoveryReview.create({
      data: {
        actorId: f.owner.id,
        recoveryEpoch: 3,
        runtimeVersion: 7,
        scope,
        scopeHash: snapshotHash(scope),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  });
  expect(initial.scope).not.toHaveProperty("schemaVersion");
  await f.responses(initial.id);
  const rows = await f.db.recoveryResponse.findMany({
    where: { reviewId: initial.id },
    orderBy: { userId: "asc" },
  });
  for (const row of rows) {
    const old = LegacyRespondRecoverySchema.parse(row.response);
    expect(RecoveryStoredResponseSchema.parse(row.response)).toEqual(old);
    expect(row.response).not.toHaveProperty("authority");
    expect(row.response).not.toHaveProperty("claimAcknowledgements");
  }
  const hash = snapshotHash(responseJson(rows));
  const detail = await f.service.detail(f.owner, initial.id);
  expect(detail.scopeHash).toBe(initial.scopeHash);
  expect(detail.responseHash).toBe(hash);
  await f.service.release(
    f.owner,
    crypto.randomUUID(),
    initial.id,
    releaseInput(detail),
  );
  const receipt = await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
    where: { reviewId: initial.id },
  });
  expect(receipt.claimAccounting).toBeNull();
  expect(receipt.scopeHash).toBe(initial.scopeHash);
  expect(receipt.responseHash).toBe(hash);
});

test("managed mapping revocation that holds the final identity lock invalidates waiting declaration atomically", async () => {
  const f = await fixture();
  await f.db.plexIdentityMapping.update({
    where: { userId: f.member.id },
    data: { kind: "managed", homeUserId: "managed-200", plexRestricted: true },
  });
  const initial = await f.prepare();
  const locked = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const revoke = f.db.$transaction(
    async (tx) => {
      await tx.plexIdentityMapping.update({
        where: { userId: f.member.id },
        data: { permittedSectionIds: [], version: { increment: 1 } },
      });
      locked.resolve(undefined);
      await release.promise;
    },
    { timeout: 10_000 },
  );
  await locked.promise;
  const responding = f.service.respond(
    f.owner,
    crypto.randomUUID(),
    initial.id,
    {
      subjectUserId: f.member.id,
      scopeHash: initial.scopeHash,
      acknowledgePending: true,
      declarations: [{ mediaId: f.media.id, intent: "request" }],
    },
  );
  const settled = (async () => {
    try {
      await responding;
      return null;
    } catch (error) {
      return error;
    }
  })();
  try {
    await expect
      .poll(
        async () => {
          const rows = await f.db.$queryRaw<
            { waiting: boolean }[]
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%PlexIdentityMapping%' AND pid <> pg_backend_pid()) AS waiting`;
          return rows[0]?.waiting;
        },
        { timeout: 2000 },
      )
      .toBe(true);
  } finally {
    release.resolve(undefined);
    await revoke;
  }
  expect(await settled).toMatchObject({ code: "recovery_review_changed" });
  expect(
    await f.db.recoveryResponse.count({ where: { reviewId: initial.id } }),
  ).toBe(0);
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.media.id)),
    }),
  ).toMatchObject({ releasedAt: null });
});
