import { rm } from "node:fs/promises";
import { z } from "zod";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { observeArchiveCleanup } from "#automation/native-archive/fixtures/observe.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { executionFor } from "#automation/native-archive/cleanup-proof.ts";
import {
  CleanupNativeArchiveInputSchema,
  NativeArchiveContinuationSchema,
  type CleanupNativeArchiveInput,
} from "#shared/native-recovery/archive.ts";
import { NativePlexProofRefSchema } from "#shared/plex-binding/native.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  proofQueryAudit,
  returnedProofModels,
} from "#infrastructure/plex-binding/native/query-budget.test-support.ts";
import { loadNativeArchivePlexPhase } from "#infrastructure/plex-binding/native/native-parent.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { queueNativeArchiveCleanup } from "#infrastructure/native-archive/continuation.ts";
import { discoverNativeArchiveExecution } from "./discovery.ts";
import {
  assertArchiveDiscovery,
  persistArchiveDiscoveryExecution,
} from "./discovery-check.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeArchiveFixture>>;
let activity: CleanupNativeArchiveInput;
beforeAll(async () => {
  const db = harness.database();
  fixture = await nativeArchiveFixture(db, harness.context().cipher, {
    chain: 2,
    publicationAgeDays: 8,
  });
  await fixture.prepare();
  const receiptId = await fixture.apply();
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
}, 60_000);
afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

test("archive measurement queries five actual scalar parents and matches a new complete phase", async () => {
  const execution = bindingTestExecution();
  const budget = new PublicationAuthorityReadBudget();
  const discovery = await harness.database().$transaction(async (tx) => {
    const audit = proofQueryAudit(tx);
    const observation = vi.spyOn(
      tx.nativeRecoveryObservation,
      "findUniqueOrThrow",
    );
    try {
      const measured = await discoverNativeArchiveExecution(tx, activity, {
        execution,
        budget,
      });
      expect(measured.kind).toBe("measurement");
      expect(measured).not.toHaveProperty("phase");
      expect(measured).not.toHaveProperty("assertActive");
      expect(await audit.returned()).toBe(4);
      expect(observation).toHaveBeenCalledTimes(1);
      const call = observation.mock.calls[0];
      const result = observation.mock.results[0];
      if (call === undefined || result?.type !== "return")
        throw new Error("Observation query was not returned");
      expect(
        returnedProofModels(
          "NativeRecoveryObservation",
          call[0],
          await result.value,
        ),
      ).toBe(1);
      expect(budget.take).toBe(96);
      return measured;
    } finally {
      audit.restore();
      observation.mockRestore();
    }
  });
  await harness.database().$transaction(async (tx) => {
    const { phase } = await loadNativeArchivePlexPhase(
      tx,
      activity,
      {
        freshness: plexBindingFreshness({
          observed: execution.observed,
          expiresAtMs: discovery.expiresAtMs,
          guards: [execution],
        }),
        expectedRef: discovery.ref,
      },
      budget,
    );
    assertArchiveDiscovery(tx, phase, discovery, { execution, budget });
    expect(() =>
      assertArchiveDiscovery(harness.database(), phase, discovery, {
        execution,
        budget,
      }),
    ).toThrow("another transaction");
    expect(() =>
      assertArchiveDiscovery(
        tx,
        phase,
        { ...discovery, commandHash: "0".repeat(64) },
        { execution, budget },
      ),
    ).toThrow("measurement changed");
    expect(() =>
      assertArchiveDiscovery(
        tx,
        phase,
        {
          ...discovery,
          entry: {
            ...discovery.entry,
            locator: {
              ...discovery.entry.locator,
              version: discovery.entry.locator.version + 1,
            },
          },
        },
        { execution, budget },
      ),
    ).toThrow("measurement changed");
  });
});

test("archive measurement raw descriptor corruption rejects before parse without history mutation", async () => {
  await harness.database().$transaction(async (tx) => {
    const row = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    });
    const spy = vi
      .spyOn(tx.nativeArchiveCleanupContinuation, "findUniqueOrThrow")
      .mockResolvedValueOnce({ ...row, descriptor: {} });
    try {
      await expect(
        discoverNativeArchiveExecution(tx, activity, {
          execution: bindingTestExecution(),
          budget: new PublicationAuthorityReadBudget(),
        }),
      ).rejects.toThrow("immutable evidence hash changed");
    } finally {
      spy.mockRestore();
    }
    expect(
      await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
        where: { id: row.id },
      }),
    ).toEqual(row);
  });
});

