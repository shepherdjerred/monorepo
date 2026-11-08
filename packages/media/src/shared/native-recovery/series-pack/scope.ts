import { z } from "zod";
import { NativeRecoveryScopeSchema } from "#shared/native-recovery.ts";
import {
  PrepareNativeCompensationSchema,
  InterruptedPublicationWorkSchema,
  CompensationTransitionRefSchema,
} from "#shared/native-recovery/compensation.ts";
import { SeriesPackPublicationIntentRefV3Schema } from "#shared/acquisition/series-pack-publication-v1.ts";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";

const Forward = z.strictObject({
  operationId: z.uuid(),
  batchIndex: z.int().nonnegative().max(24),
  commandHash: Hash,
  completionHash: Hash,
});

/** Separate protocol: none of the literal historical compensation schemas change. */
export const SeriesPackNativeCompensationScopeV3Schema = z
  .strictObject({
    ...NativeRecoveryScopeSchema.omit({
      schemaVersion: true,
      request: true,
      subtitlePolicies: true,
    }).shape,
    schemaVersion: z.literal(3),
    lifecycleKind: z.literal("publication_compensation"),
    protocol: z.literal("series_pack_publication_v3"),
    request: PrepareNativeCompensationSchema,
    transition: CompensationTransitionRefSchema,
    publication: SeriesPackPublicationIntentRefV3Schema,
    interruptedWork: InterruptedPublicationWorkSchema,
    interruptedAttemptRaw: z.string().min(1).max(4_194_304),
    forwardParents: z.array(Forward).max(7),
    previousCompensation: z
      .strictObject({
        continuationId: z.uuid(),
        descriptorHash: Hash,
        executionHash: Hash.nullable(),
        coordinatorOperationId: z.uuid(),
      })
      .nullable(),
    requiredAbsences: z
      .array(
        z.strictObject({
          assetId: z.uuid(),
          libraryKind: z.literal("tv"),
          canonicalPath: z.string().min(1).max(4096),
        }),
      )
      .max(2525),
  })
  .superRefine((scope, ctx) => {
    const { publication } = scope;
    const intent = publication.intent;
    const same = (a: readonly string[], b: readonly string[]) =>
      a.length === b.length &&
      new Set(a).size === a.length &&
      new Set(b).size === b.length &&
      a.every((id) => b.includes(id));
    if (
      intent.entries.length > 25 ||
      intent.birthEpoch >= scope.request.recoveryEpoch ||
      publication.transitionId !== scope.transition.transitionId ||
      publication.intentHash !== scope.transition.intentHash ||
      intent.attemptId !== scope.transition.attemptId ||
      intent.birthEpoch !== scope.transition.birthEpoch ||
      intent.filePlanHash !== scope.transition.filePlanHash ||
      !same(
        intent.mediaIds,
        scope.media.map((row) => row.id),
      ) ||
      !same(
        intent.entries.flatMap((row) =>
          row.predecessor === null ? [] : [row.predecessor.id],
        ),
        scope.files.map((row) => row.assetId),
      ) ||
      intent.entries.some(
        (row) =>
          row.predecessor === null ||
          row.entry.libraryKind !== "tv" ||
          row.predecessor.id !== row.entry.previousAssetId,
      ) ||
      scope.forwardParents.some((row, index) => row.batchIndex !== index) ||
      new Set(scope.forwardParents.map((row) => row.operationId)).size !==
        scope.forwardParents.length
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Recovery requires the literal complete prior-epoch v3 TV predecessor group and contiguous actual forward parents",
      });
  });

export type SeriesPackNativeCompensationScopeV3 = z.infer<
  typeof SeriesPackNativeCompensationScopeV3Schema
>;
