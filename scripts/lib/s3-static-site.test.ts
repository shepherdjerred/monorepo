import { afterEach, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import scoutBetaPipeline from "../../packages/delivery/registrations/specialized/scout-beta/pipeline.json";
import scoutProdPipeline from "../../packages/delivery/registrations/specialized/scout-prod/pipeline.json";
import scoutBetaRecipe from "../../packages/delivery/registrations/v2/scout-for-lol/beta/recipe.json";
import scoutProdRecipe from "../../packages/delivery/registrations/v2/scout-for-lol/prod/recipe.json";
import { assertNoReservedStaticFiles } from "../../packages/temporal/src/activities/delivery/static-site-effects.ts";

import { run } from "./run.ts";
import {
  forceMutableUploadCommand,
  isMissingS3Object,
  mutableSitePruneCommand,
  s3StaticSiteDownloadCommand,
  s3SyncStaticSite,
  staticSiteFilePaths,
  staticSiteSyncDryRunCommand,
} from "./s3-static-site.ts";
import { filesHaveSameBytes } from "./s3-static-site-readback.ts";

vi.mock("./run.ts", () => ({ run: vi.fn() }));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("forced mutable upload overwrites entrypoints and preserves protected prefixes", () => {
  expect(
    forceMutableUploadCommand({
      source: "/tmp/release",
      dest: "s3://scout-frontend/",
      endpoint: "https://s3.example.test",
      excludes: ["_astro/*", "app/assets/*", ".release-version"],
      dryRun: false,
    }),
  ).toEqual([
    "aws",
    "s3",
    "cp",
    "/tmp/release",
    "s3://scout-frontend/",
    "--recursive",
    "--endpoint-url",
    "https://s3.example.test",
    "--exclude",
    "_astro/*",
    "--exclude",
    "app/assets/*",
    "--exclude",
    ".release-version",
    "--cache-control",
    "no-cache",
  ]);
});

test("forced mutable upload supports an AWS dry run", () => {
  expect(
    forceMutableUploadCommand({
      source: "/tmp/release",
      dest: "s3://scout-frontend/",
      endpoint: "https://s3.example.test",
      excludes: [],
      dryRun: true,
    }).at(-1),
  ).toBe("--dryrun");
});

test("mutable pruning protects immutable files and the release marker", () => {
  expect(
    mutableSitePruneCommand({
      source: "/tmp/release",
      dest: "s3://scout-frontend/",
      endpoint: "https://s3.example.test",
      excludes: ["_astro/*", "app/assets/*", ".release-version"],
    }),
  ).toEqual([
    "aws",
    "s3",
    "sync",
    "/tmp/release",
    "s3://scout-frontend/",
    "--endpoint-url",
    "https://s3.example.test",
    "--exclude",
    "_astro/*",
    "--exclude",
    "app/assets/*",
    "--exclude",
    ".release-version",
    "--cache-control",
    "no-cache",
    "--delete",
  ]);
});

test.each([
  ["beta", scoutBetaPipeline.scoutSite, scoutBetaRecipe.definition.steps],
  ["prod", scoutProdPipeline.scoutSite, scoutProdRecipe.definition.steps],
] as const)(
  "Scout %s releases retain prior replay package keys",
  async (_, legacy, steps) => {
    const site = steps.find((step) => step.kind === "static-site")?.policy;
    expect(site?.immutablePrefixes).toEqual(legacy.immutablePrefixes);
    expect(site?.extraExcludes).toEqual(legacy.extraExcludes);
    const replayPrefixes = ["replay-assets/", "replay-evidence/"];
    for (const prefix of replayPrefixes) {
      expect(legacy.immutablePrefixes).not.toContain(prefix);
      expect(legacy.extraExcludes).toContain(`${prefix}*`);
      expect(() =>
        assertNoReservedStaticFiles(
          [`${prefix}example.json`],
          legacy.extraExcludes,
        ),
      ).toThrow("runtime-owned object");
    }

    const runMock = vi.mocked(run);
    runMock.mockClear();
    await s3SyncStaticSite({
      source: "/tmp/release",
      bucket: legacy.bucket,
      endpoint: "https://s3.example.test",
      immutablePrefixes: legacy.immutablePrefixes,
      extraExcludes: legacy.extraExcludes,
      forceMutableUpload: true,
      cwd: "/tmp",
      env: {},
      dryRun: false,
      haveCreds: true,
    });
    const commands = runMock.mock.calls.map(([command]) => command);
    const prunes = commands.filter((command) => command.includes("--delete"));
    expect(prunes).toHaveLength(1);
    for (const prefix of replayPrefixes.map((value) => `${value}*`)) {
      expect(
        commands
          .slice(0, 2)
          .map((command) => command[command.indexOf(prefix) - 1]),
      ).toEqual(["--exclude", "--exclude"]);
      expect(
        commands.slice(2).every((command) => !command.includes(prefix)),
      ).toBe(true);
    }
  },
);

test("static-site reconciliation probes every release file without pruning retained assets", () => {
  expect(
    staticSiteSyncDryRunCommand({
      source: "/tmp/release",
      bucket: "scout-frontend-beta",
      endpoint: "https://s3.example.test",
    }),
  ).toEqual([
    "aws",
    "s3",
    "sync",
    "/tmp/release",
    "s3://scout-frontend-beta/",
    "--endpoint-url",
    "https://s3.example.test",
    "--dryrun",
  ]);
});

test("release certification enumerates every file for byte-for-byte readback", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "static-site-files-"));
  temporaryDirectories.push(directory);
  await Bun.write(`${directory}/index.html`, "home");
  await mkdir(`${directory}/docs/reference`, { recursive: true });
  await mkdir(`${directory}/_astro`, { recursive: true });
  await Bun.write(`${directory}/docs/reference/index.html`, "reference");
  await Bun.write(`${directory}/_astro/site.js`, "asset");

  await expect(staticSiteFilePaths(directory)).resolves.toEqual([
    "_astro/site.js",
    "docs/reference/index.html",
    "index.html",
  ]);
});

