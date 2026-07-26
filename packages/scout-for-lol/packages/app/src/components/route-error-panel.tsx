import { useEffect } from "react";
import { useLocation, useNavigate, useRouteError } from "react-router";
import * as Sentry from "@sentry/react";
import { z } from "zod";
import { Button } from "#src/components/ui/button.tsx";
import { queryClient } from "#src/lib/query-client.ts";

const ErrorMessageSchema = z.object({ message: z.string() });

/** Best-effort human-readable detail from an unknown thrown value. */
function errorDetail(error: unknown): string | null {
  const parsed = ErrorMessageSchema.safeParse(error);
  return parsed.success ? parsed.data.message : null;
}

/**
 * `errorElement` for data-router routes. Reports the caught error to Sentry
 * once, shows a friendly panel, and offers a "Try again" that clears every
 * errored query from the cache and re-navigates to the current URL so the
 * route's loader + components re-run against a clean slate.
 */
export function RouteErrorPanel() {
  const error = useRouteError();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const detail = errorDetail(error);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <div className="rounded-lg border border-destructive/40 bg-card p-8 text-center">
        <h2 className="text-base font-semibold text-destructive">
          Something went wrong
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          This section failed to load. You can try again — if it keeps
          happening, reload the page.
        </p>
        {detail !== null && (
          <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">
            {detail}
          </p>
        )}
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              // Drop every errored query so the re-navigation refetches from a
              // clean slate instead of resurfacing the cached failure.
              void queryClient.resetQueries({
                predicate: (query) => query.state.status === "error",
              });
              void navigate(`${location.pathname}${location.search}`, {
                replace: true,
              });
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
