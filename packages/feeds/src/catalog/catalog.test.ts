import path from "node:path";
import { DomUtils, parseDocument } from "htmlparser2";
import { describe, expect, test } from "vitest";
import { matchesAutoReadRule } from "@shepherdjerred/feeds/server/auto-read.ts";
import type { DeclaredFeed } from "@shepherdjerred/feeds/shared/contract.ts";
import {
  AI_SDK_ONLY_RULE,
  DECLARED_FEEDS,
  PRERELEASE_RULE,
  validateCatalog,
} from "./catalog.ts";

const FRESHRSS_OPML_PATH = path.join(
  import.meta.dirname,
  "../../../homelab/src/cdk8s/helm/freshrss/feeds.opml",
);

type OpmlEntry = {
  readonly group: string;
  readonly text: string;
  readonly xmlUrl: string;
  readonly htmlUrl: string | undefined;
  readonly description: string | undefined;
  readonly priority: string | undefined;
  readonly filterRead: string | undefined;
};

function parseOpmlFeeds(opmlXml: string): OpmlEntry[] {
  const doc = parseDocument(opmlXml, { xmlMode: true });
  const outlines = DomUtils.getElementsByTagName("outline", doc, true);
  const entries: OpmlEntry[] = [];
  for (const node of outlines) {
    const xmlUrl = node.attribs["xmlUrl"];
    if (
      xmlUrl === undefined ||
      xmlUrl === "https://github.com/FreshRSS/FreshRSS/releases.atom"
    ) {
      continue;
    }
    const parent = DomUtils.getParent(node);
    const group =
      parent !== null && "attribs" in parent
        ? (parent.attribs["text"] ?? "")
        : "";
    entries.push({
      group,
      text: node.attribs["text"] ?? "",
      xmlUrl,
      htmlUrl: node.attribs["htmlUrl"],
      description: node.attribs["description"],
      priority: node.attribs["frss:priority"],
      filterRead: node.attribs["frss:filtersActionRead"],
    });
  }
  return entries;
}

function expectedRuleForOpmlFilter(filterRead: string | undefined) {
  if (
    filterRead ===
    String.raw`intitle:/\b(alpha|beta|rc|canary|dev|nightly|preview|pre)\b/i`
  ) {
    return PRERELEASE_RULE;
  }
  return filterRead === String.raw`-intitle:/\bAI SDK\b/i`
    ? AI_SDK_ONLY_RULE
    : undefined;
}