test("release certification rejects equal-length binary mutations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "static-site-bytes-"));
  temporaryDirectories.push(directory);
  const expected = `${directory}/expected.webp`;
  const mutated = `${directory}/mutated.webp`;
  await Bun.write(expected, new Uint8Array([0, 1, 2, 3]));
  await Bun.write(mutated, new Uint8Array([0, 1, 9, 3]));

  await expect(filesHaveSameBytes(expected, mutated)).resolves.toBe(false);
});

test("release certification downloads selected stage objects once before local comparison", () => {
  expect(
    s3StaticSiteDownloadCommand({
      bucket: "scout-frontend-beta",
      destination: "/tmp/release-readback",
      endpoint: "https://s3.example.test",
      paths: ["index.html", "docs/reference/scoutql-filters/index.html"],
    }),
  ).toEqual([
    "aws",
    "s3",
    "sync",
    "s3://scout-frontend-beta/",
    "/tmp/release-readback",
    "--endpoint-url",
    "https://s3.example.test",
    "--exclude",
    "*",
    "--include",
    "index.html",
    "--include",
    "docs/reference/scoutql-filters/index.html",
  ]);
});

test("recognizes only missing-object S3 diagnostics as repairable drift", () => {
  expect(
    isMissingS3Object(
      'fatal error: An error occurred (404) when calling the HeadObject operation: Key "app/index.html" does not exist',
    ),
  ).toBe(true);
  expect(
    isMissingS3Object(
      "fatal error: An error occurred (NoSuchKey) when calling the GetObject operation",
    ),
  ).toBe(true);
  expect(
    isMissingS3Object(
      "download failed: s3://bucket/key to - An error occurred (404) when calling the HeadObject operation: Not Found",
    ),
  ).toBe(true);
  expect(isMissingS3Object("fatal error: Access Denied")).toBe(false);
  expect(isMissingS3Object("fatal error: 404 upstream gateway")).toBe(false);
});
