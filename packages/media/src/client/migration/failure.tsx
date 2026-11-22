import { RotateCwIcon } from "lucide-react";
import { ApiError, queryClient } from "#client/api.ts";
import { Button } from "#client/ui/button.tsx";
import { ActionFailure } from "#client/ui/workflow.tsx";

/**
 * A review command that was refused. The server refuses with
 * `migration_review_stale` when the review, its report, or the runtime moved
 * on after the page loaded; nothing is saved then. Any other failure may have
 * left the review either way, so the page says to load it again.
 */
export function ReviewFailure({
  error,
  verb,
  queryKey,
}: {
  error: Error;
  /** What was being recorded: "approval", "revocation". */
  verb: string;
  /** The reads to load again. */
  queryKey: readonly string[];
}) {
  const stale =
    error instanceof ApiError && error.code === "migration_review_stale";
  return (
    <ActionFailure
      title={`The ${verb} was not recorded`}
      error={error}
      state={
        stale
          ? "The review changed after you opened it, so nothing was saved. Load the current review and check it again before you decide."
          : "As far as this page can tell, nothing was saved. Load the current review to confirm."
      }
      action={
        <Button
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey });
          }}
        >
          <RotateCwIcon aria-hidden="true" />
          Load the current review
        </Button>
      }
    />
  );
}
