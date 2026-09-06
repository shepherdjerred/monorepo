import { describe, expect, test } from "vitest";
import { DiscoveryService } from "@shepherdjerred/streambot/discovery/discovery-service.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";

const SCOPE = {
  guildId: "guild-one",
  channelId: "channel-one",
  userId: "user-one",
} as const;

describe("federated discovery", () => {
  test("expands an unspecified character performance into an AI-cover YouTube search", async () => {
    const queries: string[] = [];
    const discovery = new DiscoveryService({
      library: () => [],
      searchYoutube: (query) => {
        queries.push(query);
        return Promise.resolve(
          query.endsWith("AI cover")
            ? [
                {
                  title: "Plankton sings Beggin (AI Cover)",
                  url: "https://www.youtube.com/watch?v=plankton",
                  channel: "Bikini Bottom Covers",
                },
              ]
            : [],
        );
      },
    });

    const result = await discovery.resolve(
      inferMediaIntent({ query: "Beggin by Plankton" }),
      SCOPE,
      AbortSignal.timeout(1000),
    );

    expect(queries).toEqual(["Beggin Plankton", "Beggin Plankton AI cover"]);
    expect(result).toMatchObject({
      kind: "found",
      candidate: {
        provider: "youtube",
        title: "Plankton sings Beggin (AI Cover)",
      },
    });
  });

  test("remembers ambiguous choices for a scoped ordinal follow-up", async () => {
    const discovery = new DiscoveryService({
      library: () => [],
      searchYoutube: () =>
        Promise.resolve([
          { title: "Result Alpha", url: "https://youtu.be/a" },
          { title: "Result Beta", url: "https://youtu.be/b" },
        ]),
    });
    const first = await discovery.resolve(
      inferMediaIntent({ query: "close results" }),
      SCOPE,
      AbortSignal.timeout(1000),
    );
    expect(first.kind).toBe("ambiguous");

    const followUp = await discovery.resolve(
      inferMediaIntent({ query: "second" }),
      SCOPE,
      AbortSignal.timeout(1000),
    );
    expect(followUp).toMatchObject({
      kind: "found",
      candidate: { title: "Result Beta" },
    });
  });
});
