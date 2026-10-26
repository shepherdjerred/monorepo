import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { NativePlexProofRef } from "#shared/plex-binding/native.ts";
import { loadNativePlexReviewParent } from "./native-parent.ts";
import { persistNativePlexProofBatch } from "./native-commit.ts";
import { loadNativePlexProofBatch } from "./native.ts";
import {
  readNativePlexReceipt,
  validateNativePlexReceipt,
} from "./native-version.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { nativeBudgetObservation } from "./native-budget.test-support.ts";
import { syntheticHistoricalArchiveReceipt } from "./native-legacy.test-support.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import { createNativeArchiveObserver } from "#migration/native-archive/producer.ts";
import {
  proofQueryAudit,
  returnedProofModels,
} from "./query-budget.test-support.ts";
import {
  loadPublicationIntentRecord,
  loadPublicationIntentFromQueriedTransition,
  assertQueriedPublicationParent,
} from "#infrastructure/publication-proof/store.ts";

const harness = automationTestHarness();
let directory: string | undefined;
let ref: NativePlexProofRef;
let receiptId: string;
beforeAll(async () => {
  const db = harness.database();
  const fixture = await nativeArchiveFixture(db, harness.context().cipher, {
    chain: 2,
    omitLegacySubtitlePolicy: true,
    fileFactory: () => mappedPublicationFixture(db),
  });
  directory = fixture.file.directory;
  // Explicit old Network serializer is the immutable raw source of this reader-only
  // synthetic pair. The fixture's normal observer now produces actual v3 batches.
  await createNativeArchiveObserver(fixture.observerContext)(fixture.planId);
  const parent = await loadNativePlexReviewParent(db, fixture.prepareInput);
  const proof = await nativeBudgetObservation(db, parent.proofParent);
  const wall = Date.parse(proof.network.capturedAt);
  const freshness = plexBindingFreshness({
    observed: { wall, monotonic: performance.now() - (Date.now() - wall) },
    expiresAtMs: Date.parse(proof.network.expiresAt),
    guards: [],
  });
  ref = await db.$transaction((tx) =>
    persistNativePlexProofBatch(
      tx,
      {
        parent: parent.proofParent,
        networkEvidence: proof.network,
        plexObservation: proof.observation,
        timing: proof.timing,
        expectedOperationResultHash: parent.expectedOperationResultHash,
      },
      freshness,
    ),
  );
  // Separate synthetic historical-format records are inserted once. The current
  // Files writer is v3; it is never asked to manufacture an old protocol result.
  const historical = await syntheticHistoricalArchiveReceipt(db, {
    seedPlanId: fixture.planId,
    network: proof.network,
    context: fixture.context,
  });
  receiptId = historical.receiptId;
  const before = await historical.snapshot();
  let configReads = 0;
  const activities = createNativeArchiveFileActivities(
    {
      ...fixture.context,
      files: {
        ...fixture.context.files,
        plexAccess: () => {
          configReads++;
          throw new Error("Historical ACK must precede new Plex configuration");
        },
      },
    },
    fixture.execution,
  );
  await activities.applyNativeArchiveFiles(historical.input);
  expect(configReads).toBe(0);
  expect(await historical.snapshot()).toEqual(before);
  expect(before.batches).toBe(0);
  expect(before.observations).toBe(0);
});
afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

test("actual joined batch reads share the 95/100 boundary and reject the next read", async () => {
  await harness.database().$transaction(async (tx) => {
    const budget = new PublicationAuthorityReadBudget();
    const audit = proofQueryAudit(tx);
    try {
      for (let index = 0; index < 19; index++)
        await loadNativePlexProofBatch(tx, ref, ref.parent, { budget: budget });
      expect(budget.take).toBe(6);
      const loaded = await loadNativePlexProofBatch(tx, ref, ref.parent, {
        budget: budget,
      });
      expect(loaded.ref).toEqual(ref);
      expect(budget.take).toBe(1);
      await expect(
        loadNativePlexProofBatch(tx, ref, ref.parent, { budget: budget }),
      ).rejects.toThrow("100 total queried records");
      expect(await audit.returned()).toBe(105);
      expect(101 - budget.take).toBe(await audit.returned());
    } finally {
      audit.restore();
    }
  });
});

