import { ApiError } from "#client/api.ts";
import { ErrorNotice, Notice } from "#client/components.tsx";

export function commandNeedsReview(error: Error | null): boolean {
  return error instanceof ApiError && error.status === 409;
}

export function CommandError({
  error,
  review,
}: {
  error: Error | null;
  review: () => void;
}) {
  if (error === null) return null;
  if (!commandNeedsReview(error)) return <ErrorNotice error={error} />;
  return (
    <Notice error>
      <p>
        This title changed. Your action was not applied. Review the latest
        details before trying again.
      </p>
      <button className="button subtle" type="button" onClick={review}>
        Review latest details
      </button>
    </Notice>
  );
}
