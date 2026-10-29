import { rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "#automation/native-compensation/test-fixture.ts";
import { reconcileCompensationHousehold } from "#automation/native-compensation/fixtures/household.ts";
import { compensationPublicationContext } from "#automation/native-compensation/fixtures/publication.ts";
import { publishCompensatedMedia } from "#automation/native-compensation/publication.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import {
  assertCompensationPublicationPhaseCurrent,
  loadCompensationPublicationPhase,
} from "./phase.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let activity: NativeCompensationActivityInput;
beforeAll(async () => {
  const db = harness.database();
  fixture = await nativeCompensationFixture(db, harness.context().cipher);
  await fixture.prepare();
  const inverse = await fixture.apply();
  await fixture.observe(inverse);
  expect(
    await fixture.activities.compensateNativePublicationFiles(inverse),
  ).toEqual({ status: "compensated", reason: null });
  await reconcileCompensationHousehold(db, {
    owner: fixture.prior.actor,
    requester: fixture.file.user,
    mediaIds: fixture.published.entry.mediaIds,
    kind: "movie",
    serverMachineId: "server",
  });
  const row =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: inverse.continuationId },
    });
  activity = {
    ...inverse,
    operationId: z.uuid().parse(row.publicationCoordinatorOperationId),
  };
}, 60_000);
afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

function timing() {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  return {
    observed,
    originalFreshness: plexBindingFreshness({
      observed,
      expiresAtMs: observed.wall + 60_000,
      guards: [],
    }),
  };
}

test("a queried publication phase rejects another transaction and another budget", async () => {
  const db = harness.database();
  const budget = new PublicationAuthorityReadBudget();
  const original = timing();
  const captured = await db.$transaction(async (tx) => {
    const phase = await loadCompensationPublicationPhase(
      tx,
      activity,
      original,
      budget,
    );
    await expect(
      assertCompensationPublicationPhaseCurrent(
        tx,
        phase,
        new PublicationAuthorityReadBudget(),
      ),
    ).rejects.toThrow("another transaction/budget");
    return phase;
  });
  await expect(
    db.$transaction((tx) =>
      assertCompensationPublicationPhaseCurrent(tx, captured, budget),
    ),
  ).rejects.toThrow("another transaction/budget");
});

test("same-transaction publication callback rejects changed coordinator and rolls the injected change back", async () => {
  const db = harness.database();
  const before =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    });
  const rollback = new Error("rollback coordinator injection");
  await expect(
    db.$transaction(async (tx) => {
      const budget = new PublicationAuthorityReadBudget();
      const phase = await loadCompensationPublicationPhase(
        tx,
        activity,
        timing(),
        budget,
      );
      await tx.nativePublicationCompensationContinuation.update({
        where: { id: activity.continuationId },
        data: { publicationCoordinatorOperationId: null },
      });
      await expect(
        assertCompensationPublicationPhaseCurrent(tx, phase, budget),
      ).rejects.toMatchObject({
        reason: "compensation_fence_coordinator_changed",
      });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    }),
  ).toEqual(before);
});

test("publication callbacks retain the original invocation guard after a database await", async () => {
  const db = harness.database();
  const original = timing();
  const expired = new Error("original publication invocation expired");
  let active = true;
  await expect(
    db.$transaction(async (tx) => {
      const budget = new PublicationAuthorityReadBudget();
      const phase = await loadCompensationPublicationPhase(
        tx,
        activity,
        {
          observed: original.observed,
          originalFreshness: {
            expiresAtMs: original.originalFreshness.expiresAtMs,
            assertActive() {
              original.originalFreshness.assertActive();
              if (!active) throw expired;
            },
          },
        },
        budget,
      );
      await tx.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      active = false;
      await assertCompensationPublicationPhaseCurrent(tx, phase, budget);
    }),
  ).rejects.toBe(expired);
  const row =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    });
  expect(row.fenceRelease).toBeNull();
  expect(row.verifiedPublication).toBeNull();
});

test("actual compensated publication completes all four fresh phases within one original 100-record budget", async () => {
  const requests: string[] = [];
  const context = compensationPublicationContext(
    harness.context(),
    fixture.observerContext,
    { requests },
  );
  const counts = new Map<PublicationAuthorityReadBudget, number>();
  const observer = vi.spyOn(
    PublicationAuthorityReadBudget.prototype,
    "consume",
  );
  try {
    expect(
      await publishCompensatedMedia(
        context,
        activity,
        testCompensationExecution(),
      ),
    ).toEqual({ status: "available", reason: null });
    for (const [index, [count]] of observer.mock.calls.entries()) {
      const budget = observer.mock.contexts[index];
      if (!(budget instanceof PublicationAuthorityReadBudget))
        throw new TypeError(
          "Publication query was charged to an unknown budget",
        );
      counts.set(budget, (counts.get(budget) ?? 0) + count);
    }
  } finally {
    observer.mockRestore();
  }
  expect(counts.size).toBe(1);
  for (const [budget, count] of counts) {
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(100);
    budget.consume(100 - count);
    expect(() => budget.consume(1)).toThrow("100 total queried records");
  }
  const before = await harness
    .database()
    .nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    });
  expect(before.verifiedPublication).not.toBeNull();
  expect(before.fenceRelease).not.toBeNull();
  const requestCount = requests.length;
  context.plexAccess = () => {
    throw new Error("Exact committed ACK must precede fresh configuration");
  };
  expect(
    await publishCompensatedMedia(
      context,
      activity,
      testCompensationExecution(),
    ),
  ).toEqual({ status: "available", reason: null });
  expect(requests).toHaveLength(requestCount);
  expect(
    await harness
      .database()
      .nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: activity.continuationId },
      }),
  ).toEqual(before);
});
