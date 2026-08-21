import { describe, expect, test } from "bun:test";
import feedsOpml from "@shepherdjerred/homelab/cdk8s/helm/freshrss/feeds.opml" with { type: "text" };
import {
  buildManagedFreshRssOpml,
  FRESHRSS_PRERELEASE_FILTER,
  parseFreshRssOpml,
} from "./freshrss-opml.ts";

describe("FreshRSS OPML", () => {
  test("extracts exactly 40 managed feeds and preserves prerelease filters", () => {
    const manifest = parseFreshRssOpml(feedsOpml);

    expect(manifest.category).toBe("Repo Stack");
    expect(manifest.feeds).toHaveLength(40);
    expect(
      manifest.feeds.find((feed) => feed.title === "TypeScript Releases")
        ?.filtersActionRead,
    ).toBe(FRESHRSS_PRERELEASE_FILTER);
    expect(
      manifest.feeds.find((feed) => feed.title === "SQLite Releases")
        ?.filtersActionRead,
    ).toBeUndefined();
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
