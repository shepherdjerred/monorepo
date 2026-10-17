import type { Prisma } from "#generated/prisma/client.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { NativeCompensationExecutionNetworkEvidenceSchema } from "#shared/native-recovery/compensation.ts";
import { assertNativeCompensation } from "#infrastructure/native-compensation/guards.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { assertNativeEvidenceFresh } from "#automation/native-recovery/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { assertPublicationActive } from "#automation/publication-proof/invocation.ts";
import type { CompensationFileContext } from "./execution.ts";

export async function compensationAuthority(
  tx: Prisma.TransactionClient,
  context: CompensationFileContext,
  input: NativeCompensationActivityInput,
) {
  assertPublicationActive(context.files);
  const current = await assertNativeCompensation(tx, input);
  assertPublicationActive(context.files);
  if (current.completion !== null) return { ...current, network: null };
  const observation = await tx.nativeRecoveryObservation.findFirstOrThrow({
    where: {
      planId: current.planId,
      kind: "compensation_network",
      AND: [
        {
          evidence: { path: ["continuationId"], equals: input.continuationId },
        },
        { evidence: { path: ["operationId"], equals: input.operationId } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  const network = NativeCompensationExecutionNetworkEvidenceSchema.parse(
    observation.evidence,
  );
  if (
    network.continuationId !== input.continuationId ||
    network.operationId !== input.operationId ||
    network.descriptorHash !== current.descriptorHash ||
    network.recoveryEpoch !== input.recoveryEpoch ||
    network.planId !== current.planId ||
    observation.evidenceHash !== snapshotHash(nativeJson(network)) ||
    observation.expiresAt <= new Date()
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
    await context.files.verifyStorageAuthority(context.files.roots[kind]);
    assertPublicationActive(context.files);
  }
  assertNativeEvidenceFresh(network);
  return { ...current, network };
}
