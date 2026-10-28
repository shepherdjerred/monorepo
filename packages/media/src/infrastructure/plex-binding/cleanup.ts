import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { UpgradeCleanupPlan } from "#shared/native-recovery/archive-plan.ts";
import {
  UpgradeCleanupPlexEvidenceSchema,
  UpgradeCleanupPlexStoredSchema,
  type UpgradeCleanupPlexInput,
  type UpgradeCleanupPlexExpected,
  type UpgradeCleanupPlexEvidence,
} from "#shared/plex-binding/cleanup.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import type { VerifiedServingPlex } from "#shared/plex-binding/observations.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  captureUpgradeCleanupExpected,
  lockUpgradeCleanupObservation,
  readUpgradeCleanupCommand,
} from "./cleanup-scope.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "./freshness.ts";
import { PlexBindingProtection } from "./errors.ts";
import type { VerifiedMovieServingPlexV2 } from "#shared/movie-editions/plex-v2.ts";

import type { CleanupObservationInvocation } from "./cleanup/invocation.ts";

/** Network calls before IO, after resolving only the required trusted section config. */
export async function prepareUpgradeCleanupObservation(
  tx: Prisma.TransactionClient,
  input: UpgradeCleanupPlexInput,
  access: readonly PlexAccess[],
  invocation: CleanupObservationInvocation,
) {
  const { freshness } = invocation;
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const command = await readUpgradeCleanupCommand(tx, input);
  if (command.cleanup.state === "purged")
    return { status: "complete" as const };
  freshness.assertActive();
  const expected = await captureUpgradeCleanupExpected(
    tx,
    input,
    access,
    invocation,
  );
  const bounded = plexBindingFreshness({
    observed,
    expiresAtMs: Math.min(
      freshness.expiresAtMs,
      Date.parse(expected.authorityExpiresAt),
    ),
    guards: [freshness],
  });
  await lockUpgradeCleanupObservation(tx, expected, bounded);
  await assertUpgradeCleanupExpected(tx, expected, access, {
    ...invocation,
    freshness: bounded,
  });
  return { status: "pending" as const, expected, freshness: bounded };
}

/** Strict literal subtree, unlike mutable Operation.result reason/other siblings. No authority until final assertion. */
export async function loadUpgradeCleanupObservation(
  tx: Prisma.TransactionClient,
  input: UpgradeCleanupPlexInput,
) {
  const { operation, cleanup } = await readUpgradeCleanupCommand(tx, input);
  if (cleanup.state === "purged") return { status: "complete" as const };
  const stored = z
    .object({
      upgradeCleanupPlex: z.object({
        evidenceHash: z.string(),
        evidence: z.json(),
      }),
    })
    .safeParse(operation.result);
  if (!stored.success)
    throw new PlexBindingProtection("reconciliation_required");
  const raw = stored.data.upgradeCleanupPlex;
  if (identityHash(raw.evidence) !== raw.evidenceHash)
    throw new Error("Cleanup Plex evidence raw hash changed");
  const value = UpgradeCleanupPlexStoredSchema.parse(raw).evidence;
  if (
    value.expected.operationId !== input.operationId ||
    value.expected.cleanupId !== input.cleanupId ||
    value.expectedHash !== identityHash(value.expected) ||
    value.expected.commandHash !== identityHash(operation.payload) ||
    value.expected.descriptorHash !== identityHash(value.expected.plan) ||
    value.expected.pathsHash !== identityHash(value.expected.paths)
  )
    throw new Error(
      "Cleanup Plex evidence lost its exact command or descriptor",
    );
  return { status: "observed" as const, evidence: value };
}

