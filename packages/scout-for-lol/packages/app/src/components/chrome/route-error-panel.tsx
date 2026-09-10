import { useEffect, type ReactNode } from "react";
import {
  isRouteErrorResponse,
  useLocation,
  useNavigate,
  useRouteError,
} from "react-router";
import * as Sentry from "@sentry/react";
import { z } from "zod";
import { Button } from "@scout-for-lol/design-system/components/button";
import { cn } from "#src/lib/cn.ts";
import { queryClient } from "#src/lib/query/query-client.ts";
import { RouteParameterError } from "#src/lib/routes/route-params.ts";

const ErrorMessageSchema = z.object({ message: z.string() });
const HttpStatusErrorSchema = z.object({
  data: z.object({ httpStatus: z.number() }),
});

/** Best-effort human-readable detail from an unknown thrown value. */
function errorDetail(error: unknown): string | null {
  const parsed = ErrorMessageSchema.safeParse(error);
  return parsed.success ? parsed.data.message : null;
}

/**
 * Expected client-side failures — a malformed detail URL, or a link to a
 * deleted report/competition/player (a tRPC NOT_FOUND / 4xx). These are routine
 * boundary input, not actionable exceptions, so they show the friendly panel
 * without a Sentry incident. Only unexpected (5xx / unclassified) errors report.
 */
export function isExpectedRouteError(error: unknown): boolean {
  // Only Zod failures explicitly wrapped by the route-param boundary are
  // expected. Unrelated Zod errors signal application-data contract drift and
  // must remain observable.
  if (error instanceof RouteParameterError) {
    return true;
  }
  if (isRouteErrorResponse(error)) {
    return error.status >= 400 && error.status < 500;
  }
  const parsed = HttpStatusErrorSchema.safeParse(error);
  return (
    parsed.success &&
    parsed.data.data.httpStatus >= 400 &&
    parsed.data.data.httpStatus < 500
  );
}

/** A friendly, self-contained error panel with retry affordance. */
export function ErrorPanel(props: {
  title?: string;
  message?: ReactNode;
  detail?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-scout-danger/40 bg-scout-surface p-8 text-center",
        props.className,
      )}
    >
      <h2 className="text-base font-semibold text-scout-danger">
        {props.title ?? "Something went wrong"}
      </h2>
      {props.message !== undefined && (
        <p className="mx-auto mt-2 max-w-sm text-sm text-scout-subtle">
          {props.message}
        </p>
      )}
      {props.detail !== undefined && props.detail !== null && (
        <p className="mx-auto mt-2 max-w-sm text-xs text-scout-subtle">
          {props.detail}
        </p>
      )}
      {props.children}
      {(props.onRetry !== undefined || props.action !== undefined) && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {props.onRetry !== undefined && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={props.onRetry}
            >
              {props.retryLabel ?? "Try again"}
            </Button>
          )}
          {props.action}
        </div>
      )}
    </div>
  );
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
    if (isExpectedRouteError(error)) return;
    Sentry.captureException(error);
  }, [error]);

  const detail = errorDetail(error);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8 sm:py-12">
      <ErrorPanel
        title="Something went wrong"
        message="This section failed to load. You can try again — if it keeps happening, reload the page."
        detail={detail}
        onRetry={() => {
          // Drop every errored query so the re-navigation refetches from a
          // clean slate instead of resurfacing the cached failure.
          void queryClient.resetQueries({
            predicate: (query) => query.state.status === "error",
          });
          void navigate(`${location.pathname}${location.search}`, {
            replace: true,
          });
        }}
      />
    </div>
  );
}
