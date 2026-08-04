import { useSyncExternalStore } from "react";
import { applyEventLine, applySpanLine, createRunView } from "#lib/fold";

// One dashboard holds one live connection, so the store is a module singleton
// consumed via useSyncExternalStore (the React-idiomatic external subscription).
const view = createRunView();
let version = 0;
let connected = false;
let source: EventSource | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

function messageData(event: Event): string | null {
  return "data" in event && typeof event.data === "string" ? event.data : null;
}

function ensureConnected(): void {
  if (source !== undefined) {
    return;
  }
  const stream = new EventSource("/api/stream");
  stream.addEventListener("event", (event) => {
    const data = messageData(event);
    if (data === null) {
      return;
    }
    try {
      applyEventLine(view, data);
      emit();
    } catch {
      // A single malformed line must not kill the live view.
    }
  });
  stream.addEventListener("span", (event) => {
    const data = messageData(event);
    if (data === null) {
      return;
    }
    try {
      applySpanLine(view, data);
      emit();
    } catch {
      // Ignore a malformed span line.
    }
  });
  stream.addEventListener("open", () => {
    connected = true;
    emit();
  });
  stream.addEventListener("error", () => {
    connected = false;
    emit();
  });
  source = stream;
}

function subscribe(listener: () => void): () => void {
  ensureConnected();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

export type RunStream = {
  view: typeof view;
  version: number;
  connected: boolean;
};

export function useRunStream(): RunStream {
  const currentVersion = useSyncExternalStore(subscribe, getVersion);
  return { view, version: currentVersion, connected };
}
