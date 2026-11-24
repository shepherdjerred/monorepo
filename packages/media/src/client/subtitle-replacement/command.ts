import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import type {
  ApplySubtitleReplacementSchema,
  ReconcileSubtitleReplacementSchema,
} from "#shared/subtitle-replacement.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { writeApi, writeOutcome } from "#client/api.ts";
import { commandNeedsReview } from "#client/target-controls/errors.tsx";

type Submission =
  | { action: "apply"; body: z.infer<typeof ApplySubtitleReplacementSchema> }
  | {
      action: "reconcile";
      body: z.infer<typeof ReconcileSubtitleReplacementSchema>;
    };

export function writeSubtitleReplacementCommand(input: {
  actorId: string;
  id: string;
  submission: Submission;
}) {
  return writeApi({
    actorId: input.actorId,
    path: `/admin/subtitle-replacements/${input.id}/${input.submission.action}`,
    body: input.submission.body,
    schema: CommandResultSchema,
  });
}

export function useSubtitleReplacementCommand(
  actorId: string,
  id: string,
  committed: () => Promise<void>,
) {
  const mutation = useMutation({
    mutationFn: writeSubtitleReplacementCommand,
    onSuccess: committed,
  });
  const unknown =
    mutation.error !== null && writeOutcome(mutation.error) === "unknown";
  return {
    ...mutation,
    unknown,
    blocked:
      mutation.isPending || unknown || commandNeedsReview(mutation.error),
    submit: (submission: Submission) => {
      if (unknown || mutation.isPending || commandNeedsReview(mutation.error))
        return;
      mutation.mutate({ actorId, id, submission });
    },
    retryOriginal: () => {
      if (unknown) mutation.mutate(mutation.variables);
    },
  };
}
