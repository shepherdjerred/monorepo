import type { BootstrapData } from "#client/data/api.ts";
import { useLiveStatus } from "./connection.ts";
import { useRemoteEdit } from "./remote-activity.ts";

/** "Live" while the stream is open, "Reconnecting…" while it is not. */
export function LiveIndicator({ className }: { className: string }) {
  const { status } = useLiveStatus();
  if (status !== "live" && status !== "reconnecting") {
    return null;
  }
  return (
    <span className={`live-indicator ${className}`} data-status={status}>
      <span className="live-dot" aria-hidden="true" />
      {status === "live" ? "Live" : "Reconnecting…"}
    </span>
  );
}

/**
 * Announces a lost or restored stream once, politely. The indicators
 * themselves are not live regions, so nothing repeats per change.
 */
export function LiveAnnouncer() {
  const { announcement } = useLiveStatus();
  return (
    <p className="sr-only" role="status">
      {announcement}
    </p>
  );
}

/** "Updated by <actor> just now", for a few seconds after a remote change. */
export function RemoteEditNotice({
  identifier,
  actors,
}: {
  identifier: string;
  actors: BootstrapData["actors"];
}) {
  const edit = useRemoteEdit(identifier);
  if (edit === undefined) {
    return null;
  }
  // An actor's first change refetches the workspace, which then names them.
  const name = actors.find((actor) => actor.id === edit.actorId)?.name;
  return (
    // Keyed by the change, so a newer one starts the fade again.
    <span key={edit.at} className="remote-edit">
      {name === undefined ? "Updated" : `Updated by ${name}`}
      {/* Dropped on narrow screens so the name is never cut off. */}
      <span className="remote-edit-when"> just now</span>
    </span>
  );
}
