import { describe, expect, test } from "bun:test";
import {
  type Announcement,
  StatusReporter,
  type StatusSnapshot,
} from "@shepherdjerred/streambot/discord/status-reporter.ts";
import type { PosterInfo } from "@shepherdjerred/streambot/metadata/tmdb.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

const REQUESTER = UserIdSchema.parse("100000000000000001");

function collector(): {
  reporter: StatusReporter;
  messages: Announcement[];
} {
  const messages: Announcement[] = [];
  const reporter = new StatusReporter((message) => {
    messages.push(message);
    return Promise.resolve();
  });
  return { reporter, messages };
}

function streaming(
  title: string,
  kind: StatusSnapshot["currentKind"] = "search",
): StatusSnapshot {
  return {
    state: "streaming",
    currentTitle: title,
    currentRequester: REQUESTER,
    currentKind: kind,
    blockedNonce: 0,
    blockedRequester: null,
  };
}

describe("StatusReporter now-playing", () => {
  test("announces once when a stream starts, with the requester", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("Song A"));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(
      `▶️ Now playing **Song A** (requested by <@${REQUESTER}>)`,
    );
  });

  test("de-dupes repeated identical snapshots", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("Song A"));
    reporter.handle(streaming("Song A"));
    reporter.handle(streaming("Song A"));
    expect(messages).toHaveLength(1);
  });

  test("re-announces a track that plays again after an idle gap", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("Song A"));
    reporter.handle({
      state: "idle",
      currentTitle: null,
      currentRequester: null,
      currentKind: null,
      blockedNonce: 0,
      blockedRequester: null,
    });
    reporter.handle(streaming("Song A"));
    expect(messages).toHaveLength(2);
  });

  test("does not announce when not streaming", () => {
    const { reporter, messages } = collector();
    reporter.handle({
      state: "resolving",
      currentTitle: "Song A",
      currentRequester: REQUESTER,
      currentKind: "file",
      blockedNonce: 0,
      blockedRequester: null,
    });
    expect(messages).toHaveLength(0);
  });
});

function posterCollector(
  fetchPoster: (
    title: string,
    year: number | null,
  ) => Promise<PosterInfo | null>,
): { reporter: StatusReporter; messages: Announcement[] } {
  const messages: Announcement[] = [];
  const reporter = new StatusReporter(
    (message) => {
      messages.push(message);
      return Promise.resolve();
    },
    { fetchPoster },
  );
  return { reporter, messages };
}

describe("StatusReporter poster embeds", () => {
  test("attaches a poster embed for a local file when a poster is found", async () => {
    const calls: { title: string; year: number | null }[] = [];
    const { reporter, messages } = posterCollector((title, year) => {
      calls.push({ title, year });
      return Promise.resolve({
        posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
        tmdbTitle: "Avengers: Endgame",
      });
    });

    reporter.handle(streaming("Avengers - Endgame (2019)", "file"));
    // Let the async poster fetch settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual([{ title: "Avengers - Endgame", year: 2019 }]);
    expect(messages).toEqual([
      {
        content: `▶️ Now playing **Avengers - Endgame (2019)** (requested by <@${REQUESTER}>)`,
        embed: {
          title: "Avengers - Endgame (2019)",
          imageUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
        },
      },
    ]);
  });

  test("falls back to plain text when no poster is found", async () => {
    const { reporter, messages } = posterCollector(() => Promise.resolve(null));
    reporter.handle(streaming("Obscure Film (1953)", "file"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messages).toEqual([
      `▶️ Now playing **Obscure Film (1953)** (requested by <@${REQUESTER}>)`,
    ]);
  });

  test("does not fetch a poster for non-file sources", async () => {
    let called = false;
    const { reporter, messages } = posterCollector(() => {
      called = true;
      return Promise.resolve(null);
    });
    reporter.handle(streaming("Some YouTube Video", "url"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(called).toBe(false);
    expect(messages).toEqual([
      `▶️ Now playing **Some YouTube Video** (requested by <@${REQUESTER}>)`,
    ]);
  });

  test("stays text-only when no poster fetcher is configured", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("A Local Movie (2020)", "file"));
    expect(messages).toEqual([
      `▶️ Now playing **A Local Movie (2020)** (requested by <@${REQUESTER}>)`,
    ]);
  });
});

describe("StatusReporter blocked shaming", () => {
  test("shames once when the blocked nonce advances with a requester", () => {
    const { reporter, messages } = collector();
    reporter.handle({
      state: "idle",
      currentTitle: null,
      currentRequester: null,
      currentKind: null,
      blockedNonce: 1,
      blockedRequester: REQUESTER,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`<@${REQUESTER}>`);
  });

  test("does not re-shame while the nonce is unchanged", () => {
    const { reporter, messages } = collector();
    const blocked: StatusSnapshot = {
      state: "idle",
      currentTitle: null,
      currentRequester: null,
      currentKind: null,
      blockedNonce: 1,
      blockedRequester: REQUESTER,
    };
    reporter.handle(blocked);
    reporter.handle(blocked);
    expect(messages).toHaveLength(1);
  });

  test("respects the initial nonce so a resume doesn't re-shame", () => {
    const messages: Announcement[] = [];
    const reporter = new StatusReporter(
      (message) => {
        messages.push(message);
        return Promise.resolve();
      },
      { initialNonce: 1 },
    );
    reporter.handle({
      state: "idle",
      currentTitle: null,
      currentRequester: null,
      currentKind: null,
      blockedNonce: 1,
      blockedRequester: REQUESTER,
    });
    expect(messages).toHaveLength(0);
  });
});
