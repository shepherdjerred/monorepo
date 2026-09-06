import type { LoadedError } from "@shepherdjerred/loaded";

import { Alert } from "#src/components/alert.tsx";
import { Button } from "#src/components/button.tsx";
import { EmptyState } from "#src/layout/index.tsx";
import { Spinner } from "#src/components/spinner.tsx";

export function LoadingState(props: { label?: string }) {
  return (
    <EmptyState>
      <Spinner />
      <p>{props.label ?? "Loading…"}</p>
    </EmptyState>
  );
}
export function ErrorState(props: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState>
      <Alert tone="danger">
        <h3>{props.title ?? "Something went wrong"}</h3>
        <p>{props.message}</p>
      </Alert>
      {props.onRetry === undefined ? null : (
        <Button onClick={props.onRetry}>Try again</Button>
      )}
    </EmptyState>
  );
}
export function PermissionState(props: {
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <EmptyState>
      <h2>Permission required</h2>
      <p>{props.message ?? "You don’t have access to this Scout workspace."}</p>
      {props.action}
    </EmptyState>
  );
}

/**
 * The affordance for `Loaded`'s `degraded` state: data is on screen, but the
 * refresh that would have updated it failed.
 *
 * Rendering nothing for an empty list is deliberate — every migrated call site
 * passes `meta.errors` unconditionally, so the caller never has to decide
 * whether the notice applies. `Alert` already emits `role="status"` for
 * non-danger tones, which is right here: stale data is not an error, and it
 * should not interrupt a screen reader the way `role="alert"` would.
 */
export function StaleState(props: { errors: readonly LoadedError[] }) {
  if (props.errors.length === 0) return;
  return (
    <Alert tone="warning">
      <p>Showing the last known data — the most recent refresh failed.</p>
    </Alert>
  );
}
