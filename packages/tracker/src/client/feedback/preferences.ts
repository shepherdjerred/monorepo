import type { Channel } from "./policy.ts";

export type PreferenceKey = Channel | "motion";

export const preferenceKeys: Record<PreferenceKey, string> = {
  sound: "tracker.feedback.sound",
  haptics: "tracker.feedback.haptics",
  motion: "tracker.feedback.motion",
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/**
 * The Sounds, Haptics and Motion switches, per device. All three are on unless
 * this device turned one off. Storage can be missing or refuse access (a
 * private window, blocked site data); the switches then still work for this
 * visit.
 */
export function createPreferences(storage: () => Storage) {
  const session = new Map<PreferenceKey, boolean>();
  const listeners = new Set<() => void>();
  function read(key: PreferenceKey) {
    const known = session.get(key);
    if (known !== undefined) {
      return known;
    }
    try {
      return storage().getItem(preferenceKeys[key]) !== "off";
    } catch {
      return true;
    }
  }
  return {
    read,
    write: (key: PreferenceKey, on: boolean) => {
      session.set(key, on);
      try {
        storage().setItem(preferenceKeys[key], on ? "on" : "off");
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

export const feedbackPreferences = createPreferences(() => localStorage);

function syncDocumentMotion() {
  if (typeof document === "undefined") {
    return;
  }
  if (feedbackPreferences.read("motion")) {
    delete document.documentElement.dataset["motion"];
  } else {
    document.documentElement.dataset["motion"] = "off";
  }
}

syncDocumentMotion();
feedbackPreferences.subscribe(syncDocumentMotion);