test("archive discovery cannot omit its fifth parent to fit a depleted invocation budget", async () => {
  await harness.database().$transaction(async (tx) => {
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(96);
    const audit = proofQueryAudit(tx);
    const observation = vi.spyOn(
      tx.nativeRecoveryObservation,
      "findUniqueOrThrow",
    );
    try {
      await expect(
        discoverNativeArchiveExecution(tx, activity, {
          execution: bindingTestExecution(),
          budget,
        }),
      ).rejects.toThrow("100 total queried records");
      expect(await audit.returned()).toBe(4);
      expect(observation).not.toHaveBeenCalled();
      expect(budget.take).toBe(0);
    } finally {
      audit.restore();
      observation.mockRestore();
    }
  });
});

test("archive measurement rejects a real foreign command", async () => {
  const operation = await harness.database().operation.findFirstOrThrow({
    where: { kind: "prepare_native_archive", targetId: fixture.planId },
  });
  await expect(
    harness.database().$transaction((tx) =>
      discoverNativeArchiveExecution(
        tx,
        {
          ...activity,
          operationId: operation.id,
        },
        {
          execution: bindingTestExecution(),
          budget: new PublicationAuthorityReadBudget(),
        },
      ),
    ),
  ).rejects.toThrow();
});

test("hash-consistent archive measurement still rejects a cyclic file-reference graph", async () => {
  await harness.database().$transaction(async (tx) => {
    const row = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: activity.continuationId },
    });
    const descriptor = NativeArchiveContinuationSchema.parse(row.descriptor);
    const cyclic = {
      ...descriptor,
      scope: {
        ...descriptor.scope,
        edges: descriptor.scope.edges.map((edge, index) =>
          index === 0 ? { ...edge, successorAssetId: edge.assetId } : edge,
        ),
      },
    };
    const spy = vi
      .spyOn(tx.nativeArchiveCleanupContinuation, "findUniqueOrThrow")
      .mockResolvedValueOnce({
        ...row,
        descriptor: nativeJson(cyclic),
        descriptorHash: identityHash(cyclic),
      });
    try {
      await expect(
        discoverNativeArchiveExecution(tx, activity, {
          execution: bindingTestExecution(),
          budget: new PublicationAuthorityReadBudget(),
        }),
      ).rejects.toThrow("edge cycle");
    } finally {
      spy.mockRestore();
    }
  });
});

test("archive measurement rejects raw batch and effective-scope envelope corruption", async () => {
  await harness.database().$transaction(async (tx) => {
    const operation = await tx.operation.findUniqueOrThrow({
      where: { id: activity.operationId },
    });
    const ref = z
      .object({ nativePlexProof: NativePlexProofRefSchema })
      .parse(operation.result).nativePlexProof;
    const batch = await tx.nativePlexProofBatch.findUniqueOrThrow({
      where: { id: ref.batchId },
    });
    const observation = await tx.nativeRecoveryObservation.findUniqueOrThrow({
      where: { id: ref.plex.observationId },
    });
    const batchSpy = vi
      .spyOn(tx.nativePlexProofBatch, "findUniqueOrThrow")
      .mockResolvedValueOnce({ ...batch, batch: {} });
    try {
      await expect(
        discoverNativeArchiveExecution(tx, activity, {
          execution: bindingTestExecution(),
          budget: new PublicationAuthorityReadBudget(),
        }),
      ).rejects.toThrow("immutable evidence hash changed");
    } finally {
      batchSpy.mockRestore();
    }
    const observationSpy = vi
      .spyOn(tx.nativeRecoveryObservation, "findUniqueOrThrow")
      .mockResolvedValueOnce({ ...observation, evidence: {} });
    try {
      await expect(
        discoverNativeArchiveExecution(tx, activity, {
          execution: bindingTestExecution(),
          budget: new PublicationAuthorityReadBudget(),
        }),
      ).rejects.toThrow("observation raw parent changed");
    } finally {
      observationSpy.mockRestore();
    }
  });
});