/** Session producer supplies only clear completion, after complete metadata verification and sessions-last. */
export async function commitUpgradeCleanupObservation(
  tx: Prisma.TransactionClient,
  expected: UpgradeCleanupPlexExpected,
  observed: Omit<
    UpgradeCleanupPlexEvidence,
    "schemaVersion" | "expected" | "expectedHash" | "verification"
  > & { serving: VerifiedServingPlex | VerifiedMovieServingPlexV2 },
  invocation: CleanupObservationInvocation,
): Promise<void> {
  const { freshness } = invocation;
  const { serving, ...timing } = observed;
  serving.freshness.assertActive();
  if (
    serving.associations.length !== expected.bindings.length ||
    serving.associations.some((association, index) => {
      const binding = expected.bindings[index];
      return (
        binding === undefined ||
        identityHash(binding.scope) !== identityHash(association.scope) ||
        binding.associationHash !== identityHash(association)
      );
    })
  )
    throw new PlexBindingProtection("binding_changed");
  const evidence = UpgradeCleanupPlexEvidenceSchema.parse({
    schemaVersion: expected.schemaVersion,
    expected,
    expectedHash: identityHash(expected),
    ...timing,
    verification: serving.verification,
  });
  if (Date.parse(evidence.expiresAt) > freshness.expiresAtMs)
    throw new Error("Cleanup proof exceeds its original invocation deadline");
  const clock = { wall: Date.now(), monotonic: performance.now() };
  if (Date.parse(evidence.completedAt) > clock.wall)
    throw new Error("Cleanup observation completed in the future");
  const bounded = plexBindingFreshness({
    observed: clock,
    expiresAtMs: Date.parse(evidence.expiresAt),
    guards: [freshness, serving.freshness],
  });
  await lockUpgradeCleanupObservation(tx, expected, bounded);
  await assertUpgradeCleanupExpected(tx, expected, expected.access, {
    ...invocation,
    freshness: bounded,
  });
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${expected.operationId} FOR UPDATE`;
  bounded.assertActive();
  const { operation } = await readUpgradeCleanupCommand(tx, {
    operationId: expected.operationId,
    cleanupId: expected.cleanupId,
  });
  const result =
    operation.result === null
      ? {}
      : z.record(z.string(), z.json()).parse(operation.result);
  await bindPlexTransactionDeadline(tx, bounded);
  await tx.operation.update({
    where: { id: operation.id },
    data: {
      result: z.record(z.string(), z.json()).parse({
        ...result,
        upgradeCleanupPlex: {
          evidenceHash: identityHash(evidence),
          evidence,
        },
      }),
    },
  });
  bounded.assertActive();
}

/** Files holds the full expected lock union, then independently compares its journal-certified plan. */
export async function readUpgradeCleanupObservation(
  tx: Prisma.TransactionClient,
  input: UpgradeCleanupPlexInput,
  current: { plan: UpgradeCleanupPlan; access: readonly PlexAccess[] },
  invocation: CleanupObservationInvocation,
) {
  const original = invocation.freshness;
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const result = await loadUpgradeCleanupObservation(tx, input);
  if (result.status === "complete") return result;
  const { evidence } = result;
  const freshness = plexBindingFreshness({
    observed,
    expiresAtMs: Math.min(original.expiresAtMs, Date.parse(evidence.expiresAt)),
    guards: [original],
  });
  if (
    Date.parse(evidence.startedAt) > observed.wall ||
    identityHash(current.plan) !== evidence.expected.descriptorHash
  )
    throw new PlexBindingProtection("scope_changed");
  await assertUpgradeCleanupExpected(tx, evidence.expected, current.access, {
    ...invocation,
    freshness,
  });
  await bindPlexTransactionDeadline(tx, freshness);
  freshness.assertActive();
  return { status: "observed" as const, evidence, freshness };
}

async function assertUpgradeCleanupExpected(
  tx: Prisma.TransactionClient,
  expected: UpgradeCleanupPlexExpected,
  access: readonly PlexAccess[],
  invocation: CleanupObservationInvocation,
) {
  const { freshness } = invocation;
  freshness.assertActive();
  const current = await captureUpgradeCleanupExpected(
    tx,
    { operationId: expected.operationId, cleanupId: expected.cleanupId },
    access,
    invocation,
  );
  freshness.assertActive();
  if (
    Date.parse(current.authorityExpiresAt) < freshness.expiresAtMs ||
    Date.parse(expected.authorityExpiresAt) < freshness.expiresAtMs
  )
    throw new PlexBindingProtection("verification_expired");
  const materialized =
    expected.cleanup.manifestHash === null &&
    current.cleanup.version === expected.cleanup.version + 1 &&
    current.cleanup.manifestHash === expected.descriptorHash;
  const comparable = {
    ...current,
    authorityExpiresAt: expected.authorityExpiresAt,
    cleanup: materialized
      ? {
          ...current.cleanup,
          version: expected.cleanup.version,
          manifestHash: null,
        }
      : current.cleanup,
  };
  if (identityHash(comparable) !== identityHash(expected))
    throw new PlexBindingProtection("scope_changed");
}
