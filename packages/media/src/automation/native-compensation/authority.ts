import type { Prisma } from "#generated/prisma/client.ts";
import type { PairedNativeProof } from "#automation/native-recovery/plex-proof.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { NativeCompensationExecutionNetworkEvidenceSchema } from "#shared/native-recovery/compensation.ts";
import {
  assertCompensationPhaseCurrent,
  type CompensationExecutionAuthority,
  type CompensationExecutionPhase,
} from "#infrastructure/native-compensation/guards.ts";
import { loadNativeCompensationPlexPhase } from "#infrastructure/plex-binding/native/native-parent.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { CompensationExecutionDiscovery } from "#infrastructure/native-compensation/execution/discovery.ts";
import { assertCompensationDiscovery } from "#infrastructure/native-compensation/execution/discovery-check.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { assertNativeEvidenceFresh } from "#automation/native-recovery/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { assertPublicationActive } from "#automation/publication-proof/invocation.ts";
import type { CompensationFileContext } from "./execution.ts";

/** First capture and current authority share one locked transaction and original clock. */
export async function captureCompensationAuthority(
  tx: Prisma.TransactionClient,
  context: CompensationFileContext,
  input: NativeCompensationActivityInput,
  timing: {
    observed: { wall: number; monotonic: number };
    freshness: PlexBindingFreshness;
    budget: PublicationAuthorityReadBudget;
    discovery: CompensationExecutionDiscovery;
    execution: PlexBindingExecution;
  },
) {
  assertPublicationActive(context.files);
  const { phase, proof } = await loadNativeCompensationPlexPhase(
    tx,
    input,
    { freshness: timing.freshness, expectedRef: timing.discovery.ref },
    timing.budget,
  );
  assertPublicationActive(context.files);
  if (proof === null) return null;
  assertCompensationDiscovery(tx, phase, timing.discovery, timing);
  const plex: PairedNativeProof = {
    kind: "paired",
    ref: proof.ref,
    network: proof.network,
    freshness: plexBindingFreshness({
      observed: timing.observed,
      expiresAtMs: Math.min(timing.freshness.expiresAtMs, proof.expiresAtMs),
      guards: [timing.freshness],
    }),
    budget: timing.budget,
  };
  const authority = await assertCompensationAuthorityCurrent(
    tx,
    context,
    plex,
    phase,
  );
  return { plex, authority, phase };
}

/** Every subsequent transaction loads its own complete phase against the original ref. */
export async function compensationAuthority(
  tx: Prisma.TransactionClient,
  context: CompensationFileContext,
  input: NativeCompensationActivityInput,
  plex: PairedNativeProof,
) {
  assertPublicationActive(context.files);
  plex.freshness.assertActive();
  const { phase, proof } = await loadNativeCompensationPlexPhase(
    tx,
    input,
    { freshness: plex.freshness, expectedRef: plex.ref },
    plex.budget,
  );
  assertPublicationActive(context.files);
  if (proof === null) return null;
  const authority = await assertCompensationAuthorityCurrent(
    tx,
    context,
    plex,
    phase,
  );
  return { phase, authority };
}

/** Refresh mutable knowledge and actual markers within this phase, without rereading its graph. */
export async function assertCompensationAuthorityCurrent(
  tx: Prisma.TransactionClient,
  context: CompensationFileContext,
  plex: PairedNativeProof,
  phase: CompensationExecutionPhase,
) {
  assertPublicationActive(context.files);
  plex.freshness.assertActive();
  await assertCompensationPhaseCurrent(tx, phase);
  assertPublicationActive(context.files);
  plex.freshness.assertActive();
  const network = compensationNetwork(phase.authority, phase.activity, plex);
  for (const kind of ["movies", "tv"] as const) {
    if (
      network.mounts.mounts.find((item) => item.root === `/data/${kind}`)
        ?.podUid !== context.workerPodUid ||
      context.files.verifyPlexExclusion === undefined
    )
      throw new NativeCompensationProtection(
        "compensation_executor_or_exclusion_changed",
      );
    await context.files.verifyPlexExclusion(context.files.roots[kind]);
    assertPublicationActive(context.files);
    plex.freshness.assertActive();
    await context.files.verifyStorageAuthority(context.files.roots[kind]);
    assertPublicationActive(context.files);
    plex.freshness.assertActive();
  }
  assertNativeEvidenceFresh(network);
  return { ...phase.authority, network };
}

function compensationNetwork(
  current: CompensationExecutionAuthority,
  input: NativeCompensationActivityInput,
  plex: PairedNativeProof,
) {
  const network = NativeCompensationExecutionNetworkEvidenceSchema.parse(
    plex.network,
  );
  if (
    network.continuationId !== input.continuationId ||
    network.operationId !== input.operationId ||
    network.descriptorHash !== current.descriptorHash ||
    network.recoveryEpoch !== input.recoveryEpoch ||
    network.planId !== current.planId ||
    plex.ref.parent.operationId !== input.operationId ||
    Date.parse(network.expiresAt) <= Date.now()
  )
    throw new NativeCompensationProtection("compensation_network_changed");
  assertNativeEvidenceFresh(network);
  const paths = [
    ...new Set(
      current.networkScope.requiredAbsences.map((item) => item.canonicalPath),
    ),
  ].sort();
  const absent = [
    ...new Set(network.plex.retainedAbsence.flatMap((item) => item.paths)),
  ].sort();
  if (snapshotHash(paths) !== snapshotHash(absent))
    throw new NativeCompensationProtection(
      "compensation_absence_scope_changed",
    );
  const canonical = current.networkScope.files.map((file) => ({
    assetId: file.assetId,
    mediaIds: file.mediaIds,
    canonicalPath: file.canonicalPath,
  }));
  if (
    snapshotHash(nativeJson(canonical)) !==
    snapshotHash(
      nativeJson(
        network.plex.canonicalPaths.map(
          ({ assetId, mediaIds, canonicalPath }) => ({
            assetId,
            mediaIds,
            canonicalPath,
          }),
        ),
      ),
    )
  )
    throw new NativeCompensationProtection(
      "compensation_canonical_scope_changed",
    );
  return network;
}
