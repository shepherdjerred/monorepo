import { Button } from "#client/ui/button.tsx";
import { Callout } from "#client/ui/feedback.tsx";
import type { MovieHistoryWriteControllerV3 } from "./api.ts";

/**
 * What the last declaration, capture or release did, and where that leaves
 * the review. It sits above the forms so a refusal is not missed below them.
 */
export function MovieHistoryCommandFeedbackV3({
  command,
}: {
  command: MovieHistoryWriteControllerV3;
}) {
  if (command.needsReview) {
    return (
      <Callout
        tone="warn"
        title="Nothing was recorded: this review is out of date"
      >
        <p>
          This capture no longer matches the current facts. Review the current
          edition and ask the owner to capture a fresh household review. No
          fresh confirmation is sent automatically.
        </p>
      </Callout>
    );
  }
  if (command.unresolved !== null) {
    return (
      <Callout
        tone="danger"
        title="Media did not confirm whether this was recorded"
        action={
          <Button busy={command.isPending} onClick={command.retryOriginal}>
            Retry original action
          </Button>
        }
      >
        <p>
          The result has not been acknowledged. Check again using the original
          declaration or release before making another change.
        </p>
      </Callout>
    );
  }
  if (command.error !== null) {
    return (
      <Callout tone="danger" title="Nothing was recorded">
        {command.error.message}
      </Callout>
    );
  }
  return command.isSuccess ? (
    <Callout tone="ok" title="Recorded">
      The action was recorded. Current review details have been refreshed.
    </Callout>
  ) : null;
}
