import { useSyncExternalStore } from "react";
import { api, queryClient } from "#client/data/api.ts";
import { bootstrapKey } from "#client/data/cache.ts";
import { currentActor } from "#client/data/identity.ts";
import { notifyError } from "#client/ui/toast.tsx";
import { createLiveSync } from "./live-sync.ts";
import { ownRequests } from "./request-ids.ts";
import { noteFreshRows, noteRemoteEdit } from "./remote-activity.ts";

const streamUrl = "/api/events/stream";
/** A tab hidden this long lets its stream go until it is shown again. */
const hiddenPauseMs = 60_000;

/**
 * `connecting` is the page's first attempt; `reconnecting` any later one,
 * including the browser's own retries; `off` is no stream at all.
 */
type LiveStatus = "off" | "connecting" | "live" | "reconnecting";
type Snapshot = { status: LiveStatus; announcement: string };

let reportedBroken = false;
const sync = createLiveSync({
  client: queryClient,
  fetchIssue: (identifier) =>
    api.issues.byIdentifier.query({
      identifier,
      viewerActorKey: currentActor().key,
    }),
  isOwn: (requestId) => ownRequests.has(requestId),
  onBroken: (reason) => {
    // The server sent something the contract does not allow.
    console.error(`Live update frame broke the contract: ${reason}`);
    if (!reportedBroken) {
      reportedBroken = true;
      // Not this person's action, so it makes no sound or vibration.
      notifyError("Live updates received something unexpected; refreshing.", {
        quiet: true,
      });
    }
  },
  onRemoteIssue: noteRemoteEdit,
  onRemoteCreated: noteFreshRows,
});

const listeners = new Set<() => void>();
let snapshot: Snapshot = { status: "off", announcement: "" };
let source: EventSource | undefined;
let everOpened = false;
let users = 0;
let pauseTimer: ReturnType<typeof setTimeout> | undefined;

const lost = "Live updates lost. Reconnecting…";
function setStatus(status: LiveStatus) {
  if (snapshot.status === status) {
    return;
  }
  // Only a lost or restored stream is announced, never the first connection.
  let { announcement } = snapshot;
  if (status === "reconnecting" && snapshot.status === "live") {
    announcement = lost;
  } else if (status === "live" && announcement === lost) {
    announcement = "Live updates restored.";
  }
  snapshot = { status, announcement };
  for (const listener of listeners) {
    listener();
  }
}

function disconnect() {
  source?.close();
  source = undefined;
  sync.dispose();
}

function receive(event: MessageEvent<unknown>) {
  sync.receive({ event: event.type, data: event.data });
}

function connect() {
  disconnect();
  const stream = new EventSource(streamUrl);
  source = stream;
  setStatus(everOpened ? "reconnecting" : "connecting");
  stream.addEventListener("open", () => {
    sync.opened(!everOpened);
    everOpened = true;
    setStatus("live");
  });
  stream.addEventListener("change", receive);
  stream.addEventListener("resync", receive);
  // The contract names every event, so an unnamed one is a broken frame.
  stream.addEventListener("message", receive);
  stream.addEventListener("error", () => {
    if (stream.readyState !== EventSource.CLOSED) {
      // The browser retries on its own, after the server's `retry`.
      setStatus("reconnecting");
      return;
    }
    // A refused stream (404 while the flag is off) is not retried. Bootstrap
    // says whether the flag is still on; showing the tab again tries again.
    disconnect();
    setStatus("off");
    void queryClient.invalidateQueries({ queryKey: bootstrapKey });
  });
}

function onVisibility() {
  clearTimeout(pauseTimer);
  pauseTimer = undefined;
  if (document.visibilityState === "hidden") {
    pauseTimer = setTimeout(() => {
      disconnect();
      setStatus("off");
    }, hiddenPauseMs);
  } else if (source === undefined) {
    // The new connection's first resync refetches what went stale meanwhile.
    connect();
  }
}

function subscribeStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Holds the stream open for as long as one caller is subscribed. */
function subscribeStream(listener: () => void) {
  const unsubscribe = subscribeStatus(listener);
  users += 1;
  if (users === 1) {
    document.addEventListener("visibilitychange", onVisibility);
    connect();
  }
  return () => {
    unsubscribe();
    users -= 1;
    if (users === 0) {
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(pauseTimer);
      disconnect();
      setStatus("off");
    }
  };
}

const getSnapshot = () => snapshot;

/**
 * Keep this tab current with other sessions' changes while `enabled`. Mount
 * once, in the shell; returns the stream's status.
 */
export function useLiveUpdates(enabled: boolean) {
  return useSyncExternalStore(
    enabled ? subscribeStream : subscribeStatus,
    getSnapshot,
  ).status;
}

/** The stream's status and the latest change worth announcing. */
export function useLiveStatus() {
  return useSyncExternalStore(subscribeStatus, getSnapshot);
}
