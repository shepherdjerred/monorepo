import type { Session } from "@shepherdjerred/streambot/session/session-types.ts";

const versions = new WeakMap<
  Pick<Session, "actor">,
  { epoch: string; snapshot: unknown; version: number }
>();

/** Changes for actor events, including repeated identical media, but never for progress polling. */
export function sessionRevision(session: Pick<Session, "actor">): string {
  const snapshot = session.actor.getSnapshot();
  let tracked = versions.get(session);
  if (tracked === undefined) {
    tracked = { epoch: crypto.randomUUID(), snapshot, version: 0 };
    versions.set(session, tracked);
  } else if (tracked.snapshot !== snapshot) {
    tracked.snapshot = snapshot;
    tracked.version += 1;
  }
  return tracked.epoch + ":" + String(tracked.version);
}
