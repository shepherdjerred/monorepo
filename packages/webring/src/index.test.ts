import { afterAll, expect, test } from "bun:test";
import type { Configuration } from "./types.ts";
import { run } from "./index.ts";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

async function getAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("Failed to reserve a test server port"));
        return;
      }

      const reservedPort = address.port;
      probe.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(reservedPort);
      });
    });
  });
}

const testDataDir = path.join(import.meta.dir, "testdata");
const port = await getAvailablePort();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
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
