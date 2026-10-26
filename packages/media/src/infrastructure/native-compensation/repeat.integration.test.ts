import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "#automation/native-compensation/test-fixture.ts";
import { createNativeCompensationFileActivities } from "#automation/native-compensation/activities.ts";
import { createNativePlexObserver } from "#migration/native-plex/review.ts";
import { observePairedCompensationExecution } from "#migration/native-plex/compensation.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { compensationNativePlexFixture } from "#automation/native-compensation/fixtures/native-plex.ts";
import { NativeCompensationScopeSchema } from "#shared/native-recovery/compensation.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { compensationAncestors } from "./records.ts";
import { assertCompensationEvidence } from "./plan.ts";
import { traceArchiveReadBudget } from "#infrastructure/native-archive/tests/read-budget-trace.test-support.ts";

const harness = automationTestHarness();
traceArchiveReadBudget("compensation-repeat-read-diagnostic");
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
type Fixture = Awaited<ReturnType<typeof nativeCompensationFixture>>;

async function restoreAgain(
  f: Fixture,
  previous: NativeCompensationActivityInput,
) {
  const db = harness.database();
  const recoveryId = crypto.randomUUID();
  await prepareMediaRestore(db, {
    recoveryId,
    expectedEpoch: previous.recoveryEpoch,
    reason: "Actual interrupted inverse restore",
  });
  for (const proof of await grantTestExclusionProofs(db, f.prior.actor.id)) {
    const roots =
      f.context.files.roots[
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
  const restore = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `restore-observe:${recoveryId}` },
  });
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  f.observerContext.describeWorkflow = (workflowId) => {
    expect(workflowId).toBe(`media-operation-${previous.operationId}`);
    return Promise.resolve({
      status: "FAILED",
      runId: `closed-${previous.operationId}`,
    });
  };
  const command = await f.service.prepare(f.prior.actor, crypto.randomUUID(), {
    lifecycleKind: "publication_compensation",
    transitionId: f.transition.id,
    restoreOperationId: restore.id,
    recoveryEpoch: runtime.recoveryEpoch,
    runtimeVersion: runtime.version,
    activation: "activate",
  });
  const prepare = {
    planId: z.uuid().parse(command.nativeRecoveryId),
    operationId: z.uuid().parse(command.operationId),
  };
  const activities = createNativeCompensationFileActivities(
    f.context,
    testCompensationExecution,
  );
  const pending = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: prepare.planId },
  });
  const network = await compensationNativePlexFixture(
    f.observerContext,
    NativeCompensationScopeSchema.parse(pending.scope),
  );
  const observe = createNativePlexObserver(network.context);
  await observe(prepare, bindingTestExecution());
  await activities.prepareNativeCompensationFiles(prepare);
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: prepare.planId },
  });
  const planHash = z.string().parse(plan.planHash);
  const approved = await f.service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    plan.id,
    {
      expectedVersion: plan.version,
      planHash,
      recoveryEpoch: plan.recoveryEpoch,
      runtimeVersion: plan.runtimeVersion,
      acknowledgeCompensationOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSuccessorRetained: true,
    },
  );
  const apply = {
    planId: plan.id,
    operationId: z.uuid().parse(approved.operationId),
    planHash,
  };
  await observe(apply, bindingTestExecution());
  await activities.applyNativeCompensationFiles(apply);
  const row =
    await db.nativePublicationCompensationContinuation.findFirstOrThrow({
      where: { receipt: { planId: plan.id } },
    });
  const input: NativeCompensationActivityInput = {
    schemaVersion: 1,
    continuationId: row.id,
    operationId: z.uuid().parse(row.coordinatorOperationId),
    recoveryEpoch: row.recoveryEpoch,
  };
  expect(
    await observePairedCompensationExecution(
      network.context,
      input,
      bindingTestExecution(),
    ),
  ).toEqual({ status: "ready", reason: null });
  return input;
}

