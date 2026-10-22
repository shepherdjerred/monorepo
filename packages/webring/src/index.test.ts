import { afterAll, expect, test } from "vitest";
import type { Configuration } from "./types.ts";
import { run } from "./index.ts";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";

const testDataDir = path.join(import.meta.dir, "testdata");
function assignedPort(port: number | undefined): number {
  if (port === undefined) {
    throw new Error("Bun did not assign a test server port");
  }
  return port;
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/relative.xml") {
      return new Response(
        `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Relative links</title>
          <item><title>Latest</title><link>${url.origin}/posts/latest/</link>
          <pubDate>Fri, 02 Oct 2026 00:00:00 GMT</pubDate>
          <content:encoded><![CDATA[<p><a href="/asset.png">Root</a>
            <a href="details/">Path</a><a href="#part">Fragment</a>
            <a href="javascript:alert(1)">Unsafe</a>
            <a href="http://[">Malformed</a></p>]]></content:encoded>
          </item></channel></rss>`,
        { headers: { "Content-Type": "application/rss+xml" } },
      );
    }
    if (url.pathname === "/emoji.xml") {
      return new Response(
        `<rss version="2.0"><channel><title>Emoji</title>
          <item><title>Emoji</title><link>${url.origin}/posts/latest/</link>
          <pubDate>Fri, 02 Oct 2026 00:00:00 GMT</pubDate>
          <description>${"a".repeat(9)}😀🇯🇵 tail</description>
          </item></channel></rss>`,
        { headers: { "Content-Type": "application/rss+xml" } },
      );
    }
    if (
      url.pathname === "/asset.png" ||
      url.pathname === "/posts/latest/details/" ||
      url.pathname === "/posts/latest/"
    ) {
      return new Response("Fixture destination");
    }
    const file = Bun.file(path.join(testDataDir, path.basename(url.pathname)));
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file, {
      headers: { "Content-Type": "application/rss+xml" },
    });
  },
});
const port = assignedPort(server.port);

console.warn(`Test server listening at http://127.0.0.1:${port.toString()}`);

afterAll(async () => {
  await server.stop(true);
});

function createUrl(urlPath: string): string {
  return `http://127.0.0.1:${port.toString()}/${urlPath}`;
}

function createSources(count: number): Configuration["sources"] {
  return Array.from({ length: count }, (_, i) => ({
    title: `rss ${(i + 1).toString()}`,
    url: createUrl(`rss-${(i + 1).toString()}.xml`),
  }));
}

function normalizeSnapshotPorts(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("127.0.0.1", "localhost")
    .replaceAll(port.toString(), "PORT");
}

test("it should fetch an RSS feed without caching", async () => {
  const config: Configuration = {
    sources: createSources(19),
    number: 1,
    truncate: 300,
  };

  const result = await run(config);
  const string = normalizeSnapshotPorts(result);
  expect(string).toMatchSnapshot();
});

test("preview links resolve against the article and remain sanitized", async () => {
  const result = await run({
    sources: [{ title: "Relative links", url: createUrl("relative.xml") }],
    number: 1,
    truncate: 300,
  });
  expect(result).toHaveLength(1);
  const preview = result[0]?.preview;
  expect(preview).toContain(`href="${createUrl("asset.png")}"`);
  expect(preview).toContain(`href="${createUrl("posts/latest/details/")}"`);
  expect(preview).toContain(`href="${createUrl("posts/latest/#part")}"`);
  expect(preview).not.toContain("javascript:");
  expect(preview).toContain("<a>Malformed</a>");
  for (const target of [
    "asset.png",
    "posts/latest/details/",
    "posts/latest/",
  ]) {
    const response = await fetch(createUrl(target));
    expect(response.status).toBe(200);
  }
});

test.each([
  { truncate: 10, expected: `${"a".repeat(9)}...` },
  { truncate: 11, expected: `${"a".repeat(9)}😀...` },
  { truncate: 13, expected: `${"a".repeat(9)}😀...` },
  { truncate: 15, expected: `${"a".repeat(9)}😀🇯🇵...` },
])(
  "preview truncation at $truncate units keeps emoji whole",
  async ({ truncate, expected }) => {
    const result = await run({
      sources: [{ title: "Emoji", url: createUrl("emoji.xml") }],
      number: 1,
      truncate,
    });
    const preview = result[0]?.preview;
    expect(preview).toBe(expected);
    expect(preview?.isWellFormed()).toBe(true);
  },
);

test("it should fetch several RSS feeds", async () => {
  const config: Configuration = {
    sources: createSources(19),
    number: 3,
    truncate: 300,
  };

  const result = await run(config);
  const string = normalizeSnapshotPorts(result);
  expect(string).toMatchSnapshot();
});

test("it should fetch an RSS feed with caching", async () => {
  const config: Configuration = {
    sources: createSources(19),
    number: 1,
    truncate: 300,
    cache: {
      cache_file: `${await createTempDir()}/cache.json`,
      cache_duration_minutes: 1,
    },
  };

  const result = await run(config);
  const string = normalizeSnapshotPorts(result);
  expect(string).toMatchSnapshot();
});

// https://sdorra.dev/posts/2024-02-12-vitest-tmpdir
async function createTempDir() {
  const ostmpdir = tmpdir();
  const dir = path.join(ostmpdir, "unit-test-");
  return await mkdtemp(dir);
}
