import { expect, test } from "vitest";
import { matchesAutoReadRule } from "@shepherdjerred/feeds/server/auto-read.ts";
import type { DeclaredFeed } from "@shepherdjerred/feeds/shared/contract.ts";
import { DECLARED_FEEDS, validateCatalog } from "./catalog.ts";
import {
  AI_SDK_ONLY_RULE,
  PRERELEASE_RULE,
  STRICT_RELEASE_RULES,
} from "./rules.ts";

test("passes catalog validation and maintains category, hidden, and rule counts", () => {
  expect(() => validateCatalog(DECLARED_FEEDS)).not.toThrow();

  expect(DECLARED_FEEDS).toHaveLength(65);

  const engInfra = DECLARED_FEEDS.filter(
    (f) => f.category === "Engineering & Infra",
  );
  const ai = DECLARED_FEEDS.filter((f) => f.category === "AI");
  const essays = DECLARED_FEEDS.filter(
    (f) => f.category === "Essays & Personal Blogs",
  );
  expect(engInfra).toHaveLength(36);
  expect(ai).toHaveLength(4);
  expect(essays).toHaveLength(25);

  const hidden = DECLARED_FEEDS.filter((f) => f.hidden === true);
  expect(hidden).toHaveLength(2);
  expect(hidden.map((f) => f.url)).toEqual([
    "https://blog.jetbrains.com/idea/feed/",
    "https://code.visualstudio.com/feed.xml",
  ]);

  const strictReleaseFeeds = DECLARED_FEEDS.filter(
    (f) => f.autoRead === STRICT_RELEASE_RULES,
  );
  expect(strictReleaseFeeds).toHaveLength(10);

  const aiSdkFeeds = DECLARED_FEEDS.filter(
    (f) => f.autoRead === AI_SDK_ONLY_RULE,
  );
  expect(aiSdkFeeds).toHaveLength(1);
  expect(aiSdkFeeds[0]?.title).toBe("Vercel News — AI SDK");

  const danLuu = DECLARED_FEEDS.find(
    (f) => f.url === "https://danluu.com/atom.xml",
  );
  expect(danLuu?.title).toBe("Dan Luu");
  expect(danLuu?.category).toBe("Essays & Personal Blogs");
  expect(danLuu?.htmlUrl).toBe("https://danluu.com/");
});

test("strict release rules auto-read snapshots, sub-tags, and x.y.z patches while keeping x.y.0 releases", () => {
  expect(matchesAutoReadRule(PRERELEASE_RULE, { title: "v4.2.0-beta.1" })).toBe(
    true,
  );
  expect(
    matchesAutoReadRule(STRICT_RELEASE_RULES, {
      title: "swift-DEVELOPMENT-SNAPSHOT-2026-11-25-a",
    }),
  ).toBe(true);
  expect(
    matchesAutoReadRule(STRICT_RELEASE_RULES, {
      title: "pkg/machinery/v1.14.7",
    }),
  ).toBe(true);
  expect(
    matchesAutoReadRule(STRICT_RELEASE_RULES, {
      title: "gitops-engine/v3.6.0: chore: bump version",
    }),
  ).toBe(true);
  expect(
    matchesAutoReadRule(STRICT_RELEASE_RULES, {
      title: "@hono/lambda-edge@1.0.2",
    }),
  ).toBe(true);
  expect(
    matchesAutoReadRule(STRICT_RELEASE_RULES, {
      title: "stable: chore: bump version",
    }),
  ).toBe(true);
  expect(matchesAutoReadRule(STRICT_RELEASE_RULES, { title: "v1.14.7" })).toBe(
    true,
  );
  expect(
    matchesAutoReadRule(STRICT_RELEASE_RULES, {
      title: "Version 3.54.1",
    }),
  ).toBe(true);

  expect(matchesAutoReadRule(STRICT_RELEASE_RULES, { title: "v1.15.0" })).toBe(
    false,
  );
  expect(
    matchesAutoReadRule(STRICT_RELEASE_RULES, {
      title: "Version 3.54.0",
    }),
  ).toBe(false);
  expect(
    matchesAutoReadRule(STRICT_RELEASE_RULES, {
      title: "Swift 6.5 Release",
    }),
  ).toBe(false);
  expect(
    matchesAutoReadRule(PRERELEASE_RULE, {
      title: "Prefix matching check: presentation tools",
    }),
  ).toBe(false);
});

