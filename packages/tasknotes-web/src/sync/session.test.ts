import { describe, expect, test } from "vitest";
import {
  clearSession,
  loadSession,
  saveSession,
  syncEndpoint,
  type KeyValueStore,
} from "./session.ts";

function memoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("session", () => {
  test("uses the dev proxy for the local server", () => {
    expect(syncEndpoint("http://127.0.0.1:3000")).toBe("/api/v1/sync");
    expect(syncEndpoint("http://127.0.0.1:3000/")).toBe("/api/v1/sync");
    expect(syncEndpoint("https://tasks.example")).toBe(
      "https://tasks.example/api/v1/sync",
    );
  });

  test("remembers a session only when asked", () => {
    const stores = { local: memoryStore(), session: memoryStore() };
    saveSession(stores, {
      origin: "http://127.0.0.1:3000",
      token: "fct_secret",
      remember: false,
    });
    expect(loadSession(stores)?.token).toBe("fct_secret");
    expect(loadSession({ local: stores.local, session: memoryStore() })).toBe(
      null,
    );

    saveSession(stores, {
      origin: "http://127.0.0.1:3000",
      token: "fct_secret",
      remember: true,
    });
    expect(
      loadSession({ local: stores.local, session: memoryStore() })?.remember,
    ).toBe(true);

    clearSession(stores);
    expect(loadSession(stores)).toBeNull();
  });
});
