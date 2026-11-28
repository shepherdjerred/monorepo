import { describe, expect, test } from "vitest";
import { memoryStore } from "./session-test-store.ts";
import {
  clearSession,
  loadSession,
  saveSession,
  syncEndpoint,
} from "./session.ts";

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
