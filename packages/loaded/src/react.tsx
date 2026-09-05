/**
 * The React eliminator for {@link Loaded}.
 *
 * `LoadingBlock` joins every dependency a subtree needs and establishes a
 * synchronous rendering region once they are all available. Above it, values
 * are asynchronous and composable; below it, they are ordinary props:
 *
 * ```tsx
 * <LoadingBlock values={{ user, organization, permissions }}>
 *   {(data, meta) => (
 *     <>
 *       {meta.errors.length > 0 && <RefreshFailedBanner errors={meta.errors} />}
 *       <Page {...data} />
 *     </>
 *   )}
 * </LoadingBlock>
 * ```
 *
 * `degraded` renders the children, because data that failed to refresh is
 * still data. The errors reach the child through `meta` rather than waiting to
 * be looked up, so a failed refresh cannot go silently unrendered.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  Loaded,
  type LoadedData,
  type LoadedErrors,
  type LoadedMeta,
  type LoadedRecord,
} from "@shepherdjerred/loaded/index.ts";

export type LoadingBlockDefaultsValue = {
  readonly fallback: ReactNode;
  readonly renderError: (errors: LoadedErrors) => ReactNode;
};

function renderDefaultError(errors: LoadedErrors): ReactNode {
  return <div role="alert">Something went wrong ({errors.length}).</div>;
}

const LoadingBlockContext = createContext<LoadingBlockDefaultsValue>({
  fallback: undefined,
  renderError: renderDefaultError,
});

/**
 * Supplies the app-wide spinner and error surface, so an individual
 * `LoadingBlock` only names them when it wants something different.
 */
export function LoadingBlockDefaults({
  fallback,
  renderError,
  children,
}: {
  readonly fallback: ReactNode;
  readonly renderError: (errors: LoadedErrors) => ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const value = useMemo(
    () => ({ fallback, renderError }),
    [fallback, renderError],
  );
  return <LoadingBlockContext value={value}>{children}</LoadingBlockContext>;
}

export function LoadingBlock<T extends LoadedRecord>({
  values,
  children,
  fallback,
  renderError,
}: {
  readonly values: T;
  readonly children: (data: LoadedData<T>, meta: LoadedMeta) => ReactNode;
  readonly fallback?: ReactNode;
  readonly renderError?: (errors: LoadedErrors) => ReactNode;
}): ReactNode {
  const defaults = useContext(LoadingBlockContext);
  return Loaded.match(Loaded.all(values), {
    // `undefined` is a legitimate fallback meaning "render nothing", so this
    // cannot use `??` — that would swallow an explicit `null` fallback too.
    loading: () => (fallback === undefined ? defaults.fallback : fallback),
    error: (errors) =>
      renderError === undefined
        ? defaults.renderError(errors)
        : renderError(errors),
    available: children,
  });
}
