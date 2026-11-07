import { FileOperations } from "#filesystem/operations.ts";
import { publicationReferences } from "#automation/publication-proof/participants.ts";
import { publicationRecordNamespace } from "#filesystem/publication-proof/records.ts";
import type { CompensationFileContext } from "#automation/native-compensation/execution.ts";
import type { SeriesPackNativeCompensationScopeV3 } from "#shared/native-recovery/series-pack/scope.ts";

/** Review has no media mutation permission. It holds the complete original
 * participant/WAL operation set and the actual future inverse namespace. */
export async function withSeriesPackNativeReviewPathsV1<T>(
  context: CompensationFileContext,
  scope: SeriesPackNativeCompensationScopeV3,
  input: { planId: string; action: () => Promise<T> },
) {
  const plan = scope.publication.intent.entries.map((item) => item.entry);
  const dependencies = context.files.publicationDependencies;
  const refs = [
    ...publicationReferences(plan),
    ...(dependencies?.references ?? []),
    {
      libraryKind: "tv" as const,
      root: "control" as const,
      path: publicationRecordNamespace({
        transitionId: scope.transition.transitionId,
        continuationId: input.planId,
      }),
    },
  ];
  const files = new FileOperations(context.files.roots.tv, {
    ...(context.files.contentProof === undefined
      ? {}
      : { contentProof: context.files.contentProof }),
    authorize: () =>
      Promise.reject(new Error("Owner review cannot mutate media")),
    ...(context.files.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
  });
  return files.withContentPaths(
    [
      ...new Map(
        refs.map(({ root, path }) => [
          JSON.stringify([root, path]),
          { root, path },
        ]),
      ).values(),
    ],
    input.action,
    [
      ...plan.flatMap((entry) => [
        entry.operationId,
        `recover-${entry.assetId}`,
        ...entry.previousSidecars.flatMap((sidecar) => [
          sidecar.operationId,
          `recover-${sidecar.quarantineId}`,
        ]),
      ]),
      ...(dependencies?.operations ?? []).map((row) => row.id),
    ],
  );
}
