import { describe, expect, test } from "vitest";
import {
  buildManagedFreshRssOpml,
  FRESHRSS_PRERELEASE_FILTER,
  parseFreshRssOpml,
} from "./freshrss-opml.ts";

const feedsOpml = await Bun.file(
  new URL("../../../helm/freshrss/feeds.opml", import.meta.url),
).text();

describe("FreshRSS OPML", () => {
  test("extracts exactly 38 managed feeds and preserves feed filters", () => {
    const manifest = parseFreshRssOpml(feedsOpml);

    expect(manifest.category).toBe("Repo Stack");
    expect(manifest.feeds).toHaveLength(38);
    expect(
      manifest.feeds.find((feed) => feed.title === "Hono Releases")
        ?.filtersActionRead,
    ).toBe(FRESHRSS_PRERELEASE_FILTER);
    expect(
      manifest.feeds.find((feed) => feed.title === "SQLite Releases")
        ?.filtersActionRead,
    ).toBeUndefined();
    expect(
      manifest.feeds.find((feed) => feed.title === "Vercel News — AI SDK")
        ?.filtersActionRead,
    ).toBe(String.raw`-intitle:/\bAI SDK\b/i`);
  });

  test("rejects a read filter negated with the non-canonical bang form", () => {
    // FreshRSS 1.29 and 1.30 store and export `!intitle:` as `-intitle:`, so a
    // declared bang filter never matches the live filter and the hourly sync
    // fails to converge forever.
    expect(() =>
      parseFreshRssOpml(
        feedsOpml.replace(
          String.raw`frss:filtersActionRead="-intitle:/\bAI SDK\b/i"`,
          String.raw`frss:filtersActionRead="!intitle:/\bAI SDK\b/i"`,
        ),
      ),
    ).toThrow('negates with "!", which FreshRSS stores as "-"');
    expect(() =>
      parseFreshRssOpml(
        feedsOpml.replace(
          String.raw`frss:filtersActionRead="-intitle:/\bAI SDK\b/i"`,
          'frss:filtersActionRead="intitle:beta (!intitle:rc)"',
        ),
      ),
    ).toThrow('negates with "!"');
  });

  test("accepts a bang inside a quoted or regex search literal", () => {
    for (const filter of [
      'intitle:"breaking !change"',
      String.raw`-intitle:/ !beta\b/i`,
    ]) {
      const manifest = parseFreshRssOpml(
        feedsOpml.replace(
          String.raw`-intitle:/\bAI SDK\b/i`,
          filter.replaceAll('"', "&quot;"),
        ),
      );
      expect(
        manifest.feeds.find((feed) => feed.title === "Vercel News — AI SDK")
          ?.filtersActionRead,
      ).toBe(filter);
    }
  });

  test("builds a managed-only OPML document that round-trips", () => {
    const manifest = parseFreshRssOpml(feedsOpml);
    expect(parseFreshRssOpml(buildManagedFreshRssOpml(manifest))).toEqual(
      manifest,
    );
  });

  test("rejects duplicate URLs across categories", () => {
    expect(() =>
      parseFreshRssOpml(
        feedsOpml.replace(
          "https://awesomekling.github.io/feed.xml",
          "https://bun.sh/rss.xml",
        ),
      ),
    ).toThrow("Duplicate feed URL");
  });

  test("rejects credential-bearing URLs", () => {
    expect(() =>
      parseFreshRssOpml(
        feedsOpml.replace(
          "https://bun.sh/rss.xml",
          "https://bun.sh/rss.xml?api_key=not-a-real-secret",
        ),
      ),
    ).toThrow("credential query parameter");
    expect(() =>
      parseFreshRssOpml(
        feedsOpml.replace(
          "https://bun.sh/rss.xml",
          "https://user:password@bun.sh/rss.xml",
        ),
      ),
    ).toThrow("embedded credentials");
  });

  test("rejects malformed and duplicate managed categories", () => {
    expect(() => parseFreshRssOpml("<opml>")).toThrow();
    expect(() =>
      parseFreshRssOpml(
        feedsOpml.replace(
          "  </body>",
          `${feedsOpml.slice(feedsOpml.indexOf('    <outline text="Repo Stack">'), feedsOpml.lastIndexOf("    </outline>\n  </body>"))}\n  </body>`,
        ),
      ),
    ).toThrow('Expected exactly one "Repo Stack" category');
  });
});
