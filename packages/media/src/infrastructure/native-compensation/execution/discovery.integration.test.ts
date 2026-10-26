import { rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeCompensationFixture } from "#automation/native-compensation/test-fixture.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { loadNativeCompensationPlexPhase } from "#infrastructure/plex-binding/native/native-parent.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { proofQueryAudit } from "#infrastructure/plex-binding/native/query-budget.test-support.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import {
  NativeCompensationDescriptorSchema,
  NativeCompensationExecutionSchema,
} from "#shared/native-recovery/compensation.ts";
import { NativePlexProofRefSchema } from "#shared/plex-binding/native.ts";
import { z } from "zod";
import { discoverNativeCompensationExecution } from "./discovery.ts";
import {
  assertCompensationDiscovery,
  persistCompensationDiscoveryExecution,
} from "./discovery-check.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let activity: NativeCompensationActivityInput;
beforeAll(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
  );
  await fixture.prepare();
  activity = await fixture.apply();
  const observed = await fixture.observe(activity);
  expect(observed.status).toBe("ready");
}, 60_000);
afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

function invocation(): PlexBindingExecution {
  return bindingTestExecution();
}

test("actual producer discovery is charged data only and must match a new full locked phase", async () => {
  const execution = invocation();
  const budget = new PublicationAuthorityReadBudget();
  const discovery = await harness.database().$transaction(async (tx) => {
    const audit = proofQueryAudit(tx);
    try {
      const measured = await discoverNativeCompensationExecution(tx, activity, {
        execution,
        budget,
      });
      expect(measured.kind).toBe("measurement");
      expect(measured).not.toHaveProperty("assertActive");
      expect(measured).not.toHaveProperty("phase");
      expect(measured).not.toHaveProperty("context");
      expect(await audit.returned()).toBe(measured.chain.length + 3);
      expect(101 - budget.take).toBe(await audit.returned());
      expect(measured.expiresAtMs).toBeLessThanOrEqual(execution.expiresAtMs);
      return measured;
    } finally {
      audit.restore();
    }
  });
  await harness.database().$transaction(async (tx) => {
    const loaded = await loadNativeCompensationPlexPhase(
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
    assertCompensationDiscovery(tx, loaded.phase, discovery, {
      execution,
      budget,
    });
    expect(() =>
      assertCompensationDiscovery(harness.database(), loaded.phase, discovery, {
        execution,
        budget,
      }),
    ).toThrow();
    expect(() =>
      assertCompensationDiscovery(
        tx,
        loaded.phase,
        {
          ...discovery,
          commandHash: "0".repeat(64),
        },
        { execution, budget },
      ),
    ).toThrow("measurement changed");
  });
});

test("discovery checks raw descriptor hash before parsing without rewriting history", async () => {
  await harness.database().$transaction(async (tx) => {
    const row =
      await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: activity.continuationId },
      });
    const spy = vi
      .spyOn(tx.nativePublicationCompensationContinuation, "findUniqueOrThrow")
      .mockResolvedValueOnce({ ...row, descriptor: {} });
    try {
      await expect(
        discoverNativeCompensationExecution(tx, activity, {
          execution: invocation(),
          budget: new PublicationAuthorityReadBudget(),
        }),
      ).rejects.toThrow("immutable evidence hash changed");
    } finally {
      spy.mockRestore();
    }
    expect(
      await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: row.id },
      }),
    ).toEqual(row);
  });
});

test("discovery rejects a real foreign preparation command before returning measurement", async () => {
  const preparation = await harness.database().operation.findFirstOrThrow({
    where: {
      kind: "prepare_native_compensation",
      targetId: fixture.input.planId,
    },
  });
  await expect(
    harness.database().$transaction((tx) =>
      discoverNativeCompensationExecution(
        tx,
        {
          ...activity,
          operationId: preparation.id,
        },
        {
          execution: invocation(),
          budget: new PublicationAuthorityReadBudget(),
        },
      ),
    ),
  ).rejects.toThrow();
});

test("raw batch corruption fails before parsed timing can renew the original deadline", async () => {
  await harness.database().$transaction(async (tx) => {
    const operation = await tx.operation.findUniqueOrThrow({
      where: { id: activity.operationId },
    });
    const ref = z
      .object({ nativePlexProof: NativePlexProofRefSchema })
      .parse(operation.result).nativePlexProof;
    const row = await tx.nativePlexProofBatch.findUniqueOrThrow({
      where: { id: ref.batchId },
    });
    const spy = vi
      .spyOn(tx.nativePlexProofBatch, "findUniqueOrThrow")
      .mockResolvedValueOnce({ ...row, batch: {} });
    try {
      await expect(
        discoverNativeCompensationExecution(tx, activity, {
          execution: invocation(),
          budget: new PublicationAuthorityReadBudget(),
        }),
      ).rejects.toThrow("immutable evidence hash changed");
    } finally {
      spy.mockRestore();
    }
  });
});

test("discovery protects at the shared admission boundary without returning a partial measurement", async () => {
  await harness.database().$transaction(async (tx) => {
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(97);
    const audit = proofQueryAudit(tx);
    try {
      await expect(
        discoverNativeCompensationExecution(tx, activity, {
          execution: invocation(),
          budget,
        }),
      ).rejects.toThrow("100 total queried records");
      // Three actual model rows fit. The fourth pre-query admission rejects.
      expect(await audit.returned()).toBe(3);
      expect(budget.take).toBe(0);
    } finally {
      audit.restore();
    }
  });
});

