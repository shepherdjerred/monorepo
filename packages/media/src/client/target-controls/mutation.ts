import { useMutation } from "@tanstack/react-query";
import type { DefaultCommandV2 } from "#shared/editions/commands.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { ApiError } from "#client/api.ts";
import { invalidateTarget, writeTarget } from "./api.ts";
import { commandNeedsReview } from "./errors.tsx";

export type TargetSubmission = {
  context: DefaultTargetView;
  command: DefaultCommandV2["command"];
};

export function targetMutationOptions(actorId: string) {
  return {
    mutationFn: (input: TargetSubmission) =>
      writeTarget(actorId, input.context, input.command),
    onSuccess: (_result: unknown, input: TargetSubmission) =>
      invalidateTarget(input.context.scope.mediaId),
    retry: false as const,
  };
}

export function retrySubmission(
  previous: { error: Error | null; variables: TargetSubmission | undefined },
  proposed: TargetSubmission,
): TargetSubmission {
  if (previous.error === null || previous.variables === undefined)
    return proposed;
  return previous.error instanceof ApiError &&
    previous.error.status >= 400 &&
    previous.error.status < 500
    ? proposed
    : previous.variables;
}

export function useTargetCommand(actorId: string) {
  const mutation = useMutation(targetMutationOptions(actorId));
  return {
    ...mutation,
    submit: (input: TargetSubmission) => {
      if (!commandNeedsReview(mutation.error))
        mutation.mutate(retrySubmission(mutation, input));
    },
  };
}
