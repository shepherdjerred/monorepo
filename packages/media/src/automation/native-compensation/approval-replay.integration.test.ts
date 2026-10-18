import { afterEach, beforeEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeCompensationFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>> | undefined;
beforeEach(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
  );
  await fixture.prepare();
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test.each(["restricted", "demoted"])(
  "lost approval ACK remains an exact readback after the approver is %s",
  async (change) => {
    const f = fixture;
    if (f === undefined) throw new Error("Approval fixture missing");
    const db = harness.database();
    const input = await f.apply();
    const receipt = await db.nativeRecoveryReceipt.findUniqueOrThrow({
      where: { planId: f.input.planId },
    });
    const continuation =
      await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: input.continuationId },
      });
    const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const holds = await db.recoveryHold.findMany({
      where: { mediaId: { in: continuation.mediaIds } },
      orderBy: { mediaId: "asc" },
    });
    const approval = await db.operation.findUniqueOrThrow({
      where: {
        idempotencyKey: `native-compensation-apply:${receipt.planId}:${receipt.planHash}`,
      },
    });
    await db.mediaUser.update({
      where: { id: f.prior.actor.id },
      data: change === "restricted" ? { restricted: true } : { role: "member" },
    });
    await expect(
      f.activities.applyNativeCompensationFiles({
        planId: receipt.planId,
        operationId: approval.id,
        planHash: receipt.planHash,
      }),
    ).resolves.toBeUndefined();
    expect(
      await db.nativeRecoveryReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
      }),
    ).toEqual(receipt);
    expect(
      await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: continuation.id },
      }),
    ).toEqual(continuation);
    expect(
      await db.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      }),
    ).toEqual(runtime);
    expect(
      await db.recoveryHold.findMany({
        where: { mediaId: { in: continuation.mediaIds } },
        orderBy: { mediaId: "asc" },
      }),
    ).toEqual(holds);
  },
);

test("revoking an approver before the first physical grant still rejects without a receipt or runtime activation", async () => {
  const f = fixture;
  if (f === undefined) throw new Error("Approval fixture missing");
  const db = harness.database();
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: f.input.planId },
  });
  const approved = await f.service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    plan.id,
    {
      expectedVersion: plan.version,
      planHash: z.string().parse(plan.planHash),
      recoveryEpoch: plan.recoveryEpoch,
      runtimeVersion: plan.runtimeVersion,
      acknowledgeCompensationOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSuccessorRetained: true,
    },
  );
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  await db.mediaUser.update({
    where: { id: f.prior.actor.id },
    data: { restricted: true },
  });
  await expect(
    f.activities.applyNativeCompensationFiles({
      planId: plan.id,
      operationId: z.uuid().parse(approved.operationId),
      planHash: z.string().parse(plan.planHash),
    }),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(
    await db.nativeRecoveryReceipt.count({ where: { planId: plan.id } }),
  ).toBe(0);
  expect(
    await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toEqual(runtime);
});
