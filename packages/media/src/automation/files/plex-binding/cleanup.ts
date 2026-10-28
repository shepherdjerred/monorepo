import type {
  UpgradeCleanupPlexEvidence,
  UpgradeCleanupPlexInput,
} from "#shared/plex-binding/cleanup.ts";
import type {
  PlexAccess,
  PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";
import {
  loadUpgradeCleanupObservation,
  readUpgradeCleanupObservation,
} from "#infrastructure/plex-binding/cleanup.ts";
import { lockUpgradeCleanupObservation } from "#infrastructure/plex-binding/cleanup-scope.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { FileGuardError, type Transaction } from "#automation/files/types.ts";
import type { UpgradeCleanupPlan } from "#automation/files/upgrade-cleanup-plan.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { CleanupReadInvocation } from "#infrastructure/plex-binding/cleanup/invocation.ts";
import { now } from "#automation/files/types.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import {
  assertLegacyClaimsResolved,
  PendingLegacyClaimsError,
  LEGACY_CLAIM_PROTECTION,
} from "#infrastructure/recovery/legacy-claims/protection.ts";

/** Named cleanup keeps the same knowledge fence without creating a default-edition recovery projection. */
export async function assertCleanupClaims(
  tx: Transaction,
  mediaIds: readonly string[],
  scope?: MovieEditionScope,
) {
  try {
    await assertLegacyClaimsResolved(tx, mediaIds);
  } catch (error) {
    if (
      scope !== undefined &&
      scope.edition !== "default" &&
      error instanceof PendingLegacyClaimsError
    )
      throw new FileGuardError(LEGACY_CLAIM_PROTECTION);
    throw error;
  }
}

export type CleanupPlexProof = {
  input: UpgradeCleanupPlexInput;
  evidence: UpgradeCleanupPlexEvidence;
  freshness: PlexBindingFreshness;
  invocation: CleanupReadInvocation;
};

/** Discovery only. The original Network deadline is never reset at Files pickup. */
export async function captureCleanupPlex(
  context: PublicationContext,
  input: UpgradeCleanupPlexInput,
  observed: { wall: number; monotonic: number },
): Promise<CleanupPlexProof | null> {
  context.execution.assertActive();
  const invocation = {
    budget:
      context.movieManagement?.budget ??
      context.libraryManagement?.budget ??
      new PublicationAuthorityReadBudget(),
    policyTime: now(context),
  };
  const result = await loadUpgradeCleanupObservation(context.db, input);
  if (result.status === "complete") return null;
  const freshness = plexBindingFreshness({
    observed,
    expiresAtMs: Date.parse(result.evidence.expiresAt),
    guards: [context.execution],
  });
  freshness.assertActive();
  return { input, evidence: result.evidence, freshness, invocation };
}

/** Complete captured locks precede the legacy per-file assertions and every effect. */
export async function lockCleanupPlex(
  tx: Transaction,
  input: {
    context: PublicationContext;
    proof: CleanupPlexProof;
    plan: UpgradeCleanupPlan;
    access: readonly PlexAccess[];
  },
): Promise<PlexBindingFreshness | null> {
  const { proof } = input;
  await lockUpgradeCleanupObservation(
    tx,
    proof.evidence.expected,
    proof.freshness,
  );
  const cleanup = await tx.upgradeCleanup.findUniqueOrThrow({
    where: { id: proof.input.cleanupId },
  });
  if (cleanup.state === "purged") return null;
  const targets = await tx.mediaIntent.findMany({
    where: {
      mediaId: { in: proof.evidence.expected.mediaIds },
      edition:
        proof.evidence.expected.schemaVersion === 2
          ? proof.evidence.expected.scope.edition
          : "default",
    },
    select: { mediaId: true, generation: true },
  });
  proof.freshness.assertActive();
  // Preserve the existing Keep/intent refusal after the complete lock cohort is held.
  // The full observation comparison below still checks every other authority field.
  const generations = new Map(
    proof.evidence.expected.targets.map((target) => [
      target.mediaId,
      target.generation,
    ]),
  );
  if (
    targets.length !== generations.size ||
    targets.some(
      (target) => target.generation !== generations.get(target.mediaId),
    )
  )
    throw new FileGuardError("cleanup_generation_changed");
  const checked = await readUpgradeCleanupObservation(
    tx,
    proof.input,
    { plan: input.plan, access: input.access },
    { ...proof.invocation, freshness: proof.freshness },
  );
  if (checked.status === "complete") return null;
  if (identityHash(checked.evidence) !== identityHash(proof.evidence))
    throw new FileGuardError("cleanup_observation_changed");
  const authority = await publicationAuthorityDeadline(tx, input.context, {
    libraryKind: input.plan.libraryKind,
    recoveryEpoch: proof.evidence.expected.recoveryEpoch,
  });
  const freshness = plexBindingFreshness({
    observed: { wall: Date.now(), monotonic: performance.now() },
    expiresAtMs: Math.min(checked.freshness.expiresAtMs, authority.expiresAtMs),
    guards: [proof.freshness, checked.freshness, authority],
  });
  await bindPlexTransactionDeadline(tx, freshness);
  freshness.assertActive();
  return freshness;
}
