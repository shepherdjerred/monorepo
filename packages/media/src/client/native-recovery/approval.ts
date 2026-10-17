import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import type { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { writeApi } from "#client/api.ts";
import { nativeReviewAcknowledged } from "./acknowledgement.ts";

export function useNativeReviewApproval(input: {
  user: MediaUser;
  id: string;
  acknowledgement: string | null;
  onSuccess: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const review = queryClient.getQueryData<
        z.infer<typeof NativeLifecycleDetailSchema>
      >(["native-recovery-detail", input.id]);
      if (
        !nativeReviewAcknowledged(input.acknowledgement, review) ||
        review?.planHash == null
      )
        throw new Error(
          "The file proof changed. Review it again before applying.",
        );
      return writeApi({
        actorId: input.user.id,
        path: `/admin/native-recovery/${input.id}/apply`,
        schema: CommandResultSchema,
        body: {
          expectedVersion: review.version,
          planHash: review.planHash,
          recoveryEpoch: review.scope.request.recoveryEpoch,
          runtimeVersion: review.scope.request.runtimeVersion,
          ...acknowledgements(review),
        },
      });
    },
    onSuccess: input.onSuccess,
  });
}

function acknowledgements(review: z.infer<typeof NativeLifecycleDetailSchema>) {
  return review.scope.schemaVersion === 2 &&
    review.scope.lifecycleKind === "publication_compensation"
    ? {
        acknowledgeCompensationOnly: true,
        acknowledgeRecoveryHolds: true,
        acknowledgeSuccessorRetained: true,
      }
    : {
        acknowledgePhysicalOwnershipOnly: true,
        acknowledgeRecoveryHolds: true,
        acknowledgeSubtitlePolicies: true,
      };
}
