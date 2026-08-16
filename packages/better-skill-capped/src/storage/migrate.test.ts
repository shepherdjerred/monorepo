import { describe, expect, test } from "bun:test";
import type { StringStore } from "#src/lib/safe-storage";
import { migrateStorage } from "./migrate.ts";
import { parseStoredBookmarks, parseStoredWatchStatuses } from "./schemas.ts";
import { BOOKMARKS_KEY, WATCH_STATUS_KEY, legacyBackupKey } from "./keys.ts";

function fakeStorage(
  initial: Record<string, string> = {},
): StringStore & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

function readJson(storage: StringStore, key: string): unknown {
  const raw = storage.getItem(key);
  if (raw === null) {
    throw new Error(`Expected ${key} to be present`);
  }
  return JSON.parse(raw);
}

const legacyVideoItem = {
  title: "Some Video",
  uuid: "video-1",
  skillCappedUrl: "https://example.com",
};
const legacyCourseItem = { uuid: "course-1", videos: [] };
const legacyCommentaryItem = { uuid: "commentary-1", matchLink: "https://x" };

describe("migrateStorage", () => {
  test("removes the legacy manifest cache keys", () => {
    const storage = fakeStorage({
      content: "{}",
      "content-timestamp": "12345",
    });
    migrateStorage(storage);
    expect(storage.getItem("content")).toBeNull();
    expect(storage.getItem("content-timestamp")).toBeNull();
  });

  test("migrates legacy bookmarks of every kind to uuid entries", () => {
    const storage = fakeStorage({
      bookmarks: JSON.stringify([
        { item: legacyVideoItem, date: "2024-01-02T03:04:05.000Z" },
        { item: legacyCourseItem, date: "2024-02-02T03:04:05.000Z" },
        { item: legacyCommentaryItem, date: "2024-03-02T03:04:05.000Z" },
      ]),
    });

    migrateStorage(storage);

    const migrated = parseStoredBookmarks(readJson(storage, BOOKMARKS_KEY));
    expect(migrated).toEqual([
      {
        uuid: "video-1",
        kind: "video",
        bookmarkedAt: "2024-01-02T03:04:05.000Z",
      },
      {
        uuid: "course-1",
        kind: "course",
        bookmarkedAt: "2024-02-02T03:04:05.000Z",
      },
      {
        uuid: "commentary-1",
        kind: "commentary",
        bookmarkedAt: "2024-03-02T03:04:05.000Z",
      },
    ]);
    expect(storage.getItem("bookmarks")).toBeNull();
  });

  test("migrates legacy watch statuses preserving the watched flag", () => {
    const storage = fakeStorage({
      watchStatus: JSON.stringify([
        {
          item: legacyVideoItem,
          isWatched: true,
          lastUpdate: "2024-05-06T07:08:09.000Z",
        },
        {
          item: legacyCommentaryItem,
          isWatched: false,
          lastUpdate: "2024-05-07T07:08:09.000Z",
        },
      ]),
    });

    migrateStorage(storage);

    const migrated = parseStoredWatchStatuses(
      readJson(storage, WATCH_STATUS_KEY),
    );
    expect(migrated).toEqual([
      {
        uuid: "video-1",
        kind: "video",
        watched: true,
        updatedAt: "2024-05-06T07:08:09.000Z",
      },
      {
        uuid: "commentary-1",
        kind: "commentary",
        watched: false,
        updatedAt: "2024-05-07T07:08:09.000Z",
      },
    ]);
    expect(storage.getItem("watchStatus")).toBeNull();
  });

  test("salvages valid elements and drops corrupt ones", () => {
    const storage = fakeStorage({
      bookmarks: JSON.stringify([
        { item: legacyVideoItem, date: "2024-01-02T03:04:05.000Z" },
        { nonsense: true },
        "not even an object",
      ]),
    });

    migrateStorage(storage);

    const migrated = parseStoredBookmarks(readJson(storage, BOOKMARKS_KEY));
    expect(migrated).toHaveLength(1);
    expect(migrated[0]?.uuid).toBe("video-1");
  });

  test("preserves outright-corrupt legacy data in a backup key", () => {
    const storage = fakeStorage({ bookmarks: "{corrupt json!" });

    migrateStorage(storage);

    expect(storage.getItem(legacyBackupKey("bookmarks"))).toBe(
      "{corrupt json!",
    );
    expect(storage.getItem(BOOKMARKS_KEY)).toBe("[]");
    expect(storage.getItem("bookmarks")).toBeNull();
  });

  test("is idempotent and never overwrites an existing v2 store", () => {
    const storage = fakeStorage({
      [BOOKMARKS_KEY]: JSON.stringify([
        {
          uuid: "existing",
          kind: "video",
          bookmarkedAt: "2024-01-01T00:00:00.000Z",
        },
      ]),
      bookmarks: JSON.stringify([
        { item: legacyCourseItem, date: "2024-02-02T03:04:05.000Z" },
      ]),
    });

    migrateStorage(storage);
    migrateStorage(storage);

    const migrated = parseStoredBookmarks(readJson(storage, BOOKMARKS_KEY));
    expect(migrated).toHaveLength(1);
    expect(migrated[0]?.uuid).toBe("existing");
  });

  test("does nothing when no legacy keys exist", () => {
    const storage = fakeStorage();
    migrateStorage(storage);
    expect(storage.dump()).toEqual({});
  });

  test("normalizes unparseable legacy dates instead of storing invalid ones", () => {
    const storage = fakeStorage({
      bookmarks: JSON.stringify([
        { item: legacyVideoItem, date: "not-a-date" },
      ]),
    });

    migrateStorage(storage);

    const migrated = parseStoredBookmarks(readJson(storage, BOOKMARKS_KEY));
    expect(migrated).toHaveLength(1);
    expect(
      Number.isNaN(new Date(migrated[0]?.bookmarkedAt ?? "").getTime()),
    ).toBe(false);
  });
});
