import { describe, expect, it } from "vitest";
import { BrowserSportsResolver } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import type { SportsPageRenderer } from "@shepherdjerred/streambot/sports/pinchtab.ts";

describe("BrowserSportsResolver", () => {
  it("extracts HLS only from an approved HTTPS media host and keeps the public page referer", async () => {
    const browser: SportsPageRenderer = {
      html: async (url) => {
        return url === "https://v2.streameast.ga/nfl/game/"
          ? '<iframe src="https://streame.center/embed/ch1.php"></iframe>'
          : '<title>Bears vs Packers | StreamEast</title><video src="https://edgestream12.pro/live.m3u8?token=secret"></video>';
      },
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
});
