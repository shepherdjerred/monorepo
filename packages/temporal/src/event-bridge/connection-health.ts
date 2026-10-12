import type { ConnectionStateListener } from "@shepherdjerred/home-assistant";

/** Authentication alone does not prove the bridge's subscriptions are active. */
export function trackEventBridgeConnection(
  events: {
    onConnectionChange: (listener: ConnectionStateListener) => () => void;
  },
  connected: { set: (value: number) => void },
): { subscriptionsStarted: () => void; stop: () => void } {
  let started = false;
  let ready = false;
  connected.set(0);
  const unsubscribe = events.onConnectionChange((state) => {
    if (state === "handler-error") return;
    ready = state === "ready";
    connected.set(started && ready ? 1 : 0);
  });
  return {
    subscriptionsStarted: () => {
      started = true;
      connected.set(ready ? 1 : 0);
    },
    stop: () => {
      unsubscribe();
      connected.set(0);
    },
  };
}
