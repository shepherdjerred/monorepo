import { FileOperations } from "#filesystem/operations.ts";
import { publicationReferences } from "#automation/publication-proof/participants.ts";
import { lockNativeCompensationScope } from "#infrastructure/native-compensation/guards.ts";
import {
  finishCompensationPreparation,
  applyCompensationApproval,
} from "#infrastructure/native-compensation/approval.ts";
import { NativeCompensationNetworkEvidenceSchema } from "#shared/native-recovery/compensation.ts";
import type {
  NativeCompensationPrepareInput,
  NativeCompensationApplyInput,
} from "#shared/native-recovery/compensation-runtime.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { prepareNativeCompensationProof } from "./proof.ts";
import {
  compensationDeadline,
  type CompensationFileContext,
} from "./execution.ts";

async function approvalNetwork(
  context: CompensationFileContext,
  planId: string,
) {
  const observation =
    await context.files.db.nativeRecoveryObservation.findFirstOrThrow({
      where: { planId, kind: "network" },
      orderBy: { createdAt: "desc" },
    });
  if (
    observation.evidenceHash !==
      snapshotHash(nativeJson(observation.evidence)) ||
    observation.expiresAt <= new Date()
  )
    throw new Error("Compensation network proof expired or changed");
  const network = NativeCompensationNetworkEvidenceSchema.parse(
    observation.evidence,
  );
  if (
    network.planId !== planId ||
    network.mounts.mounts.some((mount) => mount.podUid !== context.workerPodUid)
  )
    throw new Error("Compensation network proof belongs to another executor");
  return network;
}

/** The same process-local proof spans preparation and its short final identity/authority transaction. */
export async function approveCompensationFiles(
  context: CompensationFileContext,
  activity: NativeCompensationPrepareInput | NativeCompensationApplyInput,
): Promise<void> {
  const network = await approvalNetwork(context, activity.planId);
  const prepared = await prepareNativeCompensationProof(
    context,
    activity.planId,
  );
  const assertActive = compensationDeadline(prepared.context, network);
  const plan = prepared.scope.intent.entries.map((item) => item.entry);
  const dependencies = prepared.context.files.publicationDependencies;
  const references = [
    ...publicationReferences(plan),
    ...(dependencies?.references ?? []),
  ];
  const operations = [...new Set(plan.map((entry) => entry.libraryKind))]
    .sort()
    .map((kind) => ({
      kind,
      files: new FileOperations(context.files.roots[kind], {
        ...(prepared.context.files.contentProof === undefined
          ? {}
          : { contentProof: prepared.context.files.contentProof }),
        authorize: () =>
          Promise.reject(new Error("Compensation review cannot mutate media")),
        ...(context.files.verifyPlexExclusion === undefined
          ? {}
          : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
      }),
    }));
  const lockPaths = async (
    index: number,
    action: () => Promise<void>,
  ): Promise<void> => {
    const item = operations[index];
    if (item === undefined) {
      await action();
      return;
    }
    await item.files.withContentPaths(
      [
        ...new Map(
          references
            .filter((ref) => ref.libraryKind === item.kind)
            .map(({ root, path }) => [
              JSON.stringify([root, path]),
              { root, path },
            ]),
        ).values(),
      ],
      () => lockPaths(index + 1, action),
      [
        ...plan.flatMap((entry) =>
          entry.libraryKind === item.kind
            ? [
                entry.operationId,
                `recover-${entry.assetId}`,
                ...entry.previousSidecars.flatMap((sidecar) => [
                  sidecar.operationId,
                  `recover-${sidecar.quarantineId}`,
                ]),
              ]
            : [],
        ),
        ...(dependencies?.operations ?? [])
          .filter((operation) => operation.kind === item.kind)
          .map((operation) => operation.id),
      ],
    );
  };
  await context.files.db.$transaction(
    async (tx) => {
      assertActive();
      await lockNativeCompensationScope(tx, prepared.scope);
      assertActive();
      await lockPaths(0, async () => {
        await prepared.assertCurrent();
        assertActive();
        if ("planHash" in activity)
          await applyCompensationApproval(tx, context, {
            activity,
            scope: prepared.scope,
            evidence: prepared.evidence,
          });
        else
          await finishCompensationPreparation(tx, {
            activity,
            scope: prepared.scope,
            evidence: prepared.evidence,
          });
        await prepared.assertCurrent();
        assertActive();
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
