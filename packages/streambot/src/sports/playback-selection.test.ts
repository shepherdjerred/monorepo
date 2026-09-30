import { describe, expect, it } from "vitest";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  selectDirectRequestUrl,
  selectSportsForRequest,
} from "@shepherdjerred/streambot/sports/playback-selection.ts";
import type {
  SportsCatalog,
  SportsEvent,
} from "@shepherdjerred/streambot/sports/types.ts";

const scope = {
  guildId: GuildIdSchema.parse("100000000000000001"),
  channelId: ChannelIdSchema.parse("100000000000000002"),
  userId: UserIdSchema.parse("100000000000000003"),
};
const signal = new AbortController().signal;
const events: SportsEvent[] = [
  {
    id: "streameast:game",
    provider: "streameast",
    title: "Bears vs Packers",
    status: "live",
    startsAt: null,
    pageUrl: "https://v2.streameast.ga/nfl/bears-vs-packers/",
  },
  {
    id: "tvsportslive:game",
    provider: "tvsportslive",
    title: "Bears vs Packers",
    status: "live",
    startsAt: null,
    pageUrl: "https://tvsportslive.fr/game/",
  },
];

describe("sports playback selection", () => {
  it("falls back to TVSportsLive when the preferred listing fails to resolve", async () => {
    const catalog: SportsCatalog = {
      listToday: async () => events,
      search: async () => ({ kind: "found", events }),
    };
    const resolved: string[] = [];
    let ambiguous = false;
    const selected = await selectSportsForRequest({
      query: "Bears Packers",
      source: "auto",
      provider: "auto",
      scope,
      enabled: async () => true,
      signal,
      catalog,
      resolve: async (source) => {
        if (source.kind !== "url") throw new Error("expected a provider page");
        resolved.push(source.url);
        if (resolved.length === 1) throw new Error("provider unavailable");
        return {
          title: "Bears vs Packers",
          ffmpegInput: "https://edgestream12.pro/live.m3u8",
          mediaKind: "video",
          chapters: [],
        };
      },
      onAmbiguous: () => {
        ambiguous = true;
      },
    });
    expect(resolved).toEqual([
      "https://v2.streameast.ga/nfl/bears-vs-packers/",
      "https://tvsportslive.fr/game/",
    ]);
    expect(selected).toMatchObject({
      source: { kind: "url", url: "https://tvsportslive.fr/game/" },
    });
    expect(ambiguous).toBe(false);
  });

  it.each([
    "Never Gonna Give You Up",
    "Game of Thrones",
    "Match Point",
    "VS Code tutorial",
  ])("does not browse sports for the ordinary title %s", async (query) => {
    const selected = await selectSportsForRequest({
      query,
      source: "auto",
      provider: undefined,
      scope,
      enabled: async () => {
        throw new Error("ordinary playback must not evaluate sports gate");
      },
      signal,
      catalog: {
        listToday: async () => {
          throw new Error("ordinary playback must not browse sports sites");
        },
        search: async () => {
          throw new Error("ordinary playback must not browse sports sites");
        },
      },
      resolve: async () => {
        throw new Error("ordinary playback must not resolve sports");
      },
      onAmbiguous: () => {
        throw new Error("ordinary playback must not ask about sports");
      },
    });
    expect(selected).toBeNull();
  });

  it("recognizes a game title without a provider option", async () => {
    const selected = await selectSportsForRequest({
      query: "Bears vs Packers",
      source: "auto",
      provider: undefined,
      scope,
      enabled: async () => true,
      signal,
      catalog: {
        listToday: async () => events,
        search: async () => ({ kind: "found", events }),
      },
      resolve: async () => ({
        title: "Bears vs Packers",
        ffmpegInput: "https://edgestream12.pro/live.m3u8",
        mediaKind: "video",
        chapters: [],
      }),
      onAmbiguous: () => {
        throw new Error("expected a single game");
      },
    });
    expect(selected?.source).toMatchObject({
      kind: "url",
      url: "https://v2.streameast.ga/nfl/bears-vs-packers/",
    });
  });

  it("does not allow a sports page URL when the feature is disabled", async () => {
    await expect(
      selectDirectRequestUrl({
        query: "https://v2.streameast.ga/nfl/game/",
        spoken: false,
        source: "auto",
        scope,
        enabled: async () => false,
        signal,
        resolve: async () => {
          throw new Error("must not resolve");
        },
      }),
    ).rejects.toThrow("not enabled");
  });
});

