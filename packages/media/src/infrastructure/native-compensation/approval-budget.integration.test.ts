import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "#automation/native-compensation/test-fixture.ts";
import { compensationInvocation } from "#automation/native-compensation/execution.ts";
import { captureNativeReviewProof } from "#automation/native-recovery/plex-proof.ts";
import { approveCompensationFiles } from "#automation/native-compensation/approval.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { createNativePlexObserver } from "#migration/native-plex/review.ts";
import {
  NativeCompensationFileEvidenceSchema,
  NativeCompensationScopeSchema,
} from "#shared/native-recovery/compensation.ts";
import {
  FinishedCompensationPlexV3Schema,
  CompensationPlexSelectionV3Schema,
} from "#shared/plex-binding/native-version.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  finishCompensationPreparation,
  applyCompensationApproval,
} from "./approval.ts";
import { lockNativeCompensationScope } from "./guards.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;

beforeEach(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
  );
  // Positive control runs the actual Network and Files composition, including
  // capture, physical proof, final snapshot and writer on one invocation budget.
  await fixture.prepare();
  const plan = await harness.database().nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: fixture.input.planId },
  });
  expect(plan.state).toBe("awaiting_review");
  expect(
    FinishedCompensationPlexV3Schema.parse(plan.plan).plex.parent.operationId,
  ).toBe(fixture.input.operationId);
});

afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

async function reviewedInput(activity: {
  planId: string;
  operationId: string;
}) {
  const db = harness.database();
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: activity.planId },
  });
  const observation = await db.nativeRecoveryObservation.findFirstOrThrow({
    where: { planId: plan.id, kind: "files" },
  });
  const context = compensationInvocation(
    fixture.context,
    testCompensationExecution(),
  );
  const plex = await captureNativeReviewProof(
    context.files,
    activity,
    plan.plan,
    { execution: context.files.execution },
  );
  if (plex.kind !== "paired")
    throw new Error("Actual new review needs a paired proof");
  return {
    context,
    scope: NativeCompensationScopeSchema.parse(plan.scope),
    evidence: NativeCompensationFileEvidenceSchema.parse(observation.evidence),
    plex,
  };
}

async function durableRows() {
  const db = harness.database();
  const planId = fixture.input.planId;
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  const scope = NativeCompensationScopeSchema.parse(plan.scope);
  return {
    plan,
    observations: await db.nativeRecoveryObservation.findMany({
      where: { planId },
      orderBy: { id: "asc" },
    }),
    receipts: await db.nativeRecoveryReceipt.findMany({
      where: { planId },
      orderBy: { id: "asc" },
    }),
    continuations: await db.nativePublicationCompensationContinuation.findMany({
      where: { receipt: { planId } },
      orderBy: { id: "asc" },
    }),
    runtime: await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
    holds: await db.recoveryHold.findMany({
      where: { mediaId: { in: scope.intent.mediaIds } },
      orderBy: [{ mediaId: "asc" }, { edition: "asc" }],
    }),
    assets: await db.libraryAsset.findMany({
      where: {
        id: {
          in: scope.intent.entries.flatMap(({ entry }) => [
            entry.assetId,
            ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
          ]),
        },
      },
      orderBy: { id: "asc" },
    }),
    transition: await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: scope.transition.transitionId },
    }),
  };
}

