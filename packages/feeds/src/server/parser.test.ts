import { describe, expect, test } from "vitest";
import { discoverFeedUrlFromHtml, parseFeedXml } from "./parser.ts";

describe("parseFeedXml", () => {
  const fixedNow = 1_760_000_000;

  test("parses RSS 2.0 with content:encoded, dc:creator, enclosures, and relative URLs", () => {
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel>
          <title>Engineering &amp; Ops Blog</title>
          <link>/blog/</link>
          <description>Production homelab notes</description>
          <item>
            <title>&lt;b&gt;Release 2.0&lt;/b&gt;</title>
            <link>posts/release-2</link>
            <guid isPermaLink="false">post-guid-002</guid>
            <dc:creator>Jerred Shepherd</dc:creator>
            <pubDate>Tue, 14 Oct 2025 12:00:00 GMT</pubDate>
            <description>Short summary fallback</description>
            <category>Engineering</category>
            <category domain="tag"><![CDATA[Deep Dive]]></category>
            <content:encoded><![CDATA[<p>Read <a href="../docs/guide">the guide</a> and <img src="diagram.png" alt="Arch"></p>]]></content:encoded>
            <enclosure url="/media/episode-2.mp3" type="audio/mpeg" length="1048576" />
          </item>
        </channel>
      </rss>`;

    const parsed = parseFeedXml(
      rssXml,
      "https://example.com/feeds/main.xml",
      fixedNow,
    );
    expect(parsed.title).toBe("Engineering & Ops Blog");
    expect(parsed.htmlUrl).toBe("https://example.com/blog/");
    expect(parsed.description).toBe("Production homelab notes");
    expect(parsed.entries).toHaveLength(1);

    const entry = parsed.entries[0];
    expect(entry?.guid).toBe("post-guid-002");
    expect(entry?.title).toBe("Release 2.0");
    expect(entry?.url).toBe("https://example.com/blog/posts/release-2");
    expect(entry?.author).toBe("Jerred Shepherd");
    expect(entry?.publishedAt).toBe(
      1_760_443_200 > fixedNow + 86_400 ? fixedNow : 1_760_443_200,
    );
    expect(entry?.enclosures).toEqual([
      {
        href: "https://example.com/media/episode-2.mp3",
        type: "audio/mpeg",
        length: 1_048_576,
      },
    ]);
    expect(entry?.categories).toEqual(["Engineering", "Deep Dive"]);
    expect(entry?.contentHtml).toContain(
      '<a href="https://example.com/docs/guide" rel="noopener noreferrer">the guide</a>',
    );
    expect(entry?.contentHtml).toContain(
      '<img src="https://example.com/blog/diagram.png" alt="Arch" loading="lazy" />',
    );
  });

  test("parses GitHub-releases-style Atom 1.0 without XML declaration", () => {
    const atomXml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <id>tag:github.com,2008:https://github.com/oven-sh/bun/releases</id>
        <link type="text/html" rel="alternate" href="https://github.com/oven-sh/bun/releases"/>
        <link type="application/atom+xml" rel="self" href="https://github.com/oven-sh/bun/releases.atom"/>
        <title>Release notes from bun</title>
        <subtitle>Fast JavaScript runtime</subtitle>
        <updated>2025-10-01T10:30:00Z</updated>
        <entry>
          <id>tag:github.com,2008:Repository/456/v1.3.0</id>
          <updated>2025-10-01T10:30:00Z</updated>
          <link rel="alternate" type="text/html" href="/oven-sh/bun/releases/tag/bun-v1.3.0"/>
          <link rel="enclosure" type="application/zip" length="2048" href="/oven-sh/bun/releases/download/bun-v1.3.0/bun.zip"/>
          <title>Bun v1.3.0</title>
          <category term="release" label="Release" />
          <author><name>Jarred Sumner</name></author>
          <author><name>Bun Team</name></author>
          <content type="html">&lt;h2&gt;Changes&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Faster SQLite&lt;/li&gt;&lt;/ul&gt;</content>
        </entry>
      </feed>`;

    const parsed = parseFeedXml(
      atomXml,
      "https://github.com/oven-sh/bun/releases.atom",
      fixedNow,
    );
    expect(parsed.title).toBe("Release notes from bun");
    expect(parsed.htmlUrl).toBe("https://github.com/oven-sh/bun/releases");
    expect(parsed.description).toBe("Fast JavaScript runtime");
    expect(parsed.entries).toHaveLength(1);

    const entry = parsed.entries[0];
    expect(entry?.guid).toBe("tag:github.com,2008:Repository/456/v1.3.0");
    expect(entry?.url).toBe(
      "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.0",
    );
    expect(entry?.author).toBe("Jarred Sumner, Bun Team");
    expect(entry?.publishedAt).toBe(
      Math.floor(Date.parse("2025-10-01T10:30:00Z") / 1000),
    );
    expect(entry?.enclosures).toEqual([
      {
        href: "https://github.com/oven-sh/bun/releases/download/bun-v1.3.0/bun.zip",
        type: "application/zip",
        length: 2048,
      },
    ]);
    expect(entry?.contentHtml).toBe(
      "<h2>Changes</h2><ul><li>Faster SQLite</li></ul>",
    );
    expect(entry?.categories).toEqual(["release", "Release"]);
  });

  test("parses RDF / RSS 1.0 feeds with sibling <item> elements", () => {
    const rdfXml = `<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel rdf:about="https://lwn.net/">
          <title>LWN.net</title>
          <link>https://lwn.net/</link>
          <description>Linux Weekly News</description>
        </channel>
        <item rdf:about="https://lwn.net/Articles/999999/">
          <title>Kernel 6.18 merge window</title>
          <link>https://lwn.net/Articles/999999/</link>
          <dc:date>2025-10-02T08:00:00Z</dc:date>
          <dc:creator>corbet</dc:creator>
          <description>Summary of kernel changes.</description>
        </item>
      </rdf:RDF>`;

    const parsed = parseFeedXml(
      rdfXml,
      "https://lwn.net/headlines/newrss",
      fixedNow,
    );
    expect(parsed.title).toBe("LWN.net");
    expect(parsed.htmlUrl).toBe("https://lwn.net/");
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.guid).toBe("https://lwn.net/Articles/999999/");
    expect(parsed.entries[0]?.author).toBe("corbet");
  });
});