test("synthetic historical-format receipt reads reach100 without adding pair reads or rewriting raw history", async () => {
  await harness.database().$transaction(async (tx) => {
    const budget = new PublicationAuthorityReadBudget();
    const audit = proofQueryAudit(tx);
    try {
      const alreadyQueried = await tx.nativeRecoveryReceipt.findUniqueOrThrow({
        where: { id: receiptId },
        include: { plan: true },
      });
      budget.consume(2);
      for (let index = 0; index < 48; index++)
        expect(await readNativePlexReceipt(tx, receiptId, budget)).toBeNull();
      expect(budget.take).toBe(3);
      expect(await readNativePlexReceipt(tx, receiptId, budget)).toBeNull();
      expect(budget.take).toBe(1);
      expect(await audit.returned()).toBe(100);
      expect(
        await validateNativePlexReceipt(tx, alreadyQueried, budget),
      ).toBeNull();
      expect(budget.take).toBe(1);
      await expect(
        readNativePlexReceipt(tx, receiptId, budget),
      ).rejects.toThrow("100 total queried records");
      expect(await audit.returned()).toBe(102);
      expect(101 - budget.take).toBe(await audit.returned());
    } finally {
      audit.restore();
    }
  });
});

test("actual same-transaction queried plan omits only its duplicate relation and rejects a foreign context", async () => {
  await harness.database().$transaction(async (tx) => {
    const audit = proofQueryAudit(tx);
    const budget = new PublicationAuthorityReadBudget();
    try {
      const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
        where: { id: ref.parent.planId },
      });
      budget.consume(1);
      const queriedPlan = { transaction: tx, budget, plan };
      await loadNativePlexProofBatch(tx, ref, ref.parent, {
        budget,
        queriedPlan,
      });
      await loadNativePlexProofBatch(tx, ref, ref.parent, {
        budget,
        queriedPlan,
      });
      expect(await audit.returned()).toBe(9);
      expect(101 - budget.take).toBe(9);
      await expect(
        loadNativePlexProofBatch(tx, ref, ref.parent, {
          budget,
          queriedPlan: { ...queriedPlan, transaction: harness.database() },
        }),
      ).rejects.toThrow("another transaction");
      await expect(
        loadNativePlexProofBatch(tx, ref, ref.parent, {
          budget,
          queriedPlan: {
            ...queriedPlan,
            budget: new PublicationAuthorityReadBudget(),
          },
        }),
      ).rejects.toThrow("another transaction");
      expect(await audit.returned()).toBe(9);
      await expect(
        loadNativePlexProofBatch(tx, ref, ref.parent, {
          budget,
          queriedPlan: { ...queriedPlan, plan: { ...plan, scope: {} } },
        }),
      ).rejects.toThrow("immutable batch closure changed");
      // The changed in-memory plan never changes persisted history. Its batch
      // query still returned four real model records and must remain charged.
      expect(await audit.returned()).toBe(13);
      expect(101 - budget.take).toBe(13);
    } finally {
      audit.restore();
    }
  });
});

test("original publication intent counts both actual transition and attempt parent reads", async () => {
  const db = harness.database();
  const transition = await db.mediaPublicationTransition.findFirstOrThrow();
  await db.$transaction(async (tx) => {
    const audit = proofQueryAudit(tx);
    const budget = new PublicationAuthorityReadBudget();
    try {
      const result = await loadPublicationIntentRecord(
        tx,
        transition.attemptId,
        budget,
      );
      expect(result?.reference.transitionId).toBe(transition.id);
      expect(await audit.returned()).toBe(2);
      expect(101 - budget.take).toBe(2);
    } finally {
      audit.restore();
    }
  });
});

test("proof query audit rejects unknown included model relations rather than treating them as JSON", () => {
  expect(() =>
    returnedProofModels(
      "NativeRecoveryReceipt",
      { include: { extraParent: true } },
      { extraParent: {} },
    ),
  ).toThrow("Unknown proof relation");
});

test("queried publication parent preserves raw bindings and rejects another transaction, budget or mutated attempt", async () => {
  const db = harness.database();
  const selected = await db.mediaPublicationTransition.findFirstOrThrow();
  const budget = new PublicationAuthorityReadBudget();
  await db.$transaction(async (tx) => {
    const audit = proofQueryAudit(tx);
    try {
      const transition = await tx.mediaPublicationTransition.findUniqueOrThrow({
        where: { id: selected.id },
      });
      budget.consume(1);
      const parent = await loadPublicationIntentFromQueriedTransition(tx, {
        transaction: tx,
        transition,
        budget,
      });
      expect(() =>
        assertQueriedPublicationParent(tx, parent, budget),
      ).not.toThrow();
      expect(() => assertQueriedPublicationParent(db, parent, budget)).toThrow(
        "another transaction/budget",
      );
      expect(() =>
        assertQueriedPublicationParent(
          tx,
          parent,
          new PublicationAuthorityReadBudget(),
        ),
      ).toThrow("another transaction/budget");
      expect(() =>
        assertQueriedPublicationParent(
          tx,
          { ...parent, attempt: { ...parent.attempt, filePlan: null } },
          budget,
        ),
      ).toThrow("Publication parent changed");
      expect(await audit.returned()).toBe(2);
      expect(101 - budget.take).toBe(2);
    } finally {
      audit.restore();
    }
  });
});
