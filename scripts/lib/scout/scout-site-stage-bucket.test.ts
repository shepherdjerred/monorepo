import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  archiveDocsRoutes,
  assertStageArchiveIsLive,
  assertDocsRoutesReachable,
  stageArchiveIsLive,
} from "./scout-site-stage-bucket.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function docsArchive(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "scout-docs-archive-"));
  temporaryDirectories.push(directory);
  for (const route of ["docs", "docs/reference/scoutql-filters"]) {
    const pageDirectory = path.join(directory, route);
    await mkdir(pageDirectory, { recursive: true });
    await Bun.write(path.join(pageDirectory, "index.html"), route);
  }
  await mkdir(path.join(directory, "docs", "_astro"), { recursive: true });
  await Bun.write(path.join(directory, "docs", "_astro", "site.js"), "asset");
  return directory;
}

test("derives only public documentation routes from archive pages", async () => {
  const directory = await docsArchive();
  await expect(archiveDocsRoutes(directory)).resolves.toEqual([
    "/docs/",
    "/docs/reference/scoutql-filters/",
  ]);
});

test("requires every generated documentation route to be public before accepting a stage", async () => {
  const directory = await docsArchive();
  const requests: string[] = [];
  const signals: AbortSignal[] = [];
  await expect(
    stageArchiveIsLive({
      stage: "beta",
      source: directory,
      needsSync: async () => false,
      fetch: async (input, init) => {
        requests.push(input.toString());
        if (init?.signal instanceof AbortSignal) signals.push(init.signal);
        return new Response("ok");
      },
    }),
  ).resolves.toBe(true);
  expect(requests).toEqual([
    "https://beta.scout-for-lol.com/docs/",
    "https://beta.scout-for-lol.com/docs/reference/scoutql-filters/",
  ]);
  expect(signals).toHaveLength(2);
});

test("reconciles an incomplete bucket before attempting public acceptance", async () => {
  const directory = await docsArchive();
  const comparedSources: string[] = [];
  await expect(
    stageArchiveIsLive({
      stage: "beta",
      source: directory,
      syncSource: "s3://scout-site-releases/certified/beta/",
      needsSync: async (source) => {
        comparedSources.push(source);
        return true;
      },
      fetch: async () => {
        throw new Error("public checks must wait for reconciliation");
      },
    }),
  ).resolves.toBe(false);
  expect(comparedSources).toEqual(["s3://scout-site-releases/certified/beta/"]);
});

test("keeps historical docs-less archives available as rollback targets", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "scout-site-archive-"));
  temporaryDirectories.push(directory);
  await Bun.write(path.join(directory, "index.html"), "home");
  await expect(
    assertDocsRoutesReachable({
      stage: "prod",
      docsDirectory: directory,
      fetch: async () => {
        throw new Error("docs-less archives have no docs route to fetch");
      },
    }),
  ).resolves.toBeUndefined();
});

test("reports every generated documentation route that fails publicly", async () => {
  const directory = await docsArchive();
  await expect(
    assertDocsRoutesReachable({
      stage: "prod",
      docsDirectory: directory,
      fetch: async (input) =>
        input.toString().endsWith("/docs/")
          ? new Response("ok")
          : new Response("missing", { status: 403 }),
    }),
  ).rejects.toThrow("/docs/reference/scoutql-filters/ (403)");
});

test("waits for storage reconciliation before certifying a just-synced archive", async () => {
  const directory = await docsArchive();
  let attempts = 0;
  const delays: number[] = [];
  await expect(
    assertStageArchiveIsLive("beta", directory, {
      needsSync: async () => {
        attempts++;
        return attempts < 3;
      },
      fetch: async () => new Response("ok"),
      sleep: async (delay) => {
        delays.push(delay);
      },
    }),
  ).resolves.toBeUndefined();
  expect(attempts).toBe(3);
  expect(delays).toEqual([5000, 5000]);
});
