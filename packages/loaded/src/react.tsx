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
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Loaded,
  type LoadedData,
  type LoadedErrors,
  type LoadedMeta,
  type LoadedRecord,
} from "@shepherdjerred/loaded/index.ts";
import {
  LOADING_INDICATOR_DELAY_MS,
  LOADING_INDICATOR_MIN_DURATION_MS,
  scheduleDelayedLoading,
} from "@shepherdjerred/loaded/delayed-loading.ts";

export type DelayedLoadingOptions = {
  readonly delayMs?: number;
  readonly minDurationMs?: number;
};

/**
 * True only after `busy` has lasted `delayMs`, and remains true until the
 * indicator has been visible for `minDurationMs`.
 *
 * First paint with a non-zero delay is false, so a fast load never mounts a
 * spinner. Pass `delayMs: 0` when the caller must acknowledge immediately.
 */
export function useDelayedLoading(
  busy: boolean,
  options?: DelayedLoadingOptions,
): boolean {
  const delayMs = options?.delayMs ?? LOADING_INDICATOR_DELAY_MS;
  const minDurationMs =
    options?.minDurationMs ?? LOADING_INDICATOR_MIN_DURATION_MS;
  const [visible, setVisible] = useState(
    () =>
      scheduleDelayedLoading({
        busy,
        visible: false,
        visibleSince: null,
        now: 0,
        delayMs,
        minDurationMs,
      }).visible,
  );
  const visibleSinceRef = useRef<number | null>(visible ? Date.now() : null);

  useEffect(() => {
    const now = Date.now();
    const plan = scheduleDelayedLoading({
      busy,
      visible,
      visibleSince: visibleSinceRef.current,
      now,
      delayMs,
      minDurationMs,
    });
    if (plan.waitMs === null) {
      if (plan.visible !== visible) {
        visibleSinceRef.current = plan.visible ? now : null;
        setVisible(plan.visible);
      }
      return;
    }
    const id = setTimeout(() => {
      const firedAt = Date.now();
      visibleSinceRef.current = busy ? firedAt : null;
      setVisible(busy);
    }, plan.waitMs);
    return () => {
      clearTimeout(id);
    };
  }, [busy, delayMs, minDurationMs, visible]);

  return visible;
}

export type LoadingBlockDefaultsValue = {
  readonly fallback: ReactNode;
  readonly renderError: (errors: LoadedErrors) => ReactNode;
  readonly delayMs: number;
  readonly minDurationMs: number;
};

function renderDefaultError(errors: LoadedErrors): ReactNode {
  return <div role="alert">Something went wrong ({errors.length}).</div>;
}

const LoadingBlockContext = createContext<LoadingBlockDefaultsValue>({
  fallback: undefined,
  renderError: renderDefaultError,
  delayMs: LOADING_INDICATOR_DELAY_MS,
  minDurationMs: LOADING_INDICATOR_MIN_DURATION_MS,
});

/**
 * Supplies the app-wide spinner and error surface, so an individual
 * `LoadingBlock` only names them when it wants something different.
 */
export function LoadingBlockDefaults({
  fallback,
  renderError,
  delayMs = LOADING_INDICATOR_DELAY_MS,
  minDurationMs = LOADING_INDICATOR_MIN_DURATION_MS,
  children,
}: {
  readonly fallback: ReactNode;
  readonly renderError: (errors: LoadedErrors) => ReactNode;
  readonly delayMs?: number;
  readonly minDurationMs?: number;
  readonly children: ReactNode;
}): ReactNode {
  const value = useMemo(
    () => ({ fallback, renderError, delayMs, minDurationMs }),
    [fallback, renderError, delayMs, minDurationMs],
  );
  return <LoadingBlockContext value={value}>{children}</LoadingBlockContext>;
}

export function LoadingBlock<T extends LoadedRecord>({
  values,
  children,
  fallback,
  renderError,
  delayMs,
  minDurationMs,
}: {
  readonly values: T;
  readonly children: (data: LoadedData<T>, meta: LoadedMeta) => ReactNode;
  readonly fallback?: ReactNode;
  readonly renderError?: (errors: LoadedErrors) => ReactNode;
  readonly delayMs?: number;
  readonly minDurationMs?: number;
}): ReactNode {
  const defaults = useContext(LoadingBlockContext);
  const joined = Loaded.all(values);
  const showFallback = useDelayedLoading(joined.status === "loading", {
    delayMs: delayMs ?? defaults.delayMs,
    minDurationMs: minDurationMs ?? defaults.minDurationMs,
  });
  const resolvedFallback =
    fallback === undefined ? defaults.fallback : fallback;
  const resolvedError = renderError ?? defaults.renderError;
  // Errors are never delayed. A spinner that was already showing yields to
  // the error surface immediately rather than holding for minDuration.
  if (joined.status === "error") {
    return resolvedError(joined.errors);
  }
  if (showFallback) {
    return resolvedFallback;
  }
  return Loaded.match(joined, {
    loading: () => null,
    error: resolvedError,
    available: children,
  });
}
