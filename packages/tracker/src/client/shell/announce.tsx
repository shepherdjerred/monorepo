import { useSyncExternalStore } from "react";

let message = "";
let clearTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function publish(next: string) {
  message = next;
  for (const listener of listeners) {
    listener();
  }
}

/** Announce the outcome of an asynchronous action to assistive technology. */
export function announce(text: string) {
  clearTimeout(clearTimer);
  publish(text);
  // Emptying the region lets an identical outcome be announced again.
  clearTimer = setTimeout(() => {
    publish("");
  }, 4000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function LiveRegion() {
  const text = useSyncExternalStore(subscribe, () => message);
  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      data-testid="live-region"
    >
      {text}
    </div>
  );
}