describe("parseFeedXml sanitization and fallbacks", () => {
  const fixedNow = 1_760_000_000;

  test("strips XSS vectors while preserving safe article formatting and mailto links", () => {
    const xssXml = `<rss version="2.0"><channel><title>Sec</title><link>https://sec.example.com</link>
      <item>
        <guid>xss-1</guid>
        <title>XSS Test</title>
        <description><![CDATA[
          <p onclick="evil()">Hello <strong>world</strong></p>
          <script>alert('xss')</script>
          <style>body { display: none }</style>
          <iframe src="https://evil.example/frame">inside iframe</iframe>
          <object data="https://evil.example/obj"></object>
          <form action="https://evil.example"><input name="pw" /></form>
          <a href="javascript:alert(1)">bad link</a>
          <a href="data:text/html,<script>alert(1)</script>">data link</a>
          <a href="mailto:ops@example.com">Email Ops</a>
          <img src="javascript:alert(1)" onerror="alert(2)" alt="bad" />
          <img src="https://sec.example.com/ok.png" onerror="steal()" alt="good" />
        ]]></description>
      </item>
    </channel></rss>`;

    const parsed = parseFeedXml(
      xssXml,
      "https://sec.example.com/rss",
      fixedNow,
    );
    const html = parsed.entries[0]?.contentHtml ?? "";

    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<object");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).toContain(
      '<a href="mailto:ops@example.com" rel="noopener noreferrer">Email Ops</a>',
    );
    expect(html).toContain(
      '<img src="https://sec.example.com/ok.png" alt="good" loading="lazy" />',
    );
  });

  test("falls back to resolved item URL or deterministic sha256 when GUID is missing, and clamps invalid/future dates", () => {
    const xml = `<rss version="2.0"><channel><title>Minimal</title>
      <item>
        <title>Has Link Only</title>
        <link>/item-1</link>
        <pubDate>not-a-valid-date</pubDate>
      </item>
      <item>
        <pubDate>2099-01-01T00:00:00Z</pubDate>
        <description>No guid, no link, no title</description>
      </item>
    </channel></rss>`;

    const parsed = parseFeedXml(
      xml,
      "https://minimal.example.com/feed.xml",
      fixedNow,
    );
    expect(parsed.entries).toHaveLength(2);

    expect(parsed.entries[0]?.guid).toBe("https://minimal.example.com/item-1");
    expect(parsed.entries[0]?.publishedAt).toBe(fixedNow);

    expect(parsed.entries[1]?.title).toBe("(Untitled)");
    expect(parsed.entries[1]?.guid).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(parsed.entries[1]?.url).toBe("https://minimal.example.com/feed.xml");
    expect(parsed.entries[1]?.publishedAt).toBe(fixedNow);
  });
});

describe("discoverFeedUrlFromHtml", () => {
  test("discovers RSS, Atom, and RDF alternate links and resolves relative hrefs", () => {
    const html = `<!doctype html>
      <html>
        <head>
          <link rel="stylesheet" href="/app.css" />
          <link rel="alternate" type="application/atom+xml; charset=utf-8" href="/blog/atom.xml" />
          <link rel="alternate" type="application/rss+xml" href="/blog/rss.xml" />
        </head>
        <body>Hello</body>
      </html>`;

    expect(
      discoverFeedUrlFromHtml(html, "https://example.com/blog/index.html"),
    ).toBe("https://example.com/blog/atom.xml");

    const rdfHtml = `<head><link rel="feed alternate" type="application/rdf+xml" href="headlines.rdf"></head>`;
    expect(discoverFeedUrlFromHtml(rdfHtml, "https://lwn.net/dir/")).toBe(
      "https://lwn.net/dir/headlines.rdf",
    );

    expect(
      discoverFeedUrlFromHtml(
        "<html><head></head></html>",
        "https://example.com",
      ),
    ).toBeUndefined();
  });
});