describe("DECLARED_FEEDS catalog", () => {
  test("passes catalog validation and matches exact counts from FreshRSS OPML", () => {
    expect(() => validateCatalog(DECLARED_FEEDS)).not.toThrow();

    expect(DECLARED_FEEDS).toHaveLength(65);

    const repoStack = DECLARED_FEEDS.filter((f) => f.category === "Repo Stack");
    const blogs = DECLARED_FEEDS.filter((f) => f.category === "Blogs");
    expect(repoStack).toHaveLength(35);
    expect(blogs).toHaveLength(30);

    const hidden = DECLARED_FEEDS.filter((f) => f.hidden === true);
    expect(hidden).toHaveLength(2);
    expect(hidden.map((f) => f.url)).toEqual([
      "https://blog.jetbrains.com/idea/feed/",
      "https://code.visualstudio.com/feed.xml",
    ]);

    const prereleaseFeeds = DECLARED_FEEDS.filter(
      (f) => f.autoRead === PRERELEASE_RULE,
    );
    expect(prereleaseFeeds).toHaveLength(9);

    const aiSdkFeeds = DECLARED_FEEDS.filter(
      (f) => f.autoRead === AI_SDK_ONLY_RULE,
    );
    expect(aiSdkFeeds).toHaveLength(1);
    expect(aiSdkFeeds[0]?.title).toBe("Vercel News — AI SDK");

    expect(
      DECLARED_FEEDS.some(
        (f) => f.url === "https://github.com/FreshRSS/FreshRSS/releases.atom",
      ),
    ).toBe(false);
  });

  test("preserves exact titles, URLs, descriptions, and rules from feeds.opml", async () => {
    const opmlXml = await Bun.file(FRESHRSS_OPML_PATH).text();
    const parsed = parseOpmlFeeds(opmlXml);
    expect(parsed).toHaveLength(DECLARED_FEEDS.length);

    const byUrl = new Map(DECLARED_FEEDS.map((f) => [f.url, f]));
    for (const opmlItem of parsed) {
      const declared = byUrl.get(opmlItem.xmlUrl);
      expect(declared).toBeDefined();
      if (opmlItem.xmlUrl === "https://danluu.com/atom.xml") {
        expect(declared?.title).toBe("Dan Luu");
        expect(declared?.htmlUrl).toBe("https://danluu.com/");
      } else {
        expect(declared?.title).toBe(opmlItem.text);
        expect(declared?.htmlUrl).toBe(opmlItem.htmlUrl);
        expect(declared?.description).toBe(opmlItem.description);
      }
      expect(declared?.category).toBe(
        opmlItem.group === "Repo Stack" ? "Repo Stack" : "Blogs",
      );
      expect(declared?.hidden === true).toBe(opmlItem.priority === "hidden");
      expect(declared?.autoRead).toEqual(
        expectedRuleForOpmlFilter(opmlItem.filterRead),
      );
    }
  });

  test("autoRead rules match prereleases and negated AI SDK titles accurately", () => {
    expect(
      matchesAutoReadRule(PRERELEASE_RULE, { title: "v4.2.0-beta.1" }),
    ).toBe(true);
    expect(
      matchesAutoReadRule(PRERELEASE_RULE, { title: "Nightly 2026-11-24" }),
    ).toBe(true);
    expect(matchesAutoReadRule(PRERELEASE_RULE, { title: "v4.2.0" })).toBe(
      false,
    );
    expect(
      matchesAutoReadRule(PRERELEASE_RULE, {
        title: "Prefix matching check: presentation tools",
      }),
    ).toBe(false);

    expect(
      matchesAutoReadRule(AI_SDK_ONLY_RULE, {
        title: "Introducing AI SDK 4.2",
      }),
    ).toBe(false);
    expect(
      matchesAutoReadRule(AI_SDK_ONLY_RULE, {
        title: "Next.js Conf Keynote Recap",
      }),
    ).toBe(true);
    expect(matchesAutoReadRule(null, { title: "Anything" })).toBe(false);
  });

  test("validateCatalog rejects missing categories, credentials, duplicates, and bad regexes", () => {
    const validRepo: DeclaredFeed = {
      category: "Repo Stack",
      title: "Repo One",
      url: "https://example.com/repo.xml",
    };
    const validBlog: DeclaredFeed = {
      category: "Blogs",
      title: "Blog One",
      url: "https://example.com/blog.xml",
    };

    expect(() => validateCatalog([validRepo])).toThrow(/Blogs/u);
    expect(() => validateCatalog([validBlog])).toThrow(/Repo Stack/u);
    expect(() =>
      validateCatalog([
        validRepo,
        { ...validBlog, url: "ftp://example.com/feed.xml" },
      ]),
    ).toThrow(/protocol/iu);
    expect(() =>
      validateCatalog([
        validRepo,
        { ...validBlog, url: "https://user:pass@example.com/feed.xml" },
      ]),
    ).toThrow(/credentials/iu);
    expect(() =>
      validateCatalog([
        validRepo,
        { ...validBlog, url: "https://example.com/feed.xml?token=my-secret" },
      ]),
    ).toThrow(/query parameter/iu);
    expect(() =>
      validateCatalog([
        validRepo,
        { ...validBlog, url: "https://example.com/feed.xml?api_key=abc" },
      ]),
    ).toThrow(/query parameter/iu);
    expect(() =>
      validateCatalog([validRepo, { ...validBlog, url: validRepo.url }]),
    ).toThrow(/Duplicate/u);
    expect(() =>
      validateCatalog([
        validRepo,
        {
          ...validBlog,
          autoRead: { field: "title", pattern: "[unclosed", flags: "i" },
        },
      ]),
    ).toThrow(/Invalid autoRead regex/u);
  });
});
