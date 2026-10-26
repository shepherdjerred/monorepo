import { rm } from "node:fs/promises";
import { z } from "zod";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { observeArchiveCleanup } from "#automation/native-archive/fixtures/observe.ts";
import { measureArchiveCleanup } from "#automation/native-archive/cleanup/measurement.ts";
import {
  assertArchiveCleanupCurrent,
  type ArchiveCleanupPlexProof,
} from "#automation/native-archive/cleanup-authority.ts";
import {
  CleanupNativeArchiveInputSchema,
  type CleanupNativeArchiveInput,
} from "#shared/native-recovery/archive.ts";
import type { NativePlexProofRef } from "#shared/plex-binding/native.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { proofQueryAudit } from "#infrastructure/plex-binding/native/query-budget.test-support.ts";
import { loadNativeArchivePlexPhase } from "#infrastructure/plex-binding/native/native-parent.ts";
import { readCompletedNativeArchiveCleanup } from "#infrastructure/plex-binding/native/native-archive-ack.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import {
  assertArchivePhaseCurrent,
  queueNativeArchiveCleanup,
} from "./continuation.ts";
import { persistArchivePhaseExecution } from "./execution-phase.ts";
import { discoverNativeArchiveExecution } from "./execution/discovery.ts";
import { assertArchiveDiscovery } from "./execution/discovery-check.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeArchiveFixture>>;
let activity: CleanupNativeArchiveInput;
let ref: NativePlexProofRef;
let freshness: PlexBindingFreshness;
let execution: PlexBindingExecution;

beforeAll(async () => {
  const db = harness.database();
  fixture = await nativeArchiveFixture(db, harness.context().cipher, {
    chain: 2,
    publicationAgeDays: 8,
  });
  await fixture.prepare();
  const receiptId = await fixture.apply();
  // This phase test establishes the same explicit household boundary as the
  // actual physical executor fixture; it does not fabricate any Plex proof.
  await db.recoveryHold.updateMany({
    where: { mediaId: fixture.file.media.id, edition: "default" },
    data: { releasedAt: new Date(), releasedById: fixture.prior.actor.id },
  });
  await db.mediaIntent.updateMany({
    where: { mediaId: fixture.file.media.id, edition: "default" },
    data: {
      automationEpoch: fixture.runtime.recoveryEpoch,
      desiredPresence: true,
    },
  });
  const row = await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
    where: { receiptId },
  });
  const operationId = await db.$transaction((tx) =>
    queueNativeArchiveCleanup(tx, {
      continuationId: row.id,
      expectedVersion: row.version,
    }),
  );
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(operationId) },
  });
  activity = CleanupNativeArchiveInputSchema.parse(operation.payload);
  await observeArchiveCleanup(fixture.observerContext, activity);
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const sdk = fixture.execution();
  const initial = plexBindingFreshness({
    observed,
    expiresAtMs: Math.min(sdk.expiresAtMs, observed.wall + 60_000),
    guards: [sdk],
  });
  execution = {
    observed,
    expiresAtMs: initial.expiresAtMs,
    signal: sdk.signal,
    assertActive: () => {
      initial.assertActive();
    },
    checkpoint: sdk.checkpoint,
  };
  const captured = await db.$transaction((tx) =>
    loadNativeArchivePlexPhase(
      tx,
      activity,
      { freshness: initial },
      new PublicationAuthorityReadBudget(),
    ),
  );
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