async function interruptInverse(
  f: Fixture,
  input: NativeCompensationActivityInput,
  step: string,
) {
  const original = f.file.context.checkpoint;
  const failure = new Error(
    `Actual acknowledged inverse interruption: ${step}`,
  );
  f.file.context.checkpoint = async (phase) => {
    await original(phase);
    if (phase === `publication-effect-ack:${step}`) throw failure;
  };
  try {
    const activities = createNativeCompensationFileActivities(
      f.context,
      testCompensationExecution,
    );
    await expect(
      activities.compensateNativePublicationFiles(input),
    ).rejects.toBe(failure);
  } finally {
    f.file.context.checkpoint = original;
  }
  const row = await harness
    .database()
    .nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    });
  expect(row.executionEvidence).not.toBeNull();
  expect(row.completion).toBeNull();
  expect(row.fenceRelease).toBeNull();
}

describe.each([0, 1, 2])(
  "actual inverse with %i interrupted effect prefixes survives further restore",
  (restores) => {
    let initial:
      | {
          fixture: Fixture;
          input: NativeCompensationActivityInput;
          ancestors: string[];
        }
      | undefined;
    beforeEach(async () => {
      const fixture = await nativeCompensationFixture(
        harness.database(),
        harness.context().cipher,
      );
      directories.push(fixture.file.directory);
      await fixture.prepare();
      let input = await fixture.apply();
      expect(await fixture.observe(input)).toEqual({
        status: "ready",
        reason: null,
      });
      const ancestors: string[] = [];
      if (restores === 2) {
        ancestors.push(input.continuationId);
        await interruptInverse(fixture, input, "rollback_rejected_link");
        input = await restoreAgain(fixture, input);
      }
      initial = { fixture, input, ancestors };
    });
    test("one fresh restore completes only the exact acknowledged ancestry", async () => {
      const db = harness.database();
      if (initial === undefined)
        throw new Error("Actual compensation setup missing");
      const f = initial.fixture;
      let input = initial.input;
      const ids = [...initial.ancestors];
      if (restores === 0) {
        ids.push(input.continuationId);
        input = await restoreAgain(f, input);
      }
      for (const step of [
        "rollback_rejected_link",
        "rollback_stage_link",
      ].slice(restores === 2 ? 1 : 0, restores)) {
        ids.push(input.continuationId);
        await interruptInverse(f, input, step);
        input = await restoreAgain(f, input);
      }
      const chain = await compensationAncestors(db, input.continuationId);
      expect(chain.map((item) => item.row.id)).toEqual([
        input.continuationId,
        ...ids.toReversed(),
      ]);
      for (const [index, child] of chain.entries()) {
        const parent = chain[index + 1];
        if (parent === undefined) continue;
        const prefix =
          parent.descriptor.approvedFileEvidence.acknowledgedEffects;
        expect(
          child.descriptor.approvedFileEvidence.acknowledgedEffects.slice(
            0,
            prefix.length,
          ),
        ).toEqual(prefix);
        expect(
          child.descriptor.approvedFileEvidence.acknowledgedEffects
            .slice(prefix.length)
            .every((effect) => effect.continuationId === parent.row.id),
        ).toBe(true);
        if (
          child.selection.fileEvidence.acknowledgedEffects.length >
          prefix.length
        ) {
          const forged = {
            ...child.selection.fileEvidence,
            acknowledgedEffects:
              child.selection.fileEvidence.acknowledgedEffects.map(
                (effect, ordinal) =>
                  ordinal === prefix.length
                    ? { ...effect, continuationId: null }
                    : effect,
              ),
          };
          expect(() =>
            assertCompensationEvidence(
              child.descriptor.scope,
              forged,
              child.selection.networkEvidence,
              prefix,
            ),
          ).toThrow("exact transition chain");
        }
      }
      const activities = createNativeCompensationFileActivities(
        f.context,
        testCompensationExecution,
      );
      expect(await activities.compensateNativePublicationFiles(input)).toEqual({
        status: "compensated",
        reason: null,
      });
      expect(
        await readFile(workerFilePath(f.file.context, f.canonicalPath), "utf8"),
      ).toBe(f.published.content);
      expect(
        await db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: f.interrupted.attempt.id },
        }),
      ).toEqual(f.beforeRestore.attempt);
      expect(
        await db.mediaPublicationTransition.findUniqueOrThrow({
          where: { id: f.transition.id },
        }),
      ).toEqual(f.beforeRestore.transition);
      const media = await db.mediaItem.findUniqueOrThrow({
        where: { id: f.file.media.id },
      });
      expect(media.availability).toBe("importing");
      const continuation =
        await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: input.continuationId },
        });
      expect(continuation.fenceRelease).toBeNull();
    });
  },
);
