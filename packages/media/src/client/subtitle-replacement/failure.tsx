import { RotateCwIcon } from "lucide-react";
import { Button } from "#client/ui/button.tsx";
import { ActionFailure } from "#client/ui/workflow.tsx";
import { commandNeedsReview } from "#client/target-controls/errors.tsx";

/**
 * A subtitle command that did not go through, by what the page can say about
 * the state afterwards:
 *
 * - a conflict (409): the title changed, and the action was not applied;
 * - no answer, or a server failure: the page cannot tell whether it was
 *   applied, so the original action can be sent again exactly as before;
 * - any other refusal: nothing was changed.
 */
export function CommandFailure({
  error,
  what,
  unknown,
  pending,
  onReview,
  onRetry,
}: {
  error: Error | null;
  /** What was being done: "The replacement". */
  what: string;
  unknown: boolean;
  pending: boolean;
  /** Clears the error and loads the latest details. */
  onReview: () => void;
  onRetry: () => void;
}) {
  if (error === null) return null;
  if (commandNeedsReview(error)) {
    return (
      <ActionFailure
        title={`${what} was not applied`}
        error={error}
        state="This title changed after you opened the review. Nothing was changed. Review the latest details before trying again."
        action={
          <Button onClick={onReview}>
            <RotateCwIcon aria-hidden="true" />
            Review latest details
          </Button>
        }
      />
    );
  }
  if (unknown) {
    return (
      <ActionFailure
        title={`${what}: no answer`}
        error={error}
        state="This page cannot tell whether the action was applied. Send the original action again, exactly as before, to find out."
        action={
          <Button busy={pending} onClick={onRetry}>
            Retry the original action
          </Button>
        }
      />
    );
  }
  return (
    <ActionFailure
      title={`${what} was refused`}
      error={error}
      state="The request was refused, so nothing was changed."
    />
  );
}
