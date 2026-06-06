import { describe, expect, it } from "bun:test";
import {
  getConversationTranscript,
  formatTranscript,
  type ChannelMessage,
} from "./channel-history.ts";

type FakeMessage = {
  id: string;
  author: { id: string; username: string; displayName: string; bot: boolean };
  content: string;
  createdAt: Date;
  createdTimestamp: number;
};

function fakeMsg(id: string, ageMs: number, isBot = false): FakeMessage {
  const ts = Date.now() - ageMs;
  return {
    id,
    author: {
      id: `author-${id}`,
      username: `user${id}`,
      displayName: `User${id}`,
      bot: isBot,
    },
    content: `msg-${id}`,
    createdAt: new Date(ts),
    createdTimestamp: ts,
  };
}

function fakeTrigger(history: FakeMessage[]) {
  const map = new Map(history.map((m) => [m.id, m]));
  let fetchedLimit = 0;
  return {
    message: {
      id: "trigger",
      channel: {
        messages: {
          fetch: async (opts: { limit: number; before: string }) => {
            fetchedLimit = opts.limit;
            return map;
          },
        },
      },
    },
    getFetchedLimit: () => fetchedLimit,
  };
}

describe("getConversationTranscript", () => {
  it("returns all recent messages chronologically when inside the window", async () => {
    const trigger = fakeTrigger([
      fakeMsg("1", 3000),
      fakeMsg("2", 2000),
      fakeMsg("3", 1000),
    ]);
    const result = await getConversationTranscript(trigger.message, {
      minMessages: 25,
      windowMs: 3_600_000,
      maxMessages: 100,
    });
    expect(result.map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("keeps minMessages most-recent even when older than the window", async () => {
    const trigger = fakeTrigger([
      fakeMsg("old1", 7_200_000), // 2h ago
      fakeMsg("old2", 7_100_000),
      fakeMsg("old3", 7_000_000),
      fakeMsg("recent", 1000), // within window
    ]);
    const result = await getConversationTranscript(trigger.message, {
      minMessages: 2,
      windowMs: 3_600_000, // 1h
      maxMessages: 100,
    });
    // recent (in window) + the single next-most-recent (index < min=2).
    expect(result.map((m) => m.id)).toEqual(["old3", "recent"]);
  });

  it("caps the fetch limit at 100", async () => {
    const trigger = fakeTrigger([fakeMsg("1", 1000)]);
    await getConversationTranscript(trigger.message, {
      minMessages: 25,
      windowMs: 3_600_000,
      maxMessages: 500,
    });
    expect(trigger.getFetchedLimit()).toBe(100);
  });

  it("returns [] when the fetch throws", async () => {
    const message = {
      id: "trigger",
      channel: {
        messages: {
          fetch: async (_opts: { limit: number; before: string }) => {
            await Promise.resolve();
            throw new Error("boom");
          },
        },
      },
    };
    const result = await getConversationTranscript(message, {
      minMessages: 25,
      windowMs: 3_600_000,
      maxMessages: 100,
    });
    expect(result).toEqual([]);
  });
});

describe("formatTranscript", () => {
  it("marks the bot's own messages", () => {
    const messages: ChannelMessage[] = [
      {
        id: "1",
        authorId: "u",
        authorName: "Alice",
        isBot: false,
        content: "hello",
        createdAt: new Date(),
      },
      {
        id: "2",
        authorId: "bot",
        authorName: "Birmel",
        isBot: true,
        content: "hi back",
        createdAt: new Date(),
      },
    ];
    expect(formatTranscript(messages)).toBe(
      "Alice: hello\nBirmel (you): hi back",
    );
  });
});
