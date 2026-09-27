import { describe, expect, it } from "vitest";
import { BrowserSportsResolver } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import type { SportsPageRenderer } from "@shepherdjerred/streambot/sports/pinchtab.ts";

describe("BrowserSportsResolver", () => {
  it("extracts HLS only from an approved HTTPS media host and keeps the public page referer", async () => {
    const browser: SportsPageRenderer = {
      html: async (url) => {
        return url === "https://v2.streameast.ga/nfl/game/"
          ? '<title>Bears vs Packers | StreamEast</title><iframe src="https://streame.center/embed/ch1.php"></iframe>'
          : '<title>Bears vs Packers | StreamEast</title><video src="https://edgestream12.pro/live.m3u8?token=secret"></video>';
      },
      runtimeStreams: async () => ({ resources: [], headers: {} }),
    };
    const result = await new BrowserSportsResolver(browser).resolve(
      "https://v2.streameast.ga/nfl/game/",
      new AbortController().signal,
    );
    expect(result).toEqual({
      title: "Bears vs Packers",
      input: "https://edgestream12.pro/live.m3u8?token=secret",
      headers: { Referer: "https://streame.center/embed/ch1.php" },
    });
  });

  it("rejects non-provider pages and does not follow unapproved embed hosts", async () => {
    let reads = 0;
    const browser: SportsPageRenderer = {
      html: async () => {
        reads += 1;
        return '<iframe src="https://untrusted.invalid/embed"></iframe>';
      },
      runtimeStreams: async () => ({ resources: [], headers: {} }),
    };
    const resolver = new BrowserSportsResolver(browser);
    await expect(
      resolver.resolve(
        "https://untrusted.invalid/game",
        new AbortController().signal,
      ),
    ).rejects.toThrow("approved HTTPS source");
    await expect(
      resolver.resolve(
        "https://tvsportslive.fr/game/",
        new AbortController().signal,
      ),
    ).rejects.toThrow("No supported live HLS stream");
    expect(reads).toBe(1);
  });

  it("finds a player-created HLS URL and preserves browser request headers", async () => {
    const htmlReads: string[] = [];
    const browser: SportsPageRenderer = {
      html: async (url) => {
        htmlReads.push(url);
        return url === "https://v2.streameast.ga/nfl/game/"
          ? '<title>Bears vs Packers | StreamEast</title><iframe src="https://streame.center/stream-east/ch49.php"></iframe>'
          : '<iframe src="https://streame.center/stream-east/ch49.php"></iframe>';
      },
      runtimeStreams: async (url) => ({
        resources:
          url === "https://streame.center/stream-east/ch49.php"
            ? ["https://edgestream12.pro/live.m3u8?token=secret"]
            : [],
        headers: {
          "User-Agent": "Chrome",
          Origin: "https://streame.center",
          Referer: "https://streame.center/stream-east/ch49.php",
        },
      }),
    };
    const result = await new BrowserSportsResolver(browser).resolve(
      "https://v2.streameast.ga/nfl/game/",
      new AbortController().signal,
    );

    expect(result).toEqual({
      title: "Bears vs Packers",
      input: "https://edgestream12.pro/live.m3u8?token=secret",
      headers: {
        "User-Agent": "Chrome",
        Origin: "https://streame.center",
        Referer: "https://streame.center/stream-east/ch49.php",
      },
    });
    expect(htmlReads).toEqual([
      "https://v2.streameast.ga/nfl/game/",
      "https://streame.center/stream-east/ch49.php",
    ]);
  });

  it("does not reopen nested player frames as top-level pages when capture is empty", async () => {
    const htmlReads: string[] = [];
    const runtimeReads: string[] = [];
    const browser: SportsPageRenderer = {
      html: async (url) => {
        htmlReads.push(url);
        return url ===
          "https://v2.streameast.ga/boxing/henry-cejudo-vs-javon-walton/"
          ? '<iframe src="https://streame.center/stream-east/ch49.php"></iframe>'
          : '<iframe src="https://v2.streameast.ga/"></iframe>';
      },
      runtimeStreams: async (url) => {
        runtimeReads.push(url);
        return { resources: [], headers: {} };
      },
    };

    await expect(
      new BrowserSportsResolver(browser).resolve(
        "https://v2.streameast.ga/boxing/henry-cejudo-vs-javon-walton/",
        new AbortController().signal,
      ),
    ).rejects.toThrow("No supported live HLS stream");
    expect(htmlReads).toEqual([
      "https://v2.streameast.ga/boxing/henry-cejudo-vs-javon-walton/",
      "https://streame.center/stream-east/ch49.php",
    ]);
    expect(runtimeReads).toEqual([
      "https://streame.center/stream-east/ch49.php",
    ]);
  });
});