describe("sports playback boundary errors", () => {
  it("reports a provider outage for a pasted sports page instead of a raw error", async () => {
    const request = selectDirectRequestUrl({
      query: "https://v2.streameast.ga/nfl/bears-vs-packers/",
      spoken: false,
      source: "auto",
      scope,
      enabled: async () => true,
      signal,
      resolve: async () => {
        throw new Error("browser unavailable");
      },
    });
    await expect(request).rejects.toBeInstanceOf(PlaybackCommandBoundaryError);
    await expect(request).rejects.toThrow(
      "I couldn't start the streameast stream right now. Please try again later.",
    );
  });

  it("reports a sports deadline without swallowing caller cancellation", async () => {
    const deadline = new AbortController();
    deadline.abort(new DOMException("deadline", "TimeoutError"));
    const cancelled = new AbortController();
    cancelled.abort(new DOMException("cancelled", "AbortError"));
    for (const [requestSignal, message] of [
      [deadline.signal, "sports provider took too long"],
      [cancelled.signal, "cancelled"],
    ] as const) {
      await expect(
        selectDirectRequestUrl({
          query: "https://v2.streameast.ga/nfl/bears-vs-packers/",
          spoken: false,
          source: "auto",
          scope,
          enabled: async () => true,
          signal: requestSignal,
          resolve: async (_source, resolverSignal) => {
            resolverSignal.throwIfAborted();
            throw new Error("unexpected resolution");
          },
        }),
      ).rejects.toThrow(message);
    }
  });

  it("rejects an explicit sports provider when the flag is off", async () => {
    for (const provider of ["auto", "streameast"] as const) {
      await expect(
        selectSportsForRequest({
          query: "Bears vs Packers",
          source: "auto",
          provider,
          scope,
          enabled: async () => false,
          signal,
          catalog: {
            listToday: async () => {
              throw new Error("must not browse sports sites");
            },
            search: async () => {
              throw new Error("must not browse sports sites");
            },
          },
          resolve: async () => {
            throw new Error("must not resolve");
          },
          onAmbiguous: () => {
            throw new Error("must not ask about sports");
          },
        }),
      ).rejects.toThrow("Sports streams are not enabled here.");
    }
  });

  it("does not fall through to ordinary discovery for an unmatched explicit provider", async () => {
    await expect(
      selectSportsForRequest({
        query: "Bears vs Packers",
        source: "auto",
        provider: "streameast",
        scope,
        enabled: async () => true,
        signal,
        catalog: {
          listToday: async () => [],
          search: async () => ({ kind: "not-found" }),
        },
        resolve: async () => {
          throw new Error("must not resolve");
        },
        onAmbiguous: () => {
          throw new Error("must not ask about sports");
        },
      }),
    ).rejects.toThrow("couldn't find a sports stream matching");
  });

  it("keeps ordinary public URLs on the existing generic source path", async () => {
    const selected = await selectDirectRequestUrl({
      query: "https://example.com/video.mp4",
      spoken: false,
      source: "auto",
      scope: null,
      enabled: undefined,
      signal,
      resolve: async () => {
        throw new Error("generic URL must not use the sports resolver");
      },
    });
    expect(selected).toEqual({
      source: { kind: "url", url: "https://example.com/video.mp4" },
      sports: false,
    });
  });
});
