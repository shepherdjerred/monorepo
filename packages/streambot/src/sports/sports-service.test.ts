import { describe, expect, it, vi } from "vitest";
import { SportsService } from "@shepherdjerred/streambot/sports/sports-service.ts";
import { sportsListingText } from "@shepherdjerred/streambot/sports/listing-text.ts";
import {
  STREAMEAST_HOME,
  TVSPORTSLIVE_HOME,
} from "@shepherdjerred/streambot/sports/parse-events.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const STREAM_EAST_HTML =
  '<div class="m-card m-card--live"><a class="m-card__link" href="/nfl/bears-vs-packers/" aria-label="Bears vs Packers"></a></div>';
const TV_SPORTS_HTML =
  '<h2 class="entry-title"><a href="https://tvsportslive.fr/game/">Ducks vs Kings</a></h2><p>Live now</p>';

describe("selected sports providers", () => {
  it.each([
    { provider: "streameast", url: STREAMEAST_HOME, html: STREAM_EAST_HTML },
    { provider: "tvsportslive", url: TVSPORTSLIVE_HOME, html: TV_SPORTS_HTML },
  ] as const)(
    "loads $provider without contacting the unselected provider",
    async ({ provider, url, html }) => {
      const read = vi.fn(async (target: string) =>
        target === url ? html : await Promise.withResolvers<string>().promise,
      );
      const catalog = new SportsService({
        html: read,
        runtimeStreams: async () => ({ resources: [], headers: {} }),
      });
      const signal = AbortSignal.timeout(1000);
      await expect(catalog.listToday(signal, provider)).resolves.toMatchObject([
        { provider },
      ]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith(url, signal);
    },
  );

  it("searches only the requested provider", async () => {
    const read = vi.fn(async () => STREAM_EAST_HTML);
    const catalog = new SportsService({
      html: read,
      runtimeStreams: async () => ({ resources: [], headers: {} }),
    });
    const signal = new AbortController().signal;
    await expect(
      catalog.search("Bears Packers", "streameast", signal),
    ).resolves.toMatchObject({
      kind: "found",
      events: [{ provider: "streameast" }],
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(STREAMEAST_HOME, signal);
  });

  it("reports a selected-provider failure without substituting another provider", async () => {
    const read = vi.fn(async (url: string) => {
      if (url === STREAMEAST_HOME) throw new Error("provider unavailable");
      return TV_SPORTS_HTML;
    });
    const catalog = new SportsService({
      html: read,
      runtimeStreams: async () => ({ resources: [], headers: {} }),
    });
    await expect(
      catalog.listToday(new AbortController().signal, "streameast"),
    ).rejects.toThrow("Sports listings are temporarily unavailable");
    expect(read).toHaveBeenCalledTimes(1);
  });
});

function partiallyAvailableCatalog(
  successfulProvider: "streameast" | "tvsportslive",
  html: string,
) {
  const succeeded = Promise.withResolvers<undefined>();
  const catalog = new SportsService({
    html: async (url, signal) => {
      signal.throwIfAborted();
      if ((url === STREAMEAST_HOME) === (successfulProvider === "streameast")) {
        succeeded.resolve(undefined);
        return html;
      }
      return await new Promise<string>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("provider aborted", { cause: signal.reason })),
          { once: true },
        );
      });
    },
    runtimeStreams: async () => {
      throw new Error("unexpected runtime request");
    },
  });
  return { catalog, succeeded: succeeded.promise };
}

describe("partially available sports listings", () => {
  it.each([
    {
      provider: "streameast",
      html: STREAM_EAST_HTML,
      title: "Bears vs Packers",
    },
    { provider: "tvsportslive", html: TV_SPORTS_HTML, title: "Ducks vs Kings" },
  ] as const)(
    "reports the $provider games when the other provider exceeds the listing deadline",
    async ({ provider, html, title }) => {
      const { catalog, succeeded } = partiallyAvailableCatalog(provider, html);
      const deadline = new AbortController();
      const listing = sportsListingText({
        scope: {
          guildId: GuildIdSchema.parse("100000000000000001"),
          channelId: ChannelIdSchema.parse("100000000000000002"),
          userId: UserIdSchema.parse("100000000000000003"),
        },
        catalog,
        enabled: async () => true,
        signal: deadline.signal,
      });
      await succeeded;
      deadline.abort(new DOMException("deadline", "TimeoutError"));

      await expect(listing).resolves.toBe(`LIVE: ${title} (${provider})`);
    },
  );

  it("preserves caller cancellation even after a provider succeeds", async () => {
    const { catalog, succeeded } = partiallyAvailableCatalog(
      "streameast",
      STREAM_EAST_HTML,
    );
    const cancelled = new AbortController();
    const listing = catalog.listToday(cancelled.signal);
    await succeeded;
    const reason = new DOMException("cancelled", "AbortError");
    cancelled.abort(reason);

    await expect(listing).rejects.toBe(reason);
  });

  it("reports a timeout when the successful provider has no games", async () => {
    const { catalog, succeeded } = partiallyAvailableCatalog("streameast", "");
    const deadline = new AbortController();
    const listing = catalog.listToday(deadline.signal);
    await succeeded;
    deadline.abort(new DOMException("deadline", "TimeoutError"));

    await expect(listing).rejects.toThrow("The sports provider took too long");
  });
});
