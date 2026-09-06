import type { LoadedError } from "@shepherdjerred/loaded";

/**
 * The affordance for `Loaded`'s `degraded` state: data is on screen, but the
 * refresh that would have updated it failed.
 *
 * Without this the dashboard would silently present stale numbers as current,
 * which for an alerting tool is the worst of the three outcomes — worse than an
 * error page, because nothing signals that anything is wrong.
 */
export function StaleNotice({
  errors,
}: {
  readonly errors: readonly LoadedError[];
}): React.JSX.Element | undefined {
  if (errors.length === 0) return undefined;
  return (
    <div className="stale-state" role="status">
      Showing the last known data — the most recent refresh failed.
    </div>
  );
}
