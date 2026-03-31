import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Core type machinery ──

/** Extract the TData type parameter from a single UseQueryResult. */
type InferQueryData<T> =
  T extends UseQueryResult<infer TData, unknown> ? TData : never;

/**
 * Map a tuple of UseQueryResult types to a tuple of their data types.
 *
 * Preserves positional typing:
 *   [UseQueryResult<Session[]>, UseQueryResult<HealthCheckResult>]
 *     → [Session[], HealthCheckResult]
 */
type QueriesData<T extends readonly UseQueryResult<unknown, unknown>[]> = {
  [K in keyof T]: InferQueryData<T[K]>;
};

// ── Props ──

type LoadingBlockProps<
  TQueries extends readonly UseQueryResult<unknown, unknown>[],
> = {
  /** Tuple of TanStack Query results. */
  queries: [...TQueries];
  /** Called when ALL queries have data. Receives each data value as a positionally-typed argument. */
  renderSuccess: (...data: QueriesData<TQueries>) => ReactNode;
  /** Called when any query is in initial loading state (no data yet). */
  renderLoading?: () => ReactNode;
  /** Called when any query has errored. */
  renderError?: (errors: Error[], retry: () => void) => ReactNode;
};

// ── Default renderers ──

export function DefaultLoadingRenderer(): ReactNode {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
        <p className="text-muted-foreground font-mono">Loading...</p>
      </div>
    </div>
  );
}

export function DefaultErrorRenderer({
  errors,
  retry,
}: {
  errors: Error[];
  retry: () => void;
}): ReactNode {
  return (
    <div
      className="m-4 p-4 border-4 font-mono"
      style={{
        backgroundColor: "hsl(0, 75%, 95%)",
        color: "hsl(0, 75%, 40%)",
        borderColor: "hsl(0, 75%, 50%)",
      }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          {errors.map((error, i) => (
            <div key={i}>
              <strong className="font-bold">ERROR:</strong> {error.message}
            </div>
          ))}
          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retry}
              className="cursor-pointer"
            >
              Retry
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Component ──

/**
 * Composes one or more TanStack Query results into loading/error/success states.
 *
 * Uses `const` generics to preserve tuple literal types, so `renderSuccess`
 * receives each data value as a separate positionally-typed argument.
 *
 * @example
 * // Single query
 * <LoadingBlock
 *   queries={[sessionsQuery]}
 *   renderSuccess={(sessions) => <SessionGrid sessions={sessions} />}
 * />
 *
 * @example
 * // Multiple queries — sessions: Session[], health: HealthCheckResult
 * <LoadingBlock
 *   queries={[sessionsQuery, healthQuery]}
 *   renderSuccess={(sessions, health) => (
 *     <Dashboard sessions={sessions} health={health} />
 *   )}
 * />
 */
export function LoadingBlock<
  const TQueries extends readonly UseQueryResult<unknown, unknown>[],
>({
  queries,
  renderSuccess,
  renderLoading,
  renderError,
}: LoadingBlockProps<TQueries>): ReactNode {
  // Collect errors from failed queries, coercing unknown → Error
  const errors = queries
    .filter((q) => q.isError)
    .map((q) =>
      q.error instanceof Error ? q.error : new Error(String(q.error)),
    );

  if (errors.length > 0) {
    const retry = () => {
      for (const q of queries) {
        if (q.isError) void q.refetch();
      }
    };

    if (renderError != null) {
      return renderError(errors, retry);
    }

    return <DefaultErrorRenderer errors={errors} retry={retry} />;
  }

  // Check if any query is still in initial loading (no data yet)
  if (queries.some((q) => q.isLoading)) {
    if (renderLoading != null) {
      return renderLoading();
    }

    return <DefaultLoadingRenderer />;
  }

  // All queries have data — extract into typed tuple.
  // The cast is sound: we've verified no query is loading or errored above.
  const data = queries.map((q) => q.data) as unknown as QueriesData<TQueries>;
  return renderSuccess(...data);
}
