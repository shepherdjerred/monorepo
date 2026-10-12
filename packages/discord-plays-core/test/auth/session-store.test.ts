import { describe, expect, test } from "vitest";
import {
  SESSION_LIFETIME_SECONDS,
  createSqliteSessionStore,
} from "#src/auth/session-store.ts";

const USER = {
  discordId: "4242",
  username: "speedy",
  name: "Speedy",
  avatarUrl: null,
};

describe("createSqliteSessionStore", () => {
  test("reads a session back by its token until it expires", async () => {
    const store = createSqliteSessionStore(":memory:");
    const now = 1_000_000;
    const token = await store.create(USER, now);
    expect(await store.read(token, now + 1000)).toEqual(USER);
    expect(
      await store.read(token, now + SESSION_LIFETIME_SECONDS * 1000),
    ).toBeUndefined();
  });

  test("forgets a deleted session and never matches an unknown token", async () => {
    const store = createSqliteSessionStore(":memory:");
    const token = await store.create(USER);
    await store.delete(token);
    expect(await store.read(token)).toBeUndefined();
    expect(await store.read("not-a-token")).toBeUndefined();
  });

  test("hands out a different token for every session", async () => {
    const store = createSqliteSessionStore(":memory:");
    expect(await store.create(USER)).not.toBe(await store.create(USER));
  });
});