test("raw-hash-consistent cyclic discovery still protects before a second ancestry query", async () => {
  await harness.database().$transaction(async (tx) => {
    const row =
      await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
        where: { id: activity.continuationId },
      });
    const descriptor = NativeCompensationDescriptorSchema.parse(row.descriptor);
    const cyclic = {
      ...descriptor,
      scope: {
        ...descriptor.scope,
        previousCompensation: {
          continuationId: row.id,
          descriptorHash: row.descriptorHash,
          executionHash: null,
          coordinatorOperationId: activity.operationId,
        },
      },
    };
    const spy = vi
      .spyOn(tx.nativePublicationCompensationContinuation, "findUniqueOrThrow")
      .mockResolvedValueOnce({
        ...row,
        descriptor: nativeJson(cyclic),
        descriptorHash: identityHash(cyclic),
      });
    try {
      await expect(
        discoverNativeCompensationExecution(tx, activity, {
          execution: invocation(),
          budget: new PublicationAuthorityReadBudget(),
        }),
      ).rejects.toThrow("cyclic");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

test("original expiry and monotonic deadline cannot be restarted by discovery", async () => {
  for (const execution of [
    { ...invocation(), expiresAtMs: Date.now() - 1 },
    {
      ...invocation(),
      observed: { wall: Date.now(), monotonic: performance.now() - 60_001 },
    },
  ])
    await harness.database().$transaction(async (tx) => {
      const spy = vi.spyOn(
        tx.nativePublicationCompensationContinuation,
        "findUniqueOrThrow",
      );
      try {
        await expect(
          discoverNativeCompensationExecution(tx, activity, {
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

test("measurement advances only through real execution CAS/readback and an identical replay adds no charge", async () => {
  const execution = invocation();
  const budget = new PublicationAuthorityReadBudget();
  const discovery = await harness
    .database()
    .$transaction((tx) =>
      discoverNativeCompensationExecution(tx, activity, { execution, budget }),
    );
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: discovery.expiresAtMs,
    guards: [execution],
  });
  const advanced = await harness.database().$transaction(async (tx) => {
    const { phase } = await loadNativeCompensationPlexPhase(
      tx,
      activity,
      { freshness, expectedRef: discovery.ref },
      budget,
    );
    const authority = phase.authority;
    const executionEvidence = NativeCompensationExecutionSchema.parse({
      schemaVersion: 1,
      continuationId: activity.continuationId,
      descriptorHash: authority.descriptorHash,
      recoveryEpoch: activity.recoveryEpoch,
      transition: authority.descriptor.scope.transition,
      effectPrefixHash:
        authority.descriptor.approvedFileEvidence.effectPrefixHash,
      participants: authority.descriptor.approvedFileEvidence.participants,
    });
    const input = { activity, executionEvidence };
    const options = { discovery, execution, freshness, budget };
    await expect(
      persistCompensationDiscoveryExecution(
        harness.database(),
        input,
        phase,
        options,
      ),
    ).rejects.toThrow("another transaction");
    const first = discovery.chain[0];
    if (first === undefined)
      throw new Error("Actual discovery missing current entry");
    const update = vi.spyOn(
      tx.nativePublicationCompensationContinuation,
      "updateMany",
    );
    try {
      await expect(
        persistCompensationDiscoveryExecution(tx, input, phase, {
          ...options,
          discovery: { ...discovery, chain: [...discovery.chain, first] },
        }),
      ).rejects.toThrow("measurement changed");
      expect(update).not.toHaveBeenCalled();
      update.mockResolvedValueOnce({ count: 1 });
      await expect(
        persistCompensationDiscoveryExecution(tx, input, phase, options),
      ).rejects.toThrow("own-write readback");
    } finally {
      update.mockRestore();
    }
    const before = budget.take;
    const result = await persistCompensationDiscoveryExecution(
      tx,
      input,
      phase,
      options,
    );
    expect(before - budget.take).toBe(1);
    expect(result.ref).toEqual(discovery.ref);
    expect(result.observed).toEqual(discovery.observed);
    expect(result.expiresAtMs).toBe(discovery.expiresAtMs);
    expect(result.chain.slice(1)).toEqual(discovery.chain.slice(1));
    expect(result.chain[0]?.locator.version).toBe(first.locator.version + 1);
    expect(result.chain[0]?.execution).toEqual(executionEvidence);
    const beforeReplay = budget.take;
    expect(
      await persistCompensationDiscoveryExecution(tx, input, phase, {
        ...options,
        discovery: result,
      }),
    ).toEqual(result);
    expect(budget.take).toBe(beforeReplay);
    return result;
  });
  await harness.database().$transaction(async (tx) => {
    const { phase } = await loadNativeCompensationPlexPhase(
      tx,
      activity,
      { freshness, expectedRef: discovery.ref },
      budget,
    );
    assertCompensationDiscovery(tx, phase, advanced, { execution, budget });
    expect(() =>
      assertCompensationDiscovery(tx, phase, discovery, { execution, budget }),
    ).toThrow("measurement changed");
  });
});

test("new actual proof pointer cannot replace the discovery's original A", async () => {
  const execution = invocation();
  const budget = new PublicationAuthorityReadBudget();
  const discovery = await harness
    .database()
    .$transaction((tx) =>
      discoverNativeCompensationExecution(tx, activity, { execution, budget }),
    );
  const observed = await fixture.observe(activity);
  expect(observed.status).toBe("ready");
  await expect(
    harness.database().$transaction((tx) =>
      loadNativeCompensationPlexPhase(
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
