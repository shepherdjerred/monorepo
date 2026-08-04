import { useSyncExternalStore } from "react";
import { applyEventLine, applySpanLine, createRunView } from "#lib/fold";

// One dashboard holds one live connection, so the store is a module singleton
// consumed via useSyncExternalStore (the React-idiomatic external subscription).
const view = createRunView();
let version = 0;
let connected = false;
let streamError: string | null = null;
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
      streamError = null;
      emit();
    } catch (error) {
      // The event stream is authoritative. Silently skipping a malformed line
      // would still advance the sequence high-water mark, permanently dropping
      // that event while the view keeps looking complete — so surface the
      // failure instead of continuing with a misleading partial snapshot.
      streamError = error instanceof Error ? error.message : String(error);
      emit();
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
      // Spans are an explicitly best-effort mirror (see SpanJsonlExporter), so a
      // single malformed span line is safely ignored — unlike an event line.
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
  error: string | null;
};

export function useRunStream(): RunStream {
  const currentVersion = useSyncExternalStore(subscribe, getVersion);
  return { view, version: currentVersion, connected, error: streamError };
}
