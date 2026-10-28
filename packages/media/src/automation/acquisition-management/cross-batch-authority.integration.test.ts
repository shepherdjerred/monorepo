import { rm } from "node:fs/promises";
import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createManagedSeriesFixture } from "#testing/series-workflow/fixture.ts";
import { extendManagedSeriesBatch } from "#testing/series-workflow/cross-batch-fixture.ts";
import { ManagedSeriesAcquisitionIdentitySchema } from "#shared/acquisition/library-management.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { readLibrarySeriesManagement } from "#infrastructure/acquisition-identity/library-management.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { Prisma } from "#generated/prisma/client.ts";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture(1280);
  upgrade = await movieVideoFixture(1920, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const first = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const second = await extendManagedSeriesBatch(first, upgrade);
  const result = await second.acquired.reconcileMediaIntent(first.input);
  expect(result.status).toBe("acquire");
  const attempt = await first.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: z.uuid().parse(result.attemptId) },
  });
  const identity = ManagedSeriesAcquisitionIdentitySchema.parse(
    attempt.identityEvidence,
  );
  if (identity.management.schemaVersion !== 3)
    throw new Error("Actual two-batch episode policy missing");
  return { first, second, attempt, identity };
}

/** Adversarial INSERTs use the actual producer's birth and roll back even the positive control. */
async function insertCandidate(
  tx: Prisma.TransactionClient,
  originalId: string,
  identity: unknown,
) {
  const overrides = JSON.stringify({
    id: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    identityEvidence: identity,
  });
  return tx.$executeRaw`INSERT INTO "AcquisitionAttempt"
    SELECT (jsonb_populate_record(NULL::"AcquisitionAttempt",
      to_jsonb(a) || ${overrides}::jsonb)).*
    FROM "AcquisitionAttempt" a WHERE id=${originalId}`;
}

test("SQL validates every original batch and rejects forged coverage, receipt/profile scope and generations", async () => {
  const f = await fixture();
  const rollback = new Error("Valid attack control rolls back");
  const controlFreshness = f.second.context.plexBindingExecution();
  await expect(
    f.first.db.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, controlFreshness);
      expect(await insertCandidate(tx, f.attempt.id, f.identity)).toBe(1);
      throw rollback;
    }),
  ).rejects.toBe(rollback);

  const policy = f.identity.management;
  if (policy.schemaVersion !== 3) throw new Error("Batch policy missing");
  const first = policy.approvals[0];
  const second = policy.approvals[1];
  if (first === undefined || second === undefined)
    throw new Error("Actual original approvals missing");
  const attacks = [
    { ...policy, approvals: [first] },
    { ...policy, approvals: [first, first] },
    { ...policy, approvals: [...policy.approvals].reverse() },
    {
      ...policy,
      approvals: [first, { ...second, profileId: crypto.randomUUID() }],
    },
    {
      ...policy,
      approvals: [first, { ...second, planHash: "0".repeat(64) }],
    },
    {
      ...policy,
      approvals: [first, { ...second, targets: first.targets }],
    },
    {
      ...policy,
      targets: policy.targets.map((target) => ({
        ...target,
        generation: target.generation + 1,
      })),
    },
  ];
  for (const management of attacks) {
    const freshness = f.second.context.plexBindingExecution();
    await expect(
      f.first.db.$transaction(async (tx) => {
        await bindPlexTransactionDeadline(tx, freshness);
        await insertCandidate(tx, f.attempt.id, { ...f.identity, management });
      }),
    ).rejects.toThrow(/Managed batch/u);
  }
  await expect(
    f.first.db.$transaction((tx) =>
      insertCandidate(tx, f.attempt.id, f.identity),
    ),
  ).rejects.toThrow(/deadline/iu);
  expect(
    await f.first.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.attempt.id },
    }),
  ).toEqual(f.attempt);
  expect(await f.first.db.acquisitionAttempt.count()).toBe(1);
  expect(f.second.wire.additions()).toBe(0);
}, 60_000);

test("a reserved batch birth cannot replace its original receipt, generations or coverage", async () => {
  const f = await fixture();
  await expect(
    f.first.db.acquisitionAttempt.update({
      where: { id: f.attempt.id },
      data: {
        identityEvidence: {
          ...f.identity,
          management: { ...f.identity.management, approvals: [] },
        },
      },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    f.first.db.acquisitionAttempt.update({
      where: { id: f.attempt.id },
      data: { generations: {} },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    f.first.db.acquisitionAttempt.update({
      where: { id: f.attempt.id },
      data: { mediaIds: f.first.ids },
    }),
  ).rejects.toThrow("immutable");
  expect(
    await f.first.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.attempt.id },
    }),
  ).toEqual(f.attempt);
}, 60_000);

test("expiry between actual approvals retains the original SDK guard and shared allowance", async () => {
  const f = await fixture();
  const policy = f.identity.management;
  if (policy.schemaVersion !== 3) throw new Error("Batch policy missing");
  const originalExecution = f.second.context.plexBindingExecution();
  const access = await f.second.context.plexAccess("show");
  const budget = new PublicationAuthorityReadBudget();
  const expiry = new Error("Original SDK expired between actual approvals");
  // Revalidation charges receipt + plan + owner + association for each source.
  const freshness = {
    expiresAtMs: originalExecution.expiresAtMs,
    assertActive: () => {
      originalExecution.assertActive();
      if (budget.take <= 97) throw expiry;
    },
  };
  await expect(
    f.first.db.$transaction(async (tx) => {
      await lockAcquisitionMedia(tx, f.second.ids);
      expect(await lockRuntimeAuthority(tx, 0)).toBe(true);
      await readLibrarySeriesManagement(
        tx,
        { mediaIds: f.second.ids, epoch: 0, access, expected: policy },
        { access, budget, freshness },
      );
    }),
  ).rejects.toBe(expiry);
  expect(budget.take).toBe(97);
  expect(f.second.wire.additions()).toBe(0);
}, 60_000);

test("separately approved episode profiles cannot combine into one pack policy", async () => {
  const first = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const current = await first.db.qualityProfile.findUniqueOrThrow({
    where: { id: first.profile.id },
  });
  const profile = await first.db.qualityProfile.create({
    data: {
      name: "Separate actual imported policy",
      rules: QualityRulesSchema.parse(current.rules),
    },
  });
  await first.db.qualityProfileVersion.create({
    data: {
      profileId: profile.id,
      version: profile.version,
      rules: QualityRulesSchema.parse(profile.rules),
    },
  });
  const second = await extendManagedSeriesBatch(
    { ...first, handoff: { ...first.handoff, profile } },
    upgrade,
  );
  const access = await second.context.plexAccess("show");
  const invocation = {
    access,
    budget: new PublicationAuthorityReadBudget(),
    freshness: second.context.plexBindingExecution(),
  };
  await expect(
    first.db.$transaction(async (tx) => {
      await lockAcquisitionMedia(tx, second.ids);
      expect(await lockRuntimeAuthority(tx, 0)).toBe(true);
      return readLibrarySeriesManagement(
        tx,
        { mediaIds: second.ids, epoch: 0, access },
        invocation,
      );
    }),
  ).rejects.toMatchObject({ code: "library_management_unconfirmed" });
  expect(
    await first.db.acquisitionAttempt.count({
      where: { mediaIds: { hasSome: second.ids } },
    }),
  ).toBe(0);
  expect(second.wire.additions()).toBe(0);
}, 60_000);
