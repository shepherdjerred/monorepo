import { FileOperations } from "#filesystem/operations.ts";
import {
  captureNativeReviewProof,
  assertNativeFilesProof,
} from "#automation/native-recovery/plex-proof.ts";
import { publicationReferences } from "#automation/publication-proof/participants.ts";
import { lockNativeCompensationScope } from "#infrastructure/native-compensation/guards.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  finishCompensationPreparation,
  applyCompensationApproval,
} from "#infrastructure/native-compensation/approval.ts";
import { NativeCompensationNetworkEvidenceSchema } from "#shared/native-recovery/compensation.ts";
import type {
  NativeCompensationPrepareInput,
  NativeCompensationApplyInput,
} from "#shared/native-recovery/compensation-runtime.ts";
import { prepareNativeCompensationProof } from "./proof.ts";
import {
  compensationDeadline,
  type CompensationFileContext,
} from "./execution.ts";

async function approvalNetwork(
  context: CompensationFileContext,
  activity: NativeCompensationPrepareInput | NativeCompensationApplyInput,
) {
  const budget = new PublicationAuthorityReadBudget();
  const plan = await context.files.db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: activity.planId },
  });
  budget.consume(1);
  const plex = await captureNativeReviewProof(
    context.files,
    activity,
    plan.plan,
    {
      execution: context.files.execution,
      budget,
      expiresAtMs: context.execution.expiresAtMs,
    },
  );
  const network = NativeCompensationNetworkEvidenceSchema.parse(plex.network);
  if (
    network.planId !== activity.planId ||
    network.mounts.mounts.some((mount) => mount.podUid !== context.workerPodUid)
  )
    throw new Error("Compensation network proof belongs to another executor");
  return { network, plex };
}

/** The same process-local proof spans preparation and its short final identity/authority transaction. */
export async function approveCompensationFiles(
  context: CompensationFileContext,
  activity: NativeCompensationPrepareInput | NativeCompensationApplyInput,
): Promise<void> {
  const { network, plex } = await approvalNetwork(context, activity);
  const prepared = await prepareNativeCompensationProof(
    context,
    activity.planId,
    plex.budget,
  );
  const deadline = compensationDeadline(prepared.context, network);
  const assertActive = () => {
    deadline();
    plex.freshness.assertActive();
  };
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
      await assertNativeFilesProof(tx, plex);
      assertActive();
      await lockPaths(0, async () => {
        await prepared.assertCurrent();
        assertActive();
        if ("planHash" in activity)
          await applyCompensationApproval(
            tx,
            context,
            {
              activity,
              scope: prepared.scope,
              evidence: prepared.evidence,
              ...(plex.kind === "paired"
                ? { plex: { ref: plex.ref, freshness: plex.freshness } }
                : {}),
            },
            plex.budget,
          );
        else {
          if (plex.kind !== "paired")
            throw new Error(
              "New compensation preparation requires its paired Plex proof",
            );
          await finishCompensationPreparation(
            tx,
            {
              activity,
              scope: prepared.scope,
              evidence: prepared.evidence,
              plex: { ref: plex.ref, freshness: plex.freshness },
            },
            plex.budget,
          );
        }
        await prepared.assertCurrent();
        assertActive();
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
