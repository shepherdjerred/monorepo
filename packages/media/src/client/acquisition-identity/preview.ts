import { IdentityPreviewSchema } from "#shared/acquisition/preview.ts";
import { ApiError, writeApi } from "#client/api.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";

/** Keep preview results on the mutation observer: reset detaches in-flight results. */
export function identityPreviewOptions(input: {
  actorId: string;
  mediaId: string;
  releaseId: string;
}) {
  return {
    mutationFn: async ({
      mediaIds,
      context,
    }: {
      mediaIds: string[];
      context: DefaultTargetView;
    }) => {
      if (
        context.access !== "detail" ||
        context.scope.mediaId !== input.mediaId
      )
        throw new ApiError(
          "protection_only",
          "Library access is required to review this release.",
          403,
        );
      const preview = await writeApi({
        actorId: input.actorId,
        path: `/media/${input.mediaId}/releases/${input.releaseId}/identity-preview`,
        body: { mediaIds },
        schema: IdentityPreviewSchema,
      });
      const selected = preview.media.find(
        (media) => media.id === input.mediaId,
      );
      if (selected?.version !== context.expected.mediaVersion)
        throw new ApiError(
          "version_conflict",
          "The title changed while preparing this review. Review the latest details.",
          409,
        );
      return { preview, context };
    },
  };
}
