import { useSyncExternalStore } from "react";
import { ActorSchema, type ActorEnvelope } from "#shared/actor.ts";

export const actorStorageKey = "tracker.actor.v1";
export const guestStorageKey = "tracker.browser-guest.v1";
export const tabStorageKey = "tracker.tab";

type IdentityStorage = Pick<
  globalThis.Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type IdentityEnvironment = {
  local: () => IdentityStorage;
  session: () => IdentityStorage;
  webdriver: () => boolean;
  uuid?: () => string;
  onStorage?: (listener: () => void) => () => void;
};

const isValidSuffix = (value: string) => /^\S+$/u.test(value);
const noop = () => {
  // Non-window runtimes do not emit cross-tab storage events.
};

/**
 * Browser identity store. An unclaimed profile never impersonates a human:
 * WebDriver sessions identify as `webdriver:<tab>`, and ordinary unclaimed
 * profiles (including stealth automation) identify as `browser-session:<guest>`.
 */
export function createBrowserIdentity(env: IdentityEnvironment) {
  const makeUuid = env.uuid ?? (() => crypto.randomUUID());
  const listeners = new Set<() => void>();
  let stopStorage: (() => void) | undefined;
  let fallbackSessionId: string | undefined;
  let memorySaved: string | null | undefined;
  let cachedSignature: string | undefined;
  let cachedActor: ActorEnvelope | undefined;

  function notifyListeners() {
    for (const listener of listeners) {
      listener();
    }
  }

  function tabSessionId(): string {
    try {
      const store = env.session();
      const existing = store.getItem(tabStorageKey);
      if (existing !== null && isValidSuffix(existing)) {
        return existing;
      }
      const created = makeUuid();
      store.setItem(tabStorageKey, created);
      return created;
    } catch {
      fallbackSessionId ??= makeUuid();
      return fallbackSessionId;
    }
  }

  function readSaved(): string | null {
    try {
      return env.local().getItem(actorStorageKey);
    } catch {
      return memorySaved ?? null;
    }
  }

  function guestId(sessionId: string): string {
    try {
      const store = env.local();
      const existing = store.getItem(guestStorageKey);
      if (existing !== null && isValidSuffix(existing)) {
        return existing;
      }
      const created = makeUuid();
      store.setItem(guestStorageKey, created);
      return created;
    } catch {
      return sessionId;
    }
  }

  function isWebdriver(): boolean {
    try {
      return env.webdriver();
    } catch {
      return false;
    }
  }

  function computeActor(): ActorEnvelope {
    const sessionId = tabSessionId();
    const saved = readSaved();
    if (saved === null) {
      if (isWebdriver()) {
        return {
          key: `webdriver:${sessionId}`,
          kind: "agent",
          name: "Browser Automation",
          metadata: { harness: "webdriver", sessionId },
        };
      }
      const guest = guestId(sessionId);
      return {
        key: `browser-session:${guest}`,
        kind: "agent",
        name: "Unclaimed Browser",
        metadata: { harness: "browser-session", sessionId },
      };
    }
    const actor = ActorSchema.parse(JSON.parse(saved));
    return {
      ...actor,
      metadata: { ...actor.metadata, harness: "browser", sessionId },
    };
  }

  function read(): ActorEnvelope {
    const next = computeActor();
    const signature = JSON.stringify(next);
    if (signature === cachedSignature && cachedActor !== undefined) {
      return cachedActor;
    }
    cachedSignature = signature;
    cachedActor = next;
    return next;
  }

  function save(actor: ActorEnvelope): void {
    const serialized = JSON.stringify(ActorSchema.parse(actor));
    memorySaved = serialized;
    try {
      env.local().setItem(actorStorageKey, serialized);
    } catch {
      // Kept in memory when site storage is unavailable.
    }
    notifyListeners();
  }

  function hasSaved(): boolean {
    return readSaved() !== null;
  }

  function clear(): void {
    memorySaved = null;
    try {
      env.local().removeItem(actorStorageKey);
    } catch {
      // Cleared in memory when site storage is unavailable.
    }
    notifyListeners();
  }

  function subscribe(listener: () => void): () => void {
    if (listeners.size === 0 && env.onStorage !== undefined) {
      stopStorage = env.onStorage(notifyListeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopStorage?.();
        stopStorage = undefined;
      }
    };
  }

  return {
    currentActor: read,
    saveActor: save,
    hasSavedActor: hasSaved,
    clearSavedActor: clear,
    subscribeActor: subscribe,
  };
}

const browserIdentity = createBrowserIdentity({
  local: () => localStorage,
  session: () => sessionStorage,
  webdriver: () => {
    const nav: { readonly webdriver?: boolean } = globalThis.navigator;
    return nav.webdriver === true;
  },
  onStorage: (notify) => {
    const handler = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === actorStorageKey ||
        event.key === guestStorageKey
      ) {
        notify();
      }
    };
    try {
      globalThis.addEventListener("storage", handler);
      return () => {
        globalThis.removeEventListener("storage", handler);
      };
    } catch {
      return noop;
    }
  },
});

export function currentActor(): ActorEnvelope {
  return browserIdentity.currentActor();
}

export function saveActor(actor: ActorEnvelope): void {
  browserIdentity.saveActor(actor);
}

export function hasSavedActor(): boolean {
  return browserIdentity.hasSavedActor();
}

export function clearSavedActor(): void {
  browserIdentity.clearSavedActor();
}

export function subscribeActor(listener: () => void): () => void {
  return browserIdentity.subscribeActor(listener);
}

export function useCurrentActor(): ActorEnvelope {
  return useSyncExternalStore(subscribeActor, currentActor, currentActor);
}
