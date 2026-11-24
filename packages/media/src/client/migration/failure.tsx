import { RotateCwIcon } from "lucide-react";
import { ApiError, queryClient } from "#client/api.ts";
import { Button } from "#client/ui/button.tsx";
import { WriteFailure } from "#client/ui/workflow.tsx";

/**
 * A review command that did not go through. The server refuses with
 * `migration_review_stale` when the review, its report, or the runtime moved
 * on after the page loaded; nothing is saved then, and neither is anything
 * for any other refusal. When no answer came back, the review may or may not
 * have been saved, so the page says it cannot tell.
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
    <WriteFailure
      error={error}
      refused={{
        title: `The ${verb} was not recorded`,
        state: stale
          ? "The review changed after you opened it, so nothing was saved. Load the current review and check it again before you decide."
          : "The request was refused, so nothing was saved. Load the current review to confirm.",
      }}
      unknown={{
        title: `Whether the ${verb} was recorded is not known`,
        about: `whether the ${verb} was saved`,
        check: "load the current review to see its decision",
      }}
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
