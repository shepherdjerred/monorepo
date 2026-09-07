import { useDelayedLoading } from "@shepherdjerred/loaded/react.tsx";
import { LoadingState } from "@scout-for-lol/design-system/domain/states";

/**
 * Minimal Suspense fallback for a routed section — matches the muted
 * "Loading…" text the sections rendered inline before they moved to
 * `useSuspenseQuery`. Delayed so a fast load never flashes the status line.
 */
export function SectionSkeleton() {
  const show = useDelayedLoading(true);
  if (!show) {
    return null;
  }
  return (
    <p role="status" className="text-sm text-scout-subtle">
      Loading…
    </p>
  );
}

/**
 * Full-page spinner used from `Loaded.match` loading branches, where a hook
 * cannot run. Mounted only while loading, so it delays appearance but cannot
 * hold for min-duration after data arrives — use `useDelayedLoading` at the
 * parent for that.
 */
export function DelayedLoadingState(props: { label?: string }) {
  const show = useDelayedLoading(true);
  if (!show) {
    return null;
  }
  return (
    <LoadingState
      {...(props.label === undefined ? {} : { label: props.label })}
    />
  );
}
