import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import { nativeCompensationFixture } from "#automation/native-compensation/test-fixture.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { NativeCompensationScopeSchema } from "#shared/native-recovery/compensation.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { proofQueryAudit } from "#infrastructure/plex-binding/native/query-budget.test-support.ts";
import {
  assertNativeCompensationSnapshot,
  lockNativeCompensationScope,
} from "#infrastructure/native-compensation/guards.ts";
import { compensationPreviousEffects } from "#infrastructure/native-compensation/scope.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let planId: string;

beforeAll(async () => {
  const db = harness.database();
  fixture = await nativeCompensationFixture(db, harness.context().cipher);
  await fixture.prepare();
  const previous = await fixture.apply();
  const recoveryId = crypto.randomUUID();
  await prepareMediaRestore(db, {
    recoveryId,
    expectedEpoch: previous.recoveryEpoch,
    reason: "Actual prior compensation projection restore",
  });
  for (const proof of await grantTestExclusionProofs(
    db,
    fixture.prior.actor.id,
  )) {
    const roots =
      fixture.context.files.roots[
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
  const command = await fixture.service.prepare(
    fixture.prior.actor,
    crypto.randomUUID(),
    {
      lifecycleKind: "publication_compensation",
      transitionId: fixture.transition.id,
      restoreOperationId: restore.id,
      recoveryEpoch: runtime.recoveryEpoch,
      runtimeVersion: runtime.version,
      activation: "activate",
    },
  );
  planId = z.uuid().parse(command.nativeRecoveryId);
}, 60_000);

afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

async function reviewedScope() {
  const plan = await harness.database().nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  return NativeCompensationScopeSchema.parse(plan.scope);
}

test("locked snapshot projects its actual prior prefix without another provenance query or charge", async () => {
  const scope = await reviewedScope();
  expect(scope.previousCompensation).not.toBeNull();
  await harness.database().$transaction(async (tx) => {
    await lockNativeCompensationScope(tx, scope);
    const budget = new PublicationAuthorityReadBudget();
    const audit = proofQueryAudit(tx);
    try {
      const snapshot = await assertNativeCompensationSnapshot(
        tx,
        { planId, scope },
        budget,
      );
      const prior = snapshot.projection.priorChain[0];
      if (prior === undefined)
        throw new Error("Actual previous receipt missing");
      expect(prior.row.id).toBe(scope.previousCompensation?.continuationId);
      const rows = await audit.returned();
      const remaining = budget.take;
      expect(rows).toBeGreaterThan(0);
      expect(
        compensationPreviousEffects(tx, scope, snapshot.projection, budget),
      ).toBe(prior.descriptor.approvedFileEvidence.acknowledgedEffects);
      expect(await audit.returned()).toBe(rows);
      expect(budget.take).toBe(remaining);
    } finally {
      audit.restore();
    }
  });
});

test("projection rejects foreign budget, changed scope and raw queried ancestry", async () => {
  const scope = await reviewedScope();
  await harness.database().$transaction(async (tx) => {
    await lockNativeCompensationScope(tx, scope);
    const budget = new PublicationAuthorityReadBudget();
    const { projection } = await assertNativeCompensationSnapshot(
      tx,
      { planId, scope },
      budget,
    );
    expect(() =>
      compensationPreviousEffects(
        tx,
        scope,
        projection,
        new PublicationAuthorityReadBudget(),
      ),
    ).toThrow("another transaction/budget");
    const changed = structuredClone(scope);
    changed.request.recoveryEpoch++;
    expect(() =>
      compensationPreviousEffects(tx, changed, projection, budget),
    ).toThrow("projection changed");
    const prior = projection.priorChain[0];
    if (prior === undefined) throw new Error("Actual previous receipt missing");
    prior.row.version++;
    expect(() =>
      compensationPreviousEffects(tx, scope, projection, budget),
    ).toThrow("projection changed");
  });
});

test("actual queried projection cannot cross a transaction boundary", async () => {
  const scope = await reviewedScope();
  const budget = new PublicationAuthorityReadBudget();
  const projection = await harness.database().$transaction(async (tx) => {
    await lockNativeCompensationScope(tx, scope);
    const snapshot = await assertNativeCompensationSnapshot(
      tx,
      { planId, scope },
      budget,
    );
    return snapshot.projection;
  });
  await harness.database().$transaction((tx) => {
    expect(() =>
      compensationPreviousEffects(tx, scope, projection, budget),
    ).toThrow("another transaction/budget");
    return Promise.resolve();
  });
});
