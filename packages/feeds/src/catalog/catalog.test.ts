import { describe, expect, test } from "vitest";
import { matchesAutoReadRule } from "@shepherdjerred/feeds/server/auto-read.ts";
import type { DeclaredFeed } from "@shepherdjerred/feeds/shared/contract.ts";
import {
  AI_SDK_ONLY_RULE,
  DECLARED_FEEDS,
  PRERELEASE_RULE,
  validateCatalog,
} from "./catalog.ts";

describe("DECLARED_FEEDS catalog", () => {
  test("passes catalog validation and maintains category, hidden, and rule counts", () => {
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

    const danLuu = DECLARED_FEEDS.find(
      (f) => f.url === "https://danluu.com/atom.xml",
    );
    expect(danLuu?.title).toBe("Dan Luu");
    expect(danLuu?.htmlUrl).toBe("https://danluu.com/");
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
