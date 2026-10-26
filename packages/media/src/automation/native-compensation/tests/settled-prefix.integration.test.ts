import { afterEach, beforeEach, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { PrismaNativeRecovery } from "#infrastructure/native-recovery/service.ts";
import { createNativeFileActivities } from "#automation/native-recovery/activities.ts";
import { nativeReviewPlexFixture } from "#automation/native-recovery/fixtures/plex.ts";
import { NativePublishedScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import { restoreNativeFixtureAgain } from "#automation/native-compensation/native-grant-fixture.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "#automation/native-compensation/test-fixture.ts";
import { reconcileCompensationHousehold } from "#automation/native-compensation/fixtures/household.ts";
import { compensationPublicationContext } from "#automation/native-compensation/fixtures/publication.ts";
import { publishCompensatedMedia } from "#automation/native-compensation/publication.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>> | undefined;
beforeEach(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
    { stopAt: "sidecar_link" },
  );
  await fixture.prepare();
  const input = await fixture.apply();
  await fixture.observe(input);
  expect(
    await fixture.activities.compensateNativePublicationFiles(input),
  ).toEqual({ status: "compensated", reason: null });
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});
test("a later native review proves settled sidecar-prefix dependencies without completing the historical staged import journal", async () => {
  const f = fixture;
  if (f === undefined) throw new Error("Settled prefix fixture missing");
  const db = harness.database();
  const entry = PublicationIntentSchema.parse(f.transition.intent).entries[0];
  if (entry === undefined)
    throw new Error("Original publication entry missing");
  const journalPath = path.join(
    f.file.context.roots[entry.entry.libraryKind].control,
    "journal",
    `${entry.entry.operationId}.json`,
  );
  const originalJournal = await readFile(journalPath, "utf8");
  expect(JSON.parse(originalJournal)).toMatchObject({ phase: "staged" });
  await reconcileCompensationHousehold(db, {
    owner: f.prior.actor,
    requester: f.file.user,
    mediaIds: f.published.entry.mediaIds,
    kind: "movie",
    serverMachineId: "server",
  });
  const continuation =
    await db.nativePublicationCompensationContinuation.findFirstOrThrow({
      where: { receipt: { planId: f.input.planId } },
    });
  const publication = compensationPublicationContext(
    harness.context(),
    f.observerContext,
    { requests: [] },
  );
  expect(
    await publishCompensatedMedia(
      publication,
      {
        schemaVersion: 1,
        continuationId: continuation.id,
        operationId: z
          .uuid()
          .parse(continuation.publicationCoordinatorOperationId),
        recoveryEpoch: continuation.recoveryEpoch,
      },
      testCompensationExecution(),
    ),
  ).toEqual({ status: "available", reason: null });
  const restored = await restoreNativeFixtureAgain(db, f);
  const service = new PrismaNativeRecovery(db);
  const command = await service.prepare(f.prior.actor, crypto.randomUUID(), {
    restoreOperationId: restored.restore.id,
    recoveryEpoch: restored.runtime.recoveryEpoch,
    runtimeVersion: restored.runtime.version,
    activation: "activate",
    assetIds: [f.asset.id],
  });
  const input = {
    planId: z.uuid().parse(command.nativeRecoveryId),
    operationId: z.uuid().parse(command.operationId),
  };
  const pending = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  const network = await nativeReviewPlexFixture(
    f.prior.context,
    NativePublishedScopeSchema.parse(pending.scope),
  );
  await network.observe(input);
  await createNativeFileActivities(f.context).prepareNativeRecoveryFiles(input);
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  const scope = NativePublishedScopeSchema.parse(plan.scope);
  expect(plan.state).toBe("awaiting_review");
  if (scope.schemaVersion !== 2)
    throw new Error("Settled compensation needs explicit native v2 scope");
  expect(scope.settledCompensations).toHaveLength(1);
  const approved = await service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    input.planId,
    {
      expectedVersion: plan.version,
      planHash: z.string().parse(plan.planHash),
      recoveryEpoch: restored.runtime.recoveryEpoch,
      runtimeVersion: restored.runtime.version,
      acknowledgePhysicalOwnershipOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSubtitlePolicies: true,
    },
  );
  await network.observe({
    planId: input.planId,
    operationId: z.uuid().parse(approved.operationId),
  });
  await createNativeFileActivities(f.context).applyNativeRecoveryFiles({
    planId: input.planId,
    operationId: z.uuid().parse(approved.operationId),
  });
  expect(await readFile(journalPath, "utf8")).toBe(originalJournal);
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: f.transition.id },
    }),
  ).toEqual(f.beforeRestore.transition);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.interrupted.attempt.id },
    }),
  ).toEqual(f.beforeRestore.attempt);
});
