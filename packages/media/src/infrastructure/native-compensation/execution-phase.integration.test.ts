import { rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeCompensationFixture } from "#automation/native-compensation/test-fixture.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { loadNativeCompensationPlexPhase } from "#infrastructure/plex-binding/native/native-parent.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import type { NativePlexProofRef } from "#shared/plex-binding/native.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { NativeCompensationExecutionSchema } from "#shared/native-recovery/compensation.ts";
import { assertCompensationPhaseCurrent } from "./guards.ts";
import { persistCompensationPhaseExecution } from "./completion.ts";
import { readCompletedNativeCompensationState } from "./state.ts";
import { proofQueryAudit } from "#infrastructure/plex-binding/native/query-budget.test-support.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let activity: NativeCompensationActivityInput;
let ref: NativePlexProofRef;
let freshness: PlexBindingFreshness;
beforeAll(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
  );
  await fixture.prepare();
  activity = await fixture.apply();
  await fixture.observe(activity);
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const initial = plexBindingFreshness({
    observed,
    expiresAtMs: observed.wall + 60_000,
    guards: [],
  });
  const captured = await harness
    .database()
    .$transaction((tx) =>
      loadNativeCompensationPlexPhase(
        tx,
        activity,
        { freshness: initial },
        new PublicationAuthorityReadBudget(),
      ),
    );
  if (captured.proof === null)
    throw new Error("Actual compensation unexpectedly completed");
  ref = captured.proof.ref;
  freshness = plexBindingFreshness({
    observed,
    expiresAtMs: captured.proof.expiresAtMs,
    guards: [initial],
  });
}, 60_000);
afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test("three fresh actual compensation phases and an execution CAS preserve the invocation's exact 100-record boundary", async () => {
  const db = harness.database();
  const budget = new PublicationAuthorityReadBudget();
  // Admission prefix plus ACK1, three independently measured21-row phases and CAS1.
  budget.consume(35);
  expect(
    await db.$transaction((tx) =>
      readCompletedNativeCompensationState(tx, activity, budget),
    ),
  ).toBeNull();
  for (const index of [0, 1, 2]) {
    await db.$transaction(async (tx) => {
      const audit = proofQueryAudit(tx);
      const admittedBefore = 101 - budget.take;
      try {
        const current = await loadNativeCompensationPlexPhase(
          tx,
          activity,
          { freshness, expectedRef: ref },
          budget,
        );
        expect(current.proof?.ref).toEqual(ref);
        if (index === 1) {
          const authority = current.phase.authority;
          const execution = NativeCompensationExecutionSchema.parse({
            schemaVersion: 1,
            continuationId: activity.continuationId,
            descriptorHash: authority.descriptorHash,
            recoveryEpoch: activity.recoveryEpoch,
            transition: authority.descriptor.scope.transition,
            effectPrefixHash:
              authority.descriptor.approvedFileEvidence.effectPrefixHash,
            participants:
              authority.descriptor.approvedFileEvidence.participants,
          });
          const version = authority.version;
          await persistCompensationPhaseExecution(
            tx,
            { activity, execution },
            current.phase,
            { freshness, budget },
          );
          expect(current.phase.authority.version).toBe(version + 1);
          expect(current.phase.authority.execution).toEqual(execution);
          await assertCompensationPhaseCurrent(tx, current.phase);
        }
        const returned = await audit.returned();
        expect(returned).toBe(index === 1 ? 22 : 21);
        expect(101 - budget.take - admittedBefore).toBe(returned);
      } finally {
        audit.restore();
      }
    });
  }
  expect(() => budget.consume(1)).toThrow("100 total queried records");
  await expect(
    db.$transaction((tx) =>
      loadNativeCompensationPlexPhase(
        tx,
        activity,
        { freshness, expectedRef: ref },
        budget,
      ),
    ),
  ).rejects.toThrow("100 total queried records");
});

test("a queried phase cannot authorize another transaction", async () => {
  const budget = new PublicationAuthorityReadBudget();
  const current = await harness
    .database()
    .$transaction((tx) =>
      loadNativeCompensationPlexPhase(
        tx,
        activity,
        { freshness, expectedRef: ref },
        budget,
      ),
    );
  await expect(
    harness
      .database()
      .$transaction((tx) => assertCompensationPhaseCurrent(tx, current.phase)),
  ).rejects.toThrow("another transaction");
});

test("fresh phase refuses a changed actual coordinator without changing history", async () => {
  const db = harness.database();
  const before =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    });
  const rollback = new Error("Rollback deliberate coordinator drift");
  await expect(
    db.$transaction(async (tx) => {
      await tx.nativePublicationCompensationContinuation.update({
        where: { id: activity.continuationId },
        data: { coordinatorOperationId: null },
      });
      await expect(
        loadNativeCompensationPlexPhase(
          tx,
          activity,
          { freshness, expectedRef: ref },
          new PublicationAuthorityReadBudget(),
        ),
      ).rejects.toMatchObject({ reason: "compensation_coordinator_changed" });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    }),
  ).toEqual(before);
});

test("a real newer observation cannot replace the original reference or renew its expiry", async () => {
  await fixture.observe(activity);
  await expect(
    harness
      .database()
      .$transaction((tx) =>
        loadNativeCompensationPlexPhase(
          tx,
          activity,
          { freshness, expectedRef: ref },
          new PublicationAuthorityReadBudget(),
        ),
      ),
  ).rejects.toMatchObject({ reason: "scope_changed" });
  const clock = vi.spyOn(Date, "now").mockReturnValue(freshness.expiresAtMs);
  try {
    await expect(
      harness
        .database()
        .$transaction((tx) =>
          loadNativeCompensationPlexPhase(
            tx,
            activity,
            { freshness, expectedRef: ref },
            new PublicationAuthorityReadBudget(),
          ),
        ),
    ).rejects.toMatchObject({ reason: "verification_expired" });
  } finally {
    clock.mockRestore();
  }
});
