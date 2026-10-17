import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { nativeStorageFixture } from "#automation/native-recovery/test-fixture.ts";
import { PrismaNativeRecovery } from "#infrastructure/native-recovery/service.ts";
import { PrismaRecovery } from "#infrastructure/recovery/service.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { createNativeRecoveryObserver } from "#migration/native-network/producer.ts";
import { createNativeFileActivities } from "#automation/native-recovery/activities.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";

type Setup = Awaited<ReturnType<typeof nativeStorageFixture>>;

/** Real physical review and positive household release; no fixture epoch grant. */
export async function grantNativePredecessor(db: Database, setup: Setup) {
  const { prior, runtime, restore, asset } = setup;
  const service = new PrismaNativeRecovery(db);
  const prepared = await service.prepare(prior.actor, crypto.randomUUID(), {
    restoreOperationId: restore.id,
    recoveryEpoch: runtime.recoveryEpoch,
    runtimeVersion: runtime.version,
    activation: "activate",
    assetIds: [asset.id],
  });
  const input = {
    planId: z.uuid().parse(prepared.nativeRecoveryId),
    operationId: z.uuid().parse(prepared.operationId),
  };
  const observe = () =>
    createNativeRecoveryObserver(prior.context)(input.planId);
  const files = createNativeFileActivities(setup.context);
  await observe();
  await files.prepareNativeRecoveryFiles(input);
  const detail = await service.detail(prior.actor, input.planId);
  const approved = await service.apply(
    prior.actor,
    crypto.randomUUID(),
    input.planId,
    {
      expectedVersion: detail.version,
      planHash: z.string().parse(detail.planHash),
      recoveryEpoch: runtime.recoveryEpoch,
      runtimeVersion: runtime.version,
      acknowledgePhysicalOwnershipOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSubtitlePolicies: true,
    },
  );
  await observe();
  await files.applyNativeRecoveryFiles({
    planId: input.planId,
    operationId: z.uuid().parse(approved.operationId),
  });
  await releaseHousehold(db, setup);
  return db.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { planId: input.planId },
  });
}

async function releaseHousehold(db: Database, setup: Setup) {
  const { file, prior } = setup;
  const users = await db.mediaUser.findMany();
  for (const user of users) {
    const relevant = user.id === prior.actor.id || user.id === file.user.id;
    const mapping = {
      serverMachineId: "server",
      kind: "account",
      homeUserId: null,
      serverAccountId: user.plexAccountId,
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
  const service = new PrismaRecovery(db, "server");
  const prepared = await service.prepare(prior.actor, crypto.randomUUID(), {
    mediaIds: [file.media.id],
  });
  const id = z.uuid().parse(prepared.recoveryReviewId);
  const initial = await service.detail(prior.actor, id);
  if (initial.scope.blockers.length > 0)
    throw new Error(
      `Native fixture household blocked: ${JSON.stringify(initial.scope.blockers)}`,
    );
  for (const actor of [prior.actor, file.user])
    await service.respond(actor, crypto.randomUUID(), id, {
      scopeHash: initial.scopeHash,
      declarations: [{ mediaId: file.media.id, intent: "request" }],
      acknowledgePending: true,
    });
  const final = await service.detail(prior.actor, id);
  await service.release(prior.actor, crypto.randomUUID(), id, {
    expectedVersion: final.version,
    scopeHash: final.scopeHash,
    responseHash: z.string().parse(final.responseHash),
    confirmHouseholdBaseline: true,
    confirmExistingPins: true,
    acknowledgeMissingHistory: true,
  });
  file.context.serverMachineId = "server";
}

/** Fresh restore bookkeeping and exclusion proofs; old grants and file records are untouched. */
export async function restoreNativeFixtureAgain(
  db: Database,
  setup: Setup,
): Promise<Setup> {
  const priorRuntime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const recoveryId = crypto.randomUUID();
  await prepareMediaRestore(db, {
    recoveryId,
    expectedEpoch: priorRuntime.recoveryEpoch,
    reason: "Actual interrupted native-granted publication",
  });
  const proofs = await grantTestExclusionProofs(db, setup.prior.actor.id);
  for (const proof of proofs) {
    const roots =
      setup.file.context.roots[
        proof.libraryRoot === "/data/movies" ? "movies" : "tv"
      ];
    await writeFile(
      path.join(roots.library, ".plexignore"),
      proof.rootMarkerAfter,
    );
    await writeFile(
      path.join(roots.control, ".plexignore"),
      proof.controlMarkerAfter,
    );
  }
  return {
    ...setup,
    runtime: await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
    restore: await db.operation.findUniqueOrThrow({
      where: { idempotencyKey: `restore-observe:${recoveryId}` },
    }),
  };
}
