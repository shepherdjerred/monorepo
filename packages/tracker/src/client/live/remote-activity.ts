import { useSyncExternalStore } from "react";

/** How long "Updated by …" shows on an issue another session changed. */
const remoteNoticeMs = 5000;
/** How long a row another session created is marked as new. */
const freshRowMs = 2000;

/** Keyed entries that each remove themselves after their time is up. */
function createExpiring<V extends object>() {
  let entries: ReadonlyMap<string, V> = new Map();
  const listeners = new Set<() => void>();
  function replace(next: ReadonlyMap<string, V>) {
    entries = next;
    for (const listener of listeners) {
      listener();
    }
  }
  return {
    set: (key: string, value: V, ttlMs: number) => {
      replace(new Map(entries).set(key, value));
      setTimeout(() => {
        // A later entry for the same key keeps its own time.
        if (entries.get(key) === value) {
          const next = new Map(entries);
          next.delete(key);
          replace(next);
        }
      }, ttlMs);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => entries,
  };
}

type RemoteEdit = { actorId: string; at: number };

const remoteEdits = createExpiring<RemoteEdit>();
const freshRows = createExpiring<{ at: number }>();

export function noteRemoteEdit(identifier: string, actorId: string) {
  remoteEdits.set(identifier, { actorId, at: Date.now() }, remoteNoticeMs);
}

export function noteFreshRows(identifiers: string[]) {
  const mark = { at: Date.now() };
  for (const identifier of identifiers) {
    freshRows.set(identifier, mark, freshRowMs);
  }
}

/** The latest change another session made to this issue, while it is news. */
export function useRemoteEdit(identifier: string) {
  return useSyncExternalStore(remoteEdits.subscribe, remoteEdits.get).get(
    identifier,
  );
}

/** Rows another session created a moment ago. */
export function useFreshRows(): ReadonlyMap<string, unknown> {
  return useSyncExternalStore(freshRows.subscribe, freshRows.get);
}