test("archive measurement preserves original wall and monotonic deadlines before queries", async () => {
  for (const execution of [
    { ...bindingTestExecution(), expiresAtMs: Date.now() - 1 },
    {
      ...bindingTestExecution(),
      observed: { wall: Date.now(), monotonic: performance.now() - 60_001 },
    },
  ])
    await harness.database().$transaction(async (tx) => {
      const spy = vi.spyOn(
        tx.nativeArchiveCleanupContinuation,
        "findUniqueOrThrow",
      );
      try {
        await expect(
          discoverNativeArchiveExecution(tx, activity, {
            execution,
            budget: new PublicationAuthorityReadBudget(),
          }),
        ).rejects.toThrow();
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
});

test("archive measurement advances only after actual execution CAS and exact readback", async () => {
  const execution = bindingTestExecution();
  const budget = new PublicationAuthorityReadBudget();
  const discovery = await harness
    .database()
    .$transaction((tx) =>
      discoverNativeArchiveExecution(tx, activity, { execution, budget }),
    );
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: discovery.expiresAtMs,
    guards: [execution],
  });
  // Existing pure production projection uses actual original Files evidence;
  // no file hashing or physical effect occurs under these database locks.
  const evidence = executionFor(
    discovery.entry.locator,
    discovery.entry.descriptor,
  );
  const advanced = await harness.database().$transaction(async (tx) => {
    const { phase } = await loadNativeArchivePlexPhase(
      tx,
      activity,
      { freshness, expectedRef: discovery.ref },
      budget,
    );
    const options = { discovery, execution, freshness, budget };
    await expect(
      persistArchiveDiscoveryExecution(
        harness.database(),
        evidence,
        phase,
        options,
      ),
    ).rejects.toThrow("another transaction");
    const spy = vi
      .spyOn(tx.nativeArchiveCleanupContinuation, "updateMany")
      .mockResolvedValueOnce({ count: 1 });
    try {
      await expect(
        persistArchiveDiscoveryExecution(tx, evidence, phase, options),
      ).rejects.toThrow("own-write readback");
    } finally {
      spy.mockRestore();
    }
    const before = budget.take;
    const result = await persistArchiveDiscoveryExecution(
      tx,
      evidence,
      phase,
      options,
    );
    expect(before - budget.take).toBe(1);
    expect(result.entry.locator.version).toBe(
      discovery.entry.locator.version + 1,
    );
    expect(result.entry.execution).toEqual(evidence);
    expect(result.effectiveScope).toEqual(discovery.effectiveScope);
    expect(result.ref).toEqual(discovery.ref);
    expect(result.observed).toEqual(discovery.observed);
    expect(result.expiresAtMs).toBe(discovery.expiresAtMs);
    const replayBefore = budget.take;
    expect(
      await persistArchiveDiscoveryExecution(tx, evidence, phase, {
        ...options,
        discovery: result,
      }),
    ).toEqual(result);
    expect(budget.take).toBe(replayBefore);
    return result;
  });
  await harness.database().$transaction(async (tx) => {
    const { phase } = await loadNativeArchivePlexPhase(
      tx,
      activity,
      { freshness, expectedRef: discovery.ref },
      budget,
    );
    assertArchiveDiscovery(tx, phase, advanced, { execution, budget });
    expect(() =>
      assertArchiveDiscovery(tx, phase, discovery, { execution, budget }),
    ).toThrow("measurement changed");
  });
});

test("archive measurement cannot replace original ref A with a later real observation", async () => {
  const execution = bindingTestExecution();
  const budget = new PublicationAuthorityReadBudget();
  const discovery = await harness
    .database()
    .$transaction((tx) =>
      discoverNativeArchiveExecution(tx, activity, { execution, budget }),
    );
  await observeArchiveCleanup(fixture.observerContext, activity);
  await expect(
    harness.database().$transaction((tx) =>
      loadNativeArchivePlexPhase(
        tx,
        activity,
        {
          freshness: plexBindingFreshness({
            observed: execution.observed,
            expiresAtMs: discovery.expiresAtMs,
            guards: [execution],
          }),
          expectedRef: discovery.ref,
        },
        budget,
      ),
    ),
  ).rejects.toThrow();
});
