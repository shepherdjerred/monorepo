import { describe, expect, test } from "vitest";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";

const USER_SCOPE = {
  guildId: "guild-one",
  channelId: "channel-one",
  userId: "user-one",
} as const;
const SAME_GUILD_SCOPE = {
  guildId: "guild-one",
  channelId: "channel-two",
  userId: "user-two",
} as const;
const SAME_USER_SCOPE = {
  guildId: "guild-two",
  channelId: "channel-three",
  userId: "user-one",
} as const;
const UNRELATED_SCOPE = {
  guildId: "guild-two",
  channelId: "channel-three",
  userId: "user-three",
} as const;

function record(
  history: MediaHistoryStore,
  title: string,
  url: string,
  nowMs = Date.now(),
): void {
  const media = {
    title,
    provider: "youtube" as const,
    source: { kind: "url" as const, url },
    canonicalUrl: url,
  };
  const requestId = history.recordQueueRequest({
    scope: USER_SCOPE,
    rawQuery: title,
    intent: inferMediaIntent({ query: title }),
    media,
    nowMs,
  });
  history.recordPlaybackStart({
    requestId,
    scope: USER_SCOPE,
    media,
    nowMs,
  });
}

describe("media history", () => {
  test("combines guild-wide and global-user history without leaking unrelated guilds", () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      record(history, "Plankton Beggin", "https://youtu.be/plankton");

      expect(history.search(USER_SCOPE, "Plankton")).toHaveLength(1);
      expect(history.search(SAME_GUILD_SCOPE, "Plankton")).toHaveLength(1);
      expect(history.search(SAME_USER_SCOPE, "Plankton")).toHaveLength(1);
      expect(history.search(UNRELATED_SCOPE, "Plankton")).toEqual([]);
    } finally {
      history.close();
    }
  });

  test("returns the latest distinct previous item", () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      record(history, "First", "https://youtu.be/first", 1000);
      record(history, "Current", "https://youtu.be/current", 2000);

      expect(
        history.previous(USER_SCOPE, "url:https://youtu.be/current")?.title,
      ).toBe("First");
    } finally {
      history.close();
    }
  });

  test("retains favorites while pruning one-year request and playback history", () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      const old = 1000;
      const media = {
        title: "Old Favorite",
        provider: "youtube" as const,
        source: { kind: "url" as const, url: "https://youtu.be/old" },
      };
      record(history, media.title, media.source.url, old);
      history.addFavorite(USER_SCOPE.userId, media);

      history.prune(old + 366 * 24 * 60 * 60 * 1000);

      expect(history.list(USER_SCOPE, "mine")).toEqual([]);
      expect(history.favorites(USER_SCOPE.userId)[0]?.title).toBe(
        "Old Favorite",
      );
    } finally {
      history.close();
    }
  });

  test("round-trips a named saved queue in order", () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      history.saveQueue(USER_SCOPE.userId, "covers", [
        {
          title: "First",
          provider: "youtube",
          source: { kind: "url", url: "https://youtu.be/first" },
        },
        {
          title: "Second",
          provider: "local",
          source: { kind: "file", path: "/media/second.mkv", title: "Second" },
        },
      ]);

      expect(history.savedQueueNames(USER_SCOPE.userId)).toEqual(["covers"]);
      expect(
        history
          .savedQueue(USER_SCOPE.userId, "covers")
          .map((item) => item.title),
      ).toEqual(["First", "Second"]);
    } finally {
      history.close();
    }
  });
});
