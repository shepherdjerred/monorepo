import { describe, expect, test } from "vitest";
import { ActorSchema } from "#shared/actor.ts";
import {
  actorStorageKey,
  clearSavedActor,
  createBrowserIdentity,
  currentActor,
  guestStorageKey,
  hasSavedActor,
  saveActor,
  tabStorageKey,
} from "./identity.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    snapshot: () => Object.fromEntries(map),
  };
}

function throwingStorage() {
  return {
    getItem: (): string | null => {
      throw new Error("storage blocked");
    },
    setItem: () => {
      throw new Error("storage blocked");
    },
    removeItem: () => {
      throw new Error("storage blocked");
    },
  };
}

const fixedGuestUuid = () => "guest-xyz";

describe("browser identity", () => {
  test("unclaimed WebDriver sessions resolve webdriver:<tab> as an agent", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    let count = 0;
    const identity = createBrowserIdentity({
      local: () => local,
      session: () => session,
      webdriver: () => true,
      uuid: () => `uuid-${String(++count)}`,
    });

    expect(identity.hasSavedActor()).toBe(false);
    const first = identity.currentActor();
    expect(first).toEqual({
      key: "webdriver:uuid-1",
      kind: "agent",
      name: "Browser Automation",
      metadata: {
        harness: "webdriver",
        sessionId: "uuid-1",
      },
    });
    expect(session.getItem(tabStorageKey)).toBe("uuid-1");
    expect(local.getItem(guestStorageKey)).toBeNull();
    // Repeated reads return the exact snapshot reference for useSyncExternalStore.
    expect(identity.currentActor()).toBe(first);
  });

  test("unclaimed non-WebDriver browsers persist a guest browser-session identity across tabs", () => {
    const sharedLocal = memoryStorage();
    const tabOneSession = memoryStorage();
    const tabTwoSession = memoryStorage();
    let count = 0;
    const nextUuid = () => `id-${String(++count)}`;

    const tabOne = createBrowserIdentity({
      local: () => sharedLocal,
      session: () => tabOneSession,
      webdriver: () => false,
      uuid: nextUuid,
    });
    const tabTwo = createBrowserIdentity({
      local: () => sharedLocal,
      session: () => tabTwoSession,
      webdriver: () => false,
      uuid: nextUuid,
    });

    const actorOne = tabOne.currentActor();
    expect(actorOne).toEqual({
      key: "browser-session:id-2",
      kind: "agent",
      name: "Unclaimed Browser",
      metadata: {
        harness: "browser-session",
        sessionId: "id-1",
      },
    });
    expect(sharedLocal.getItem(guestStorageKey)).toBe("id-2");

    const actorTwo = tabTwo.currentActor();
    expect(actorTwo).toEqual({
      key: "browser-session:id-2",
      kind: "agent",
      name: "Unclaimed Browser",
      metadata: {
        harness: "browser-session",
        sessionId: "id-3",
      },
    });
  });

  test("falls back to sessionId when localStorage is unavailable", () => {
    let count = 0;
    const identity = createBrowserIdentity({
      local: throwingStorage,
      session: throwingStorage,
      webdriver: () => false,
      uuid: () => `fallback-${String(++count)}`,
    });

    expect(identity.currentActor()).toEqual({
      key: "browser-session:fallback-1",
      kind: "agent",
      name: "Unclaimed Browser",
      metadata: {
        harness: "browser-session",
        sessionId: "fallback-1",
      },
    });
  });

  test("saveActor and clearSavedActor persist, notify subscribers, and revert cleanly", () => {
    const local = memoryStorage();
    const session = memoryStorage({ [tabStorageKey]: "tab-abc" });
    let storageNotify: (() => void) | undefined;
    let unsubscribed = false;
    const markUnsubscribed = () => {
      unsubscribed = true;
    };
    const identity = createBrowserIdentity({
      local: () => local,
      session: () => session,
      webdriver: () => true,
      uuid: fixedGuestUuid,
      onStorage: (notify) => {
        storageNotify = notify;
        return markUnsubscribed;
      },
    });

    let notifications = 0;
    const stop = identity.subscribeActor(() => {
      notifications += 1;
    });

    const claimed = ActorSchema.parse({
      key: "human:jerred",
      kind: "human",
      name: "Jerred",
    });
    identity.saveActor(claimed);
    expect(notifications).toBe(1);
    expect(identity.hasSavedActor()).toBe(true);
    expect(local.getItem(actorStorageKey)).not.toBeNull();

    const savedSnapshot = identity.currentActor();
    expect(savedSnapshot).toEqual({
      key: "human:jerred",
      kind: "human",
      name: "Jerred",
      metadata: {
        harness: "browser",
        sessionId: "tab-abc",
      },
    });
    expect(identity.currentActor()).toBe(savedSnapshot);

    storageNotify?.();
    expect(notifications).toBe(2);

    identity.clearSavedActor();
    expect(notifications).toBe(3);
    expect(identity.hasSavedActor()).toBe(false);
    expect(local.getItem(actorStorageKey)).toBeNull();
    expect(identity.currentActor()).toEqual({
      key: "webdriver:tab-abc",
      kind: "agent",
      name: "Browser Automation",
      metadata: {
        harness: "webdriver",
        sessionId: "tab-abc",
      },
    });

    stop();
    expect(unsubscribed).toBe(true);
  });

  test("default exported identity helpers never default to human:jerred", () => {
    clearSavedActor();
    expect(hasSavedActor()).toBe(false);
    const initial = currentActor();
    expect(initial.kind).toBe("agent");
    expect(initial.key.startsWith("human:")).toBe(false);

    saveActor(
      ActorSchema.parse({
        key: "human:jerred",
        kind: "human",
        name: "Jerred",
      }),
    );
    expect(hasSavedActor()).toBe(true);
    expect(currentActor()).toMatchObject({
      key: "human:jerred",
      kind: "human",
      name: "Jerred",
    });

    clearSavedActor();
    expect(hasSavedActor()).toBe(false);
    expect(currentActor().kind).toBe("agent");
  });
});