describe(
  "actual compensation approval snapshot budget",
  { concurrent: false, shuffle: false },
  () => {
    test("actual Files preparation charges both plan reads on its one original capture counter", async () => {
      const before = await durableRows();
      const consume = vi.spyOn(
        PublicationAuthorityReadBudget.prototype,
        "consume",
      );
      try {
        await approveCompensationFiles(
          compensationInvocation(fixture.context, testCompensationExecution()),
          fixture.input,
        );
        // Actual outer plan, capture plan/command/pointer/batch, then physical-plan
        // read. The default spy delegates all real SQL and counter operations.
        expect(consume.mock.calls.slice(0, 6)).toEqual([
          [1],
          [1],
          [1],
          [1],
          [5],
          [1],
        ]);
        const original = consume.mock.contexts[0];
        expect(original).toBeInstanceOf(PublicationAuthorityReadBudget);
        expect(
          consume.mock.contexts.every((budget) => budget === original),
        ).toBe(true);
      } finally {
        consume.mockRestore();
      }
      expect(await durableRows()).toEqual(before);
    });

    test("finished preparation retry charges the exhausted supplied counter before returning", async () => {
      const input = await reviewedInput(fixture.input);
      const before = await durableRows();
      const budget = input.plex.budget;
      budget.consume(budget.take - 1);
      // Default spy delegates to the real method. A fresh hidden counter would
      // let this already-finished preparation return without charging this one.
      const consume = vi.spyOn(
        PublicationAuthorityReadBudget.prototype,
        "consume",
      );
      try {
        await expect(
          harness.database().$transaction(async (tx) => {
            await lockNativeCompensationScope(tx, input.scope);
            await finishCompensationPreparation(
              tx,
              {
                activity: fixture.input,
                scope: input.scope,
                evidence: input.evidence,
                plex: input.plex,
              },
              budget,
            );
          }),
        ).rejects.toThrow("100 total queried records");
        expect(consume.mock.calls).toEqual([[1]]);
        expect(consume.mock.contexts[0]).toBe(budget);
      } finally {
        consume.mockRestore();
      }
      expect(await durableRows()).toEqual(before);
    });

    test("fresh apply charges the same exhausted counter at the first snapshot read", async () => {
      const db = harness.database();
      const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
        where: { id: fixture.input.planId },
      });
      const planHash = z.string().parse(plan.planHash);
      const command = await fixture.service.apply(
        fixture.prior.actor,
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
      const activity = {
        planId: plan.id,
        operationId: z.uuid().parse(command.operationId),
        planHash,
      };
      await createNativePlexObserver(fixture.observerContext)(
        { planId: activity.planId, operationId: activity.operationId },
        bindingTestExecution(),
      );
      const input = await reviewedInput(activity);
      const before = await durableRows();
      const budget = input.plex.budget;
      budget.consume(budget.take - 1);
      const consume = vi.spyOn(
        PublicationAuthorityReadBudget.prototype,
        "consume",
      );
      try {
        await expect(
          db.$transaction(async (tx) => {
            await lockNativeCompensationScope(tx, input.scope);
            await applyCompensationApproval(
              tx,
              input.context,
              {
                activity,
                scope: input.scope,
                evidence: input.evidence,
                plex: input.plex,
              },
              budget,
            );
          }),
        ).rejects.toThrow("100 total queried records");
        // An eventual overflow in the paired loader is insufficient: every
        // snapshot read must already belong to this exact invocation's counter.
        expect(consume.mock.calls).toEqual([[1]]);
        expect(consume.mock.contexts[0]).toBe(budget);
      } finally {
        consume.mockRestore();
      }
      expect(await durableRows()).toEqual(before);
    });

    test("normal one-budget Files apply succeeds and immutable ACK precedes a new review", async () => {
      await fixture.apply();
      const db = harness.database();
      const receipt = await db.nativeRecoveryReceipt.findUniqueOrThrow({
        where: { planId: fixture.input.planId },
      });
      const selection = CompensationPlexSelectionV3Schema.parse(
        receipt.selection,
      );
      const before = await durableRows();
      const activity = {
        planId: receipt.planId,
        operationId: selection.plex.applied.parent.operationId,
        planHash: receipt.planHash,
      };
      const result = await db.$transaction((tx) =>
        applyCompensationApproval(
          tx,
          fixture.context,
          {
            activity,
            scope: selection.scope,
            evidence: selection.fileEvidence,
            // Exact historical ACK needs no fresh paired observation or ownership install.
          },
          new PublicationAuthorityReadBudget(),
        ),
      );
      expect(result).toBe(receipt.id);
      expect(await durableRows()).toEqual(before);
    });
  },
);
