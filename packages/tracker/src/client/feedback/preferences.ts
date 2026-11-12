import type { Channel } from "./policy.ts";

export const preferenceKeys: Record<Channel, string> = {
  sound: "tracker.feedback.sound",
  haptics: "tracker.feedback.haptics",
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/**
 * The Sounds and Haptics switches, per device. Both are on unless this
 * device turned them off. Storage can be missing or refuse access (a private
 * window, blocked site data); the switches then still work for this visit.
 */
export function createPreferences(storage: () => Storage) {
  const session = new Map<Channel, boolean>();
  const listeners = new Set<() => void>();
  function read(channel: Channel) {
    const known = session.get(channel);
    if (known !== undefined) {
      return known;
    }
    try {
      return storage().getItem(preferenceKeys[channel]) !== "off";
    } catch {
      return true;
    }
  }
  return {
    read,
    write: (channel: Channel, on: boolean) => {
      session.set(channel, on);
      try {
        storage().setItem(preferenceKeys[channel], on ? "on" : "off");
      } catch {
        // Kept for this visit only.
      }
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
