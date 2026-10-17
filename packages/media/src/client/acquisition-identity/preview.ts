import { IdentityPreviewSchema } from "#shared/acquisition/preview.ts";
import { writeApi } from "#client/api.ts";

/** Keep preview results on the mutation observer: reset detaches in-flight results. */
export function identityPreviewOptions(input: {
  actorId: string;
  mediaId: string;
  releaseId: string;
}) {
  return {
    mutationFn: (mediaIds: string[]) =>
      writeApi({
        actorId: input.actorId,
        path: `/media/${input.mediaId}/releases/${input.releaseId}/identity-preview`,
        body: { mediaIds },
        schema: IdentityPreviewSchema,
      }),
  };
}