test("vendor blog rules filter marketing, categories, and URLs while preserving technical posts", () => {
  const openAi = DECLARED_FEEDS.find((f) => f.title === "OpenAI News");
  const cloudflare = DECLARED_FEEDS.find((f) => f.title === "Cloudflare Blog");
  const rust = DECLARED_FEEDS.find((f) => f.title === "Rust Blog");

  expect(
    matchesAutoReadRule(openAi?.autoRead, {
      title: "How OpenAI's Performance Factory keeps ChatGPT fast",
      url: "https://openai.com/index/how-openai-performance-factory-keeps-chatgpt-fast",
      categories: ["Engineering"],
    }),
  ).toBe(false);
  expect(
    matchesAutoReadRule(openAi?.autoRead, {
      title: "Partnering with Hacktron to find vulnerabilities in OpenAI",
      url: "https://openai.com/index/partnering-with-hacktron",
      categories: ["Security"],
    }),
  ).toBe(false);
  expect(
    matchesAutoReadRule(openAi?.autoRead, {
      title: "How Intentful uses dots to make more time for growth",
      url: "https://openai.com/business/customer-stories/intentful-dots",
    }),
  ).toBe(true);
  expect(
    matchesAutoReadRule(openAi?.autoRead, {
      title: "Richpanel helps companies automate 50% of support",
      url: "https://openai.com/index/richpanel",
      categories: ["Startup"],
    }),
  ).toBe(true);
  expect(
    matchesAutoReadRule(openAi?.autoRead, {
      title: "Cult.fit builds operational muscle with Codex",
      url: "https://openai.com/index/cultfit-builds-with-codex",
    }),
  ).toBe(true);

  expect(
    matchesAutoReadRule(cloudflare?.autoRead, {
      title: "Probing DNS at Cloudflare",
      url: "https://blog.cloudflare.com/probing-dns-at-cloudflare/",
      categories: ["DNS", "Engineering"],
    }),
  ).toBe(false);
  expect(
    matchesAutoReadRule(cloudflare?.autoRead, {
      title: "How Cloudflare WAF protects against ruby2shell",
      url: "https://blog.cloudflare.com/ruby2shell-waf-protection/",
      categories: ["Managed Rules", "WAF"],
    }),
  ).toBe(true);

  expect(
    matchesAutoReadRule(rust?.autoRead, {
      title: "Enabling the parallel frontend on nightly",
      url: "https://blog.rust-lang.org/2026/11/16/enabling-parallel-frontend-on-nightly/",
    }),
  ).toBe(false);
  expect(
    matchesAutoReadRule(rust?.autoRead, {
      title: "Announcing Rust 1.100.0",
      url: "https://blog.rust-lang.org/2026/11/12/Rust-1.100.0/",
    }),
  ).toBe(false);
  expect(
    matchesAutoReadRule(rust?.autoRead, {
      title: "Announcing Rust 1.100.1",
      url: "https://blog.rust-lang.org/2026/11/20/Rust-1.100.1/",
    }),
  ).toBe(true);

  expect(
    matchesAutoReadRule(
      { field: "category", pattern: "^Engineering$", flags: "i", negate: true },
      { title: "Legacy entry with no stored categories", categories: [] },
    ),
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
  const validEng: DeclaredFeed = {
    category: "Engineering & Infra",
    title: "Infra One",
    url: "https://example.com/infra.xml",
  };
  const validAi: DeclaredFeed = {
    category: "AI",
    title: "AI One",
    url: "https://example.com/ai.xml",
  };
  const validEssay: DeclaredFeed = {
    category: "Essays & Personal Blogs",
    title: "Essay One",
    url: "https://example.com/essay.xml",
  };

  expect(() => validateCatalog([validEng, validAi])).toThrow(
    /Essays & Personal Blogs/u,
  );
  expect(() => validateCatalog([validEng, validEssay])).toThrow(/AI/u);
  expect(() => validateCatalog([validAi, validEssay])).toThrow(
    /Engineering & Infra/u,
  );
  expect(() =>
    validateCatalog([
      validEng,
      validAi,
      { ...validEssay, url: "ftp://example.com/feed.xml" },
    ]),
  ).toThrow(/protocol/iu);
  expect(() =>
    validateCatalog([
      validEng,
      validAi,
      { ...validEssay, url: "https://user:pass@example.com/feed.xml" },
    ]),
  ).toThrow(/credentials/iu);
  expect(() =>
    validateCatalog([
      validEng,
      validAi,
      { ...validEssay, url: "https://example.com/feed.xml?token=my-secret" },
    ]),
  ).toThrow(/query parameter/iu);
  expect(() =>
    validateCatalog([
      validEng,
      validAi,
      { ...validEssay, url: "https://example.com/feed.xml?api_key=abc" },
    ]),
  ).toThrow(/query parameter/iu);
  expect(() =>
    validateCatalog([validEng, validAi, { ...validEssay, url: validEng.url }]),
  ).toThrow(/Duplicate/u);
  expect(() =>
    validateCatalog([
      validEng,
      validAi,
      {
        ...validEssay,
        autoRead: [
          { field: "url", pattern: "/promo/", flags: "i" },
          { field: "title", pattern: "[unclosed", flags: "i" },
        ],
      },
    ]),
  ).toThrow(/Invalid autoRead regex/u);
});