test("three fresh archive phases and an actual execution CAS share the original 100-record boundary", async () => {
  const db = harness.database();
  const budget = new PublicationAuthorityReadBudget();
  // ACK1 + discovery5 + three18-charge phases (17 returned parents + retained conservative1) + CAS1.
  budget.consume(39);
  expect(
    await db.$transaction((tx) =>
      readCompletedNativeArchiveCleanup(tx, activity, budget),
    ),
  ).toBeNull();
  const discovery = await db.$transaction(async (tx) => {
    const audit = proofQueryAudit(tx);
    // This model is deliberately not in proofQueryAudit's existing phase inventory.
    const observation = vi.spyOn(
      tx.nativeRecoveryObservation,
      "findUniqueOrThrow",
    );
    const admittedBefore = 101 - budget.take;
    try {
      const discovered = await discoverNativeArchiveExecution(tx, activity, {
        execution,
        budget,
      });
      expect(await audit.returned()).toBe(4);
      expect(observation).toHaveBeenCalledExactlyOnceWith({
        where: { id: ref.plex.observationId },
      });
      expect(await observation.mock.results[0]?.value).toMatchObject({
        id: ref.plex.observationId,
      });
      expect(101 - budget.take - admittedBefore).toBe(5);
      return discovered;
    } finally {
      observation.mockRestore();
      audit.restore();
    }
  });
  // Actual path validation, hashing and bounded journal reads precede every PG/path lock.
  const measured = await measureArchiveCleanup(
    fixture.context,
    discovery,
    execution.assertActive,
  );
  for (const index of [0, 1, 2]) {
    await db.$transaction(async (tx) => {
      const audit = proofQueryAudit(tx);
      const admittedBefore = 101 - budget.take;
      try {
        const current = await loadNativeArchivePlexPhase(
          tx,
          activity,
          { freshness, expectedRef: ref },
          budget,
        );
        expect(current.proof.ref).toEqual(ref);
        if (index === 1) {
          const authority = current.phase.authority;
          assertArchiveDiscovery(tx, current.phase, discovery, {
            execution,
            budget,
          });
          const plex: ArchiveCleanupPlexProof = {
            kind: "paired",
            ref: current.proof.ref,
            network: current.proof.network,
            observed: execution.observed,
            freshness: plexBindingFreshness({
              observed: execution.observed,
              expiresAtMs: Math.min(
                freshness.expiresAtMs,
                current.proof.expiresAtMs,
              ),
              guards: [freshness, execution],
            }),
            budget,
          };
          const physical = await measured.seal({
            assertActive: () => {
              plex.freshness.assertActive();
            },
            assertCurrent: async () => {
              await assertArchiveCleanupCurrent(
                tx,
                fixture.context,
                plex,
                current.phase,
              );
            },
          });
          const version = authority.row.version;
          await persistArchivePhaseExecution(
            tx,
            physical.execution,
            current.phase,
            { freshness: plex.freshness, budget },
          );
          expect(current.phase.authority.row.version).toBe(version + 1);
          expect(current.phase.authority.row.executionEvidence).toEqual(
            physical.execution,
          );
          await assertArchivePhaseCurrent(tx, current.phase);
        }
        const returned = await audit.returned();
        expect(returned).toBe(index === 1 ? 18 : 17);
        expect(101 - budget.take - admittedBefore).toBe(returned + 1);
      } finally {
        audit.restore();
      }
    });
  }
  expect(budget.take).toBe(1);
  await expect(
    db.$transaction((tx) =>
      loadNativeArchivePlexPhase(
        tx,
        activity,
        { freshness, expectedRef: ref },
        budget,
      ),
    ),
  ).rejects.toThrow("100 total queried records");
});

test("queried archive authority refuses a different transaction", async () => {
  const current = await harness
    .database()
    .$transaction((tx) =>
      loadNativeArchivePlexPhase(
        tx,
        activity,
        { freshness, expectedRef: ref },
        new PublicationAuthorityReadBudget(),
      ),
    );
  await expect(
    harness
      .database()
      .$transaction((tx) => assertArchivePhaseCurrent(tx, current.phase)),
  ).rejects.toThrow("another transaction");
});

test("a fresh archive phase rejects coordinator drift without changing the original history", async () => {
  const db = harness.database();
  const before = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: activity.continuationId },
  });
  const rollback = new Error("Rollback deliberate archive coordinator drift");
  await expect(
    db.$transaction(async (tx) => {
      await tx.nativeArchiveCleanupContinuation.update({
        where: { id: activity.continuationId },
        data: { coordinatorOperationId: null },
      });
      await expect(
        loadNativeArchivePlexPhase(
          tx,
          activity,
          { freshness, expectedRef: ref },
          new PublicationAuthorityReadBudget(),
        ),
      ).rejects.toMatchObject({ reason: "archive_coordinator_changed" });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(
    await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    }),
  ).toEqual(before);
});

test("a later real archive observation cannot replace ref A or renew the original expiry", async () => {
  await observeArchiveCleanup(fixture.observerContext, activity);
  await expect(
    harness
      .database()
      .$transaction((tx) =>
        loadNativeArchivePlexPhase(
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
          loadNativeArchivePlexPhase(
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
