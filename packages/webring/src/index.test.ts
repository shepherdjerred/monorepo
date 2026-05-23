import { afterAll, expect, test } from "bun:test";
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
