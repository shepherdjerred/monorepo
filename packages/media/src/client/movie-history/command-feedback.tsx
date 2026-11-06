import { ErrorNotice, Notice } from "#client/components.tsx";
import type { MovieHistoryWriteControllerV3 } from "./api.ts";

export function MovieHistoryCommandFeedbackV3({
  command,
}: {
  command: MovieHistoryWriteControllerV3;
}) {
  if (command.needsReview)
    return (
      <Notice error>
        <p>
          This capture no longer matches the current facts. Review the current
          edition and ask the owner to capture a fresh household review. No
          fresh confirmation is sent automatically.
        </p>
      </Notice>
    );
  if (command.unresolved !== null)
    return (
      <Notice error>
        <p>
          The result has not been acknowledged. Check again using the original
          declaration or release before making another change.
        </p>
        <button
          type="button"
          className="button"
          disabled={command.isPending}
          onClick={command.retryOriginal}
        >
          Retry original action
        </button>
      </Notice>
    );
  if (command.error !== null) return <ErrorNotice error={command.error} />;
  return command.isSuccess ? (
    <Notice>
      The action was recorded. Current review details have been refreshed.
    </Notice>
  ) : null;
}
