import type { Session } from "@shepherdjerred/streambot/session/session-types.ts";

type RevisionTarget = Pick<Session, "actor"> & {
  readonly station?: unknown;
};

const versions = new WeakMap<
  RevisionTarget,
  { epoch: string; snapshot: unknown; station: unknown; version: number }
>();

/** Changes for actor events and station changes, including repeated identical media, never progress polling. */
export function sessionRevision(session: RevisionTarget): string {
  const snapshot = session.actor.getSnapshot();
  const station = session.station;
  let tracked = versions.get(session);
  if (tracked === undefined) {
    tracked = { epoch: crypto.randomUUID(), snapshot, station, version: 0 };
    versions.set(session, tracked);
  } else if (tracked.snapshot !== snapshot || tracked.station !== station) {
    tracked.snapshot = snapshot;
    tracked.station = station;
    tracked.version += 1;
  }
  return tracked.epoch + ":" + String(tracked.version);
}
